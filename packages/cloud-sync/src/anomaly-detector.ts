/**
 * Engagement Anomaly Detector
 * Detects spikes and drops in post engagement metrics using rolling averages.
 * Compares current metrics against a 3-snapshot rolling average from post_stats_history.
 * Writes detected anomalies to engagement_anomalies table and optionally queues actions.
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface AnomalyResult {
  platform: string;
  post_id: string;
  post_url: string | null;
  anomaly_type: 'spike' | 'drop';
  metric: string;
  current_value: number;
  rolling_avg: number;
  deviation_pct: number;
  severity: 'low' | 'medium' | 'high';
}

// Thresholds for anomaly detection (% deviation from rolling avg)
const THRESHOLDS = {
  spike: { low: 50, medium: 150, high: 300 },  // +50%, +150%, +300%
  drop:  { low: -30, medium: -50, high: -75 },  // -30%, -50%, -75%
};

// Metrics to monitor
const MONITORED_METRICS = ['views', 'likes', 'comments', 'shares', 'engagement_rate'] as const;

// Minimum rolling avg to trigger anomaly (avoid noise on tiny numbers)
const MIN_ROLLING_AVG: Record<string, number> = {
  views: 5,
  likes: 2,
  comments: 1,
  shares: 1,
  engagement_rate: 0.5,
};

// Minimum history snapshots needed for meaningful detection
const MIN_HISTORY_SNAPSHOTS = 2;

function classifySeverity(deviationPct: number, type: 'spike' | 'drop'): 'low' | 'medium' | 'high' | null {
  const t = THRESHOLDS[type];
  if (type === 'spike') {
    if (deviationPct >= t.high) return 'high';
    if (deviationPct >= t.medium) return 'medium';
    if (deviationPct >= t.low) return 'low';
  } else {
    if (deviationPct <= t.high) return 'high';
    if (deviationPct <= t.medium) return 'medium';
    if (deviationPct <= t.low) return 'low';
  }
  return null; // not anomalous
}

export async function detectAnomalies(client: SupabaseClient): Promise<AnomalyResult[]> {
  const anomalies: AnomalyResult[] = [];

  // Get all posts with their current stats
  const { data: posts, error: postsErr } = await client
    .from('post_stats')
    .select('id, platform, post_id, post_url, views, likes, comments, shares, engagement_rate');

  if (postsErr || !posts?.length) {
    console.log(`[Anomaly] No posts to analyze: ${postsErr?.message || 'empty'}`);
    return anomalies;
  }

  for (const post of posts) {
    // Get history snapshots for this post, ordered by time
    const { data: history, error: histErr } = await client
      .from('post_stats_history')
      .select('views, likes, comments, shares, engagement_rate, recorded_at')
      .eq('post_stat_id', post.id)
      .order('recorded_at', { ascending: false })
      .limit(10);

    if (histErr || !history || history.length < MIN_HISTORY_SNAPSHOTS) continue;

    // Use last 3 snapshots (excluding most recent which = current) for rolling avg
    // Determine once: is the newest snapshot a mirror of current stats?
    const rawSnapshots = history.slice(0, Math.min(history.length, 4));
    if (rawSnapshots.length < MIN_HISTORY_SNAPSHOTS) continue;

    // Check if newest snapshot mirrors current post_stats on ALL metrics
    const newestIsCurrent = rawSnapshots.length > 1 && MONITORED_METRICS.every(m =>
      Number(rawSnapshots[0][m]) === (Number(post[m]) || 0)
    );
    const snapshots = newestIsCurrent ? rawSnapshots.slice(1) : rawSnapshots;
    if (snapshots.length < 1) continue;

    for (const metric of MONITORED_METRICS) {
      const currentVal = Number(post[metric]) || 0;

      const vals = snapshots.map(s => Number(s[metric]) || 0);
      if (vals.length === 0) continue;

      const rollingAvg = vals.reduce((a, b) => a + b, 0) / vals.length;

      // Skip if rolling avg too small (avoid noise)
      const minAvg = MIN_ROLLING_AVG[metric] ?? 1;
      if (rollingAvg < minAvg && currentVal < minAvg) continue;

      // Compute deviation
      if (rollingAvg === 0) {
        // Only flag spike from 0 if history had meaningful non-zero values before
        // (avoids false positives when a metric is newly tracked)
        const nonZeroHistory = vals.filter(v => v > 0).length;
        if (nonZeroHistory >= 2 && currentVal >= minAvg * 2) {
          anomalies.push({
            platform: post.platform,
            post_id: post.post_id,
            post_url: post.post_url,
            anomaly_type: 'spike',
            metric,
            current_value: currentVal,
            rolling_avg: 0,
            deviation_pct: 100,
            severity: 'medium',
          });
        }
        continue;
      }

      const deviationPct = ((currentVal - rollingAvg) / rollingAvg) * 100;
      const type: 'spike' | 'drop' = deviationPct > 0 ? 'spike' : 'drop';
      const severity = classifySeverity(deviationPct, type);

      if (severity) {
        anomalies.push({
          platform: post.platform,
          post_id: post.post_id,
          post_url: post.post_url,
          anomaly_type: type,
          metric,
          current_value: currentVal,
          rolling_avg: Math.round(rollingAvg * 100) / 100,
          deviation_pct: Math.round(deviationPct * 10) / 10,
          severity,
        });
      }
    }
  }

  return anomalies;
}

/**
 * Run anomaly detection and persist results.
 * Deduplicates by platform:post_id:metric:type:date to avoid repeat alerts.
 */
export async function runAnomalyDetection(client: SupabaseClient): Promise<{
  detected: number;
  persisted: number;
  queued: number;
}> {
  const anomalies = await detectAnomalies(client);
  if (!anomalies.length) {
    return { detected: 0, persisted: 0, queued: 0 };
  }

  console.log(`[Anomaly] Detected ${anomalies.length} anomalies`);

  const today = new Date().toISOString().split('T')[0];
  let persisted = 0;
  let queued = 0;

  for (const a of anomalies) {
    const dedupKey = `${a.platform}:${a.post_id}:${a.metric}:${a.anomaly_type}:${today}`;

    // Persist anomaly (skip duplicates)
    const { error: insertErr } = await client
      .from('engagement_anomalies')
      .upsert({
        platform: a.platform,
        post_id: a.post_id,
        post_url: a.post_url,
        anomaly_type: a.anomaly_type,
        metric: a.metric,
        current_value: a.current_value,
        rolling_avg: a.rolling_avg,
        deviation_pct: a.deviation_pct,
        severity: a.severity,
        dedup_key: dedupKey,
      }, { onConflict: 'dedup_key', ignoreDuplicates: true });

    if (!insertErr) persisted++;

    // Queue high-severity anomalies for action
    if (a.severity === 'high') {
      const actionDedup = `anomaly_alert:${dedupKey}`;
      const { error: queueErr } = await client
        .from('cloud_action_queue')
        .upsert({
          platform: a.platform,
          action_type: 'anomaly_alert',
          target_post_url: a.post_url,
          priority: a.anomaly_type === 'spike' ? 1 : 2,
          status: 'pending',
          dedup_key: actionDedup,
          params: {
            anomaly_type: a.anomaly_type,
            metric: a.metric,
            current_value: a.current_value,
            rolling_avg: a.rolling_avg,
            deviation_pct: a.deviation_pct,
            severity: a.severity,
            post_id: a.post_id,
          },
        }, { onConflict: 'dedup_key', ignoreDuplicates: true });

      if (!queueErr) queued++;
    }

    const icon = a.anomaly_type === 'spike' ? '📈' : '📉';
    console.log(`  ${icon} [${a.severity}] ${a.platform}/${a.post_id}: ${a.metric} ${a.anomaly_type} ${a.deviation_pct}% (${a.current_value} vs avg ${a.rolling_avg})`);
  }

  return { detected: anomalies.length, persisted, queued };
}
