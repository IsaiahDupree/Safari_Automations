/**
 * Post Analytics & Learning Module
 * 
 * Analyzes synced post stats to derive insights:
 *   - Best posting times
 *   - Best content formats
 *   - Top-performing topics/hashtags
 *   - Audience engagement patterns
 *   - Trend detection
 */
import { CloudSupabase, getCloudSupabase } from './supabase';
import { Platform } from './types';

export class PostAnalytics {
  private db: CloudSupabase;

  constructor() {
    this.db = getCloudSupabase();
  }

  /**
   * Run full analytics pass: analyze all post stats and generate learnings
   */
  async runAnalysis(platform?: Platform): Promise<{ learnings: number; insights: string[] }> {
    const insights: string[] = [];
    let learningsCount = 0;

    const posts = await this.db.getPostStats(platform, 200);
    if (posts.length < 3) {
      return { learnings: 0, insights: ['Not enough post data yet (need at least 3 posts)'] };
    }

    // 1. Best performing content analysis
    const topPosts = posts
      .filter((p: any) => p.engagement_rate > 0)
      .sort((a: any, b: any) => (b.engagement_rate || 0) - (a.engagement_rate || 0));

    if (topPosts.length >= 3) {
      const top3 = topPosts.slice(0, 3);
      const avgEngagement = top3.reduce((s: number, p: any) => s + (p.engagement_rate || 0), 0) / 3;
      
      const insight = `Top 3 posts average ${avgEngagement.toFixed(1)}% engagement. Types: ${top3.map((p: any) => p.post_type).join(', ')}`;
      insights.push(insight);
      
      await this.db.addLearning({
        platform: platform || 'all',
        learning_type: 'best_format',
        insight,
        confidence: Math.min(0.9, posts.length / 50),
        data_points: posts.length,
        raw_analysis: { top3: top3.map((p: any) => ({ post_id: p.post_id, engagement_rate: p.engagement_rate, type: p.post_type })) },
      });
      learningsCount++;
    }

    // 2. Best posting time analysis
    const postsWithTime = posts.filter((p: any) => p.published_at);
    if (postsWithTime.length >= 5) {
      const hourBuckets: Record<number, { count: number; totalEng: number }> = {};
      for (const p of postsWithTime) {
        const hour = new Date(p.published_at).getHours();
        if (!hourBuckets[hour]) hourBuckets[hour] = { count: 0, totalEng: 0 };
        hourBuckets[hour].count++;
        hourBuckets[hour].totalEng += p.engagement_rate || 0;
      }

      const bestHour = Object.entries(hourBuckets)
        .map(([h, d]) => ({ hour: parseInt(h), avgEng: d.totalEng / d.count, count: d.count }))
        .filter(h => h.count >= 2)
        .sort((a, b) => b.avgEng - a.avgEng)[0];

      if (bestHour) {
        const insight = `Best posting hour: ${bestHour.hour}:00 (${bestHour.avgEng.toFixed(1)}% avg engagement across ${bestHour.count} posts)`;
        insights.push(insight);

        await this.db.addLearning({
          platform: platform || 'all',
          learning_type: 'best_time',
          insight,
          confidence: Math.min(0.85, bestHour.count / 10),
          data_points: postsWithTime.length,
          raw_analysis: { bestHour, allHours: hourBuckets },
        });
        learningsCount++;
      }
    }

    // 3. Hashtag effectiveness analysis
    const postsWithHashtags = posts.filter((p: any) => p.hashtags?.length > 0);
    if (postsWithHashtags.length >= 3) {
      const hashtagPerf: Record<string, { count: number; totalEng: number }> = {};
      for (const p of postsWithHashtags) {
        for (const tag of (p.hashtags || [])) {
          if (!hashtagPerf[tag]) hashtagPerf[tag] = { count: 0, totalEng: 0 };
          hashtagPerf[tag].count++;
          hashtagPerf[tag].totalEng += p.engagement_rate || 0;
        }
      }

      const topHashtags = Object.entries(hashtagPerf)
        .map(([tag, d]) => ({ tag, avgEng: d.totalEng / d.count, count: d.count }))
        .filter(h => h.count >= 2)
        .sort((a, b) => b.avgEng - a.avgEng)
        .slice(0, 5);

      if (topHashtags.length > 0) {
        const insight = `Top hashtags by engagement: ${topHashtags.map(h => `${h.tag} (${h.avgEng.toFixed(1)}%)`).join(', ')}`;
        insights.push(insight);

        await this.db.addLearning({
          platform: platform || 'all',
          learning_type: 'best_topic',
          insight,
          confidence: Math.min(0.8, topHashtags[0].count / 5),
          data_points: postsWithHashtags.length,
          raw_analysis: { topHashtags },
        });
        learningsCount++;
      }
    }

    // 4. Performance tier distribution
    const tiers: Record<string, number> = {};
    for (const p of posts) {
      const tier = p.performance_tier || 'unclassified';
      tiers[tier] = (tiers[tier] || 0) + 1;
    }
    const tierInsight = `Performance distribution: ${Object.entries(tiers).map(([t, c]) => `${t}: ${c}`).join(', ')}`;
    insights.push(tierInsight);

    // 5. Growth velocity (recent vs older posts)
    if (posts.length >= 10) {
      const recent5 = posts.slice(0, 5);
      const older5 = posts.slice(-5);
      const recentAvg = recent5.reduce((s: number, p: any) => s + (p.engagement_rate || 0), 0) / 5;
      const olderAvg = older5.reduce((s: number, p: any) => s + (p.engagement_rate || 0), 0) / 5;
      const delta = recentAvg - olderAvg;
      
      const trend = delta > 0 ? 'improving' : delta < -0.5 ? 'declining' : 'stable';
      const insight = `Engagement trend: ${trend} (recent: ${recentAvg.toFixed(1)}%, older: ${olderAvg.toFixed(1)}%, Δ${delta > 0 ? '+' : ''}${delta.toFixed(1)}%)`;
      insights.push(insight);

      await this.db.addLearning({
        platform: platform || 'all',
        learning_type: 'trend',
        insight,
        confidence: 0.7,
        data_points: posts.length,
        raw_analysis: { recentAvg, olderAvg, delta, trend },
      });
      learningsCount++;
    }

    console.log(`  🧠 Analytics: ${learningsCount} learnings from ${posts.length} posts`);
    return { learnings: learningsCount, insights };
  }

  /**
   * Get a content brief based on learnings — tells the AI what to post next
   */
  async getContentBrief(platform?: Platform): Promise<{
    bestTime: string | null;
    bestFormat: string | null;
    topTopics: string[];
    avoidTopics: string[];
    engagementTrend: string;
    suggestions: string[];
  }> {
    const learnings = await this.db.getActiveLearnings(platform);
    
    const brief = {
      bestTime: null as string | null,
      bestFormat: null as string | null,
      topTopics: [] as string[],
      avoidTopics: [] as string[],
      engagementTrend: 'unknown',
      suggestions: [] as string[],
    };

    for (const l of learnings) {
      switch (l.learning_type) {
        case 'best_time':
          brief.bestTime = l.insight;
          break;
        case 'best_format':
          brief.bestFormat = l.insight;
          break;
        case 'best_topic':
          if (l.raw_analysis?.topHashtags) {
            brief.topTopics = l.raw_analysis.topHashtags.map((h: any) => h.tag);
          }
          break;
        case 'trend':
          brief.engagementTrend = l.raw_analysis?.trend || 'unknown';
          break;
      }
    }

    // Generate suggestions
    if (brief.engagementTrend === 'declining') {
      brief.suggestions.push('Try experimental content formats to reverse engagement decline');
    }
    if (brief.bestTime) {
      brief.suggestions.push(`Schedule posts around the optimal time window`);
    }
    if (brief.topTopics.length > 0) {
      brief.suggestions.push(`Focus on proven topics: ${brief.topTopics.slice(0, 3).join(', ')}`);
    }

    return brief;
  }
}
