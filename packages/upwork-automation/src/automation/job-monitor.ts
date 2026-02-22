/**
 * Upwork Job Monitor & Notification System
 * 
 * Periodically searches for new jobs matching user criteria,
 * scores them, and sends macOS notifications for good matches.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import { searchJobs, scoreJob } from './job-operations.js';
import type { UpworkJob, JobSearchConfig, JobScore } from './types.js';

const execAsync = promisify(exec);

// ─── Types ───────────────────────────────────────────────────

export interface JobWatchConfig {
  id: string;
  name: string;
  enabled: boolean;

  /** Search criteria */
  search: Partial<JobSearchConfig>;

  /** Scoring preferences */
  preferredSkills: string[];
  minBudget: number;
  minScore: number;

  /** Notification settings */
  notifyOnScore: 'apply' | 'maybe' | 'all';
  notifyMacOS: boolean;
  logToFile: boolean;
}

export interface SeenJob {
  id: string;
  title: string;
  url: string;
  score: number;
  recommendation: string;
  firstSeen: string;
  notified: boolean;
}

export interface MonitorState {
  watches: JobWatchConfig[];
  seenJobs: Record<string, SeenJob>;
  lastScan: string;
  scanCount: number;
  stats: {
    totalJobsSeen: number;
    totalNotified: number;
    totalApplyRecommended: number;
  };
}

export interface ScanResult {
  watchId: string;
  watchName: string;
  jobsFound: number;
  newJobs: number;
  notified: number;
  topJobs: Array<{
    title: string;
    url: string;
    score: number;
    recommendation: string;
    budget: string;
    skills: string[];
    reason: string;
  }>;
}

// ─── State Management ────────────────────────────────────────

const STATE_DIR = path.join(os.homedir(), '.upwork-monitor');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const LOG_FILE = path.join(STATE_DIR, 'job-alerts.log');

let monitorState: MonitorState = {
  watches: [],
  seenJobs: {},
  lastScan: '',
  scanCount: 0,
  stats: {
    totalJobsSeen: 0,
    totalNotified: 0,
    totalApplyRecommended: 0,
  },
};

async function loadState(): Promise<void> {
  try {
    await mkdir(STATE_DIR, { recursive: true });
    const data = await readFile(STATE_FILE, 'utf-8');
    monitorState = JSON.parse(data);
  } catch {
    // Fresh state
  }
}

async function saveState(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(monitorState, null, 2));
}

// ─── macOS Notifications ─────────────────────────────────────

async function sendMacNotification(title: string, message: string, url?: string): Promise<void> {
  const escapedTitle = title.replace(/"/g, '\\"');
  const escapedMsg = message.replace(/"/g, '\\"');

  let script = `display notification "${escapedMsg}" with title "${escapedTitle}" sound name "Glass"`;

  try {
    await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);
  } catch {
    console.log(`[Notify] Failed to send macOS notification: ${title}`);
  }
}

async function logAlert(job: UpworkJob, score: JobScore, watchName: string): Promise<void> {
  const budget = job.budget.amount || job.budget.max || job.budget.min || 0;
  const line = `[${new Date().toISOString()}] [${watchName}] ${score.recommendation.toUpperCase()} (${score.totalScore}) | $${budget} | ${job.title} | ${job.url}\n`;

  try {
    const { appendFile } = await import('fs/promises');
    await appendFile(LOG_FILE, line);
  } catch {
    console.log(line);
  }
}

// ─── Watch Management ────────────────────────────────────────

export async function addWatch(config: Omit<JobWatchConfig, 'id'>): Promise<JobWatchConfig> {
  await loadState();

  const watch: JobWatchConfig = {
    ...config,
    id: `watch_${Date.now()}`,
  };

  monitorState.watches.push(watch);
  await saveState();
  console.log(`[Monitor] Added watch "${watch.name}" (${watch.id})`);
  return watch;
}

export async function removeWatch(watchId: string): Promise<boolean> {
  await loadState();
  const idx = monitorState.watches.findIndex(w => w.id === watchId);
  if (idx === -1) return false;
  monitorState.watches.splice(idx, 1);
  await saveState();
  return true;
}

export async function updateWatch(watchId: string, updates: Partial<JobWatchConfig>): Promise<JobWatchConfig | null> {
  await loadState();
  const watch = monitorState.watches.find(w => w.id === watchId);
  if (!watch) return null;
  Object.assign(watch, updates);
  await saveState();
  return watch;
}

export async function listWatches(): Promise<JobWatchConfig[]> {
  await loadState();
  return monitorState.watches;
}

export async function getMonitorStatus(): Promise<{
  watches: number;
  enabledWatches: number;
  seenJobs: number;
  lastScan: string;
  scanCount: number;
  stats: MonitorState['stats'];
}> {
  await loadState();
  return {
    watches: monitorState.watches.length,
    enabledWatches: monitorState.watches.filter(w => w.enabled).length,
    seenJobs: Object.keys(monitorState.seenJobs).length,
    lastScan: monitorState.lastScan,
    scanCount: monitorState.scanCount,
    stats: monitorState.stats,
  };
}

// ─── Scan Logic ──────────────────────────────────────────────

export async function scanWatch(watch: JobWatchConfig): Promise<ScanResult> {
  console.log(`[Monitor] Scanning watch "${watch.name}"...`);

  const result: ScanResult = {
    watchId: watch.id,
    watchName: watch.name,
    jobsFound: 0,
    newJobs: 0,
    notified: 0,
    topJobs: [],
  };

  // Search for jobs
  const jobs = await searchJobs(watch.search);
  result.jobsFound = jobs.length;

  for (const job of jobs) {
    // Check if we've seen this job before
    const isNew = !monitorState.seenJobs[job.id];

    // Score the job
    const score = scoreJob(job, watch.preferredSkills, watch.minBudget);

    // Track seen jobs
    if (isNew) {
      result.newJobs++;
      monitorState.stats.totalJobsSeen++;

      monitorState.seenJobs[job.id] = {
        id: job.id,
        title: job.title,
        url: job.url,
        score: score.totalScore,
        recommendation: score.recommendation,
        firstSeen: new Date().toISOString(),
        notified: false,
      };

      if (score.recommendation === 'apply') {
        monitorState.stats.totalApplyRecommended++;
      }
    }

    // Check if job meets notification threshold
    const shouldNotify = isNew &&
      score.totalScore >= watch.minScore &&
      (watch.notifyOnScore === 'all' ||
       watch.notifyOnScore === 'maybe' && (score.recommendation === 'apply' || score.recommendation === 'maybe') ||
       watch.notifyOnScore === 'apply' && score.recommendation === 'apply');

    if (shouldNotify) {
      const budget = job.budget.amount || job.budget.max || job.budget.min || 0;
      const budgetStr = budget > 0 ? `$${budget}` : 'TBD';

      // Add to top jobs
      result.topJobs.push({
        title: job.title,
        url: job.url,
        score: score.totalScore,
        recommendation: score.recommendation,
        budget: budgetStr,
        skills: job.skills.slice(0, 5),
        reason: score.reason,
      });

      // Send macOS notification
      if (watch.notifyMacOS) {
        const emoji = score.recommendation === 'apply' ? '🎯' : '💡';
        await sendMacNotification(
          `${emoji} Upwork: ${score.recommendation.toUpperCase()} (${score.totalScore}/100)`,
          `${job.title}\n${budgetStr} • ${job.skills.slice(0, 3).join(', ')}`,
          job.url,
        );
      }

      // Log to file
      if (watch.logToFile) {
        await logAlert(job, score, watch.name);
      }

      monitorState.seenJobs[job.id].notified = true;
      monitorState.stats.totalNotified++;
      result.notified++;
    }
  }

  // Sort top jobs by score
  result.topJobs.sort((a, b) => b.score - a.score);

  console.log(`[Monitor] "${watch.name}": ${result.jobsFound} found, ${result.newJobs} new, ${result.notified} notified`);
  return result;
}

export async function scanAllWatches(): Promise<ScanResult[]> {
  await loadState();

  const enabledWatches = monitorState.watches.filter(w => w.enabled);
  if (enabledWatches.length === 0) {
    console.log('[Monitor] No enabled watches');
    return [];
  }

  const results: ScanResult[] = [];
  for (const watch of enabledWatches) {
    try {
      const result = await scanWatch(watch);
      results.push(result);
    } catch (e: any) {
      console.error(`[Monitor] Error scanning "${watch.name}": ${e.message}`);
    }
  }

  monitorState.lastScan = new Date().toISOString();
  monitorState.scanCount++;
  await saveState();

  return results;
}

// ─── Preset Watch Configs ────────────────────────────────────

export const PRESET_WATCHES: Record<string, Omit<JobWatchConfig, 'id'>> = {
  typescript_saas: {
    name: 'TypeScript SaaS Dev',
    enabled: true,
    search: {
      keywords: ['TypeScript', 'React', 'Node.js'],
      experienceLevel: ['intermediate', 'expert'],
      jobType: 'both',
      paymentVerified: true,
      sortBy: 'newest',
      postedWithin: '24h',
    },
    preferredSkills: ['TypeScript', 'React', 'Node.js', 'Next.js', 'PostgreSQL', 'Supabase', 'AWS'],
    minBudget: 500,
    minScore: 45,
    notifyOnScore: 'maybe',
    notifyMacOS: true,
    logToFile: true,
  },

  automation_ai: {
    name: 'AI & Automation',
    enabled: true,
    search: {
      keywords: ['AI automation', 'browser automation', 'web scraping'],
      experienceLevel: ['intermediate', 'expert'],
      jobType: 'both',
      paymentVerified: true,
      sortBy: 'newest',
      postedWithin: '24h',
    },
    preferredSkills: ['Python', 'TypeScript', 'AI', 'Automation', 'Puppeteer', 'Selenium', 'Web Scraping', 'API'],
    minBudget: 300,
    minScore: 40,
    notifyOnScore: 'maybe',
    notifyMacOS: true,
    logToFile: true,
  },

  fullstack_expert: {
    name: 'Full-Stack Expert',
    enabled: true,
    search: {
      keywords: ['full stack developer'],
      experienceLevel: ['expert'],
      jobType: 'both',
      paymentVerified: true,
      sortBy: 'newest',
      postedWithin: '24h',
      hourlyRateMin: 50,
    },
    preferredSkills: ['TypeScript', 'React', 'Node.js', 'Python', 'PostgreSQL', 'AWS', 'Docker'],
    minBudget: 1000,
    minScore: 50,
    notifyOnScore: 'apply',
    notifyMacOS: true,
    logToFile: true,
  },

  mobile_app: {
    name: 'React Native / Mobile',
    enabled: false,
    search: {
      keywords: ['React Native', 'Expo', 'mobile app'],
      experienceLevel: ['intermediate', 'expert'],
      jobType: 'both',
      paymentVerified: true,
      sortBy: 'newest',
      postedWithin: '24h',
    },
    preferredSkills: ['React Native', 'Expo', 'TypeScript', 'iOS', 'Android', 'Supabase'],
    minBudget: 500,
    minScore: 45,
    notifyOnScore: 'maybe',
    notifyMacOS: true,
    logToFile: true,
  },
};

// ─── Quick Setup ─────────────────────────────────────────────

export async function setupDefaultWatches(): Promise<JobWatchConfig[]> {
  await loadState();

  const added: JobWatchConfig[] = [];
  for (const [key, preset] of Object.entries(PRESET_WATCHES)) {
    // Don't add duplicates
    const exists = monitorState.watches.some(w => w.name === preset.name);
    if (!exists) {
      const watch = await addWatch(preset);
      added.push(watch);
    }
  }

  console.log(`[Monitor] Setup complete: ${added.length} watches added, ${monitorState.watches.length} total`);
  return added;
}
