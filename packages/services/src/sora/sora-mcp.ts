/**
 * Sora MCP Server — JSON-RPC 2.0 over stdio
 *
 * Wraps sora-full-automation.ts with:
 * - Safari tab claim (coordinates with other Safari services)
 * - Trends integration (pulls from market-research service :3106)
 * - Generation queue with daily tracking
 * - Maximize-mode: no time/day restrictions, just daily cap
 *
 * Start: npx tsx packages/services/src/sora/sora-mcp.ts
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

// ─── Tab Claim Guard ──────────────────────────────────────────────────────────
const CLAIMS_FILE = '/tmp/safari-tab-claims.json';
const CLAIM_TTL_MS = 60_000;
const MY_SERVICE = 'sora';
const MY_URL_PATTERN = 'sora.chatgpt.com';

interface TabClaim {
  agentId: string; service: string; port: number; urlPattern: string;
  windowIndex: number; tabIndex: number; tabUrl: string; pid: number;
  claimedAt: number; heartbeat: number;
}

async function readActiveClaims(): Promise<TabClaim[]> {
  try {
    const raw = fs.readFileSync(CLAIMS_FILE, 'utf-8');
    const all: TabClaim[] = JSON.parse(raw);
    const now = Date.now();
    return all.filter(c => (now - c.heartbeat) < CLAIM_TTL_MS);
  } catch { return []; }
}

async function writeClaims(claims: TabClaim[]): Promise<void> {
  fs.writeFileSync(CLAIMS_FILE, JSON.stringify(claims, null, 2));
}

async function acquireSoraClaim(): Promise<TabClaim | null> {
  // Find an open Sora tab in Safari via AppleScript
  const script = `
tell application "Safari"
  set result to {}
  repeat with w from 1 to count of windows
    repeat with t from 1 to count of tabs of window w
      try
        set u to URL of tab t of window w
        if u contains "sora.chatgpt.com" then
          set end of result to (w as string) & "," & (t as string) & "," & u
        end if
      end try
    end repeat
  end repeat
  return result
end tell`;
  try {
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    const lines = stdout.trim().split(', ').filter(Boolean);
    if (lines.length === 0) return null;

    const [wStr, tStr, url] = lines[0].split(',');
    const windowIndex = parseInt(wStr.trim());
    const tabIndex = parseInt(tStr.trim());

    const claims = await readActiveClaims();
    const agentId = `sora-${Date.now()}`;
    const myClaim: TabClaim = {
      agentId, service: MY_SERVICE, port: 0, urlPattern: MY_URL_PATTERN,
      windowIndex, tabIndex, tabUrl: url?.trim() || MY_URL_PATTERN,
      pid: process.pid, claimedAt: Date.now(), heartbeat: Date.now(),
    };
    // Remove any expired sora claims, add ours
    const filtered = claims.filter(c => c.service !== MY_SERVICE);
    await writeClaims([...filtered, myClaim]);
    return myClaim;
  } catch { return null; }
}

async function releaseSoraClaim(): Promise<void> {
  const claims = await readActiveClaims();
  await writeClaims(claims.filter(c => c.service !== MY_SERVICE));
}

async function checkConflict(): Promise<{ conflict: false } | { conflict: true; blocker: TabClaim }> {
  const claims = await readActiveClaims();
  const myClaim = claims.find(c => c.service === MY_SERVICE);
  if (!myClaim) return { conflict: false };
  const myTab = `${myClaim.windowIndex}:${myClaim.tabIndex}`;
  const blocker = claims.find(c => c.service !== MY_SERVICE && `${c.windowIndex}:${c.tabIndex}` === myTab);
  return blocker ? { conflict: true, blocker } : { conflict: false };
}

// ─── State: daily generation tracking ─────────────────────────────────────────
const STATE_FILE = path.join(__dirname, 'sora-mcp-state.json');
const DOWNLOAD_PATH = '/Users/isaiahdupree/Downloads/sora-videos';
const PASSPORT_BASE = '/Volumes/My Passport/Sora Videos';
const PASSPORT_PROCESSED = '/Volumes/My Passport/Sora Videos/processed';
const PASSPORT_TRILOGIES = '/Volumes/My Passport/Sora Videos/trilogies';

interface VideoRecord {
  id: string;              // internal ID (timestamp-based)
  soraVideoId?: string;    // extracted from Sora draftHref (e.g. /g/abc123 → abc123)
  prompt: string;
  rawPath: string;         // original download path
  passportPath?: string;   // copy on Passport drive
  processedPath?: string;  // watermark-removed version
  aiAnalysis?: string;     // Claude frame analysis
  youtubeUrl?: string;     // after upload
  trilogyId?: string;      // if part of a trilogy
  trilogyPart?: number;
  generatedAt: string;
}

interface SoraState {
  date: string;
  generatedToday: number;
  failedToday: number;
  maxPerDay: number;
  queue: Array<{ id: string; prompt: string; source: string; queuedAt: string; status: 'pending' | 'done' | 'failed' }>;
  videos: VideoRecord[];   // all-time video registry
  trilogies: Array<{
    id: string; title: string; concept: string;
    parts: Array<{ part: number; videoId: string; prompt: string }>;
    stitchedPath?: string; youtubeUrl?: string; status: 'generating' | 'stitching' | 'done';
    createdAt: string;
  }>;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadState(): SoraState {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const s: SoraState = JSON.parse(raw);
    if (s.date !== todayStr()) {
      // New day — reset counters, keep queue
      return { date: todayStr(), generatedToday: 0, failedToday: 0, maxPerDay: s.maxPerDay || 10, queue: s.queue || [] };
    }
    return s;
  } catch {
    return { date: todayStr(), generatedToday: 0, failedToday: 0, maxPerDay: 10, queue: [], videos: [], trilogies: [] };
  }
}

function saveState(s: SoraState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ─── Automation: run sora-full-automation via subprocess ──────────────────────

async function runSoraGenerate(prompt: string): Promise<{
  success: boolean; filePath?: string; fileSize?: number;
  prompt: string; totalTimeMs?: number; error?: string; draftHref?: string;
}> {
  const scriptPath = path.join(__dirname, 'run-sora-generate.ts');
  if (!fs.existsSync(scriptPath)) {
    // Create a thin runner script
    fs.writeFileSync(scriptPath, `
import { SoraFullAutomation } from './sora-full-automation';
const prompt = process.argv[2];
if (!prompt) { console.error('No prompt'); process.exit(1); }
const sora = new SoraFullAutomation();
sora.fullRun(prompt).then(r => { console.log(JSON.stringify(r)); }).catch(e => { console.error(JSON.stringify({ error: e.message })); process.exit(1); });
`);
  }

  const safePrompt = prompt.replace(/'/g, "'\\''").replace(/"/g, '\\"');
  try {
    const { stdout, stderr } = await execAsync(
      `npx tsx "${scriptPath}" "${safePrompt}"`,
      { cwd: path.resolve(__dirname, '../../../../../'), timeout: 20 * 60 * 1000 }
    );
    const result = JSON.parse(stdout.trim().split('\n').pop() || '{}');
    return {
      success: result.download?.success || false,
      filePath: result.download?.filePath,
      fileSize: result.download?.fileSize,
      prompt: result.submit?.prompt || prompt,
      totalTimeMs: result.totalTimeMs,
      draftHref: result.poll?.draftHref,
      error: result.download?.error || result.submit?.error || result.poll?.error,
    };
  } catch (e) {
    return { success: false, prompt, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Telegram helper ──────────────────────────────────────────────────────────
const ACTP_ENV_FILE = '/Users/isaiahdupree/Documents/Software/actp-worker/.env';

function loadTelegramEnv(): { token: string; chat: string } | null {
  try {
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(ACTP_ENV_FILE, 'utf-8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    const token = env['TELEGRAM_BOT_TOKEN'] || process.env.TELEGRAM_BOT_TOKEN || '';
    const chat = env['TELEGRAM_CHAT_ID'] || process.env.TELEGRAM_CHAT_ID || '';
    return token && chat ? { token, chat } : null;
  } catch { return null; }
}

async function telegramSendVideo(filePath: string, caption: string): Promise<void> {
  const creds = loadTelegramEnv();
  if (!creds || !fs.existsSync(filePath)) return;
  try {
    await execAsync(
      `curl -s -X POST "https://api.telegram.org/bot${creds.token}/sendVideo" -F "chat_id=${creds.chat}" -F "video=@${filePath}" -F "caption=${caption.replace(/"/g, '\\"')}"`,
      { timeout: 60000 }
    );
  } catch {}
}

async function telegramSendText(text: string): Promise<void> {
  const creds = loadTelegramEnv();
  if (!creds) return;
  try {
    await execAsync(
      `curl -s -X POST "https://api.telegram.org/bot${creds.token}/sendMessage" -H "Content-Type: application/json" -d '${JSON.stringify({ chat_id: creds.chat, text }).replace(/'/g, "'\\''")}'`,
      { timeout: 10000 }
    );
  } catch {}
}

// ─── Trends: read from local research files + :3106 API ───────────────────────
const RESEARCH_DIR = '/Users/isaiahdupree/Documents/market-research';
const RESEARCH_BASE = 'http://localhost:3106';

interface ResearchCreator {
  handle?: string; niche?: string; bio?: string; followers?: number;
  avgEngagement?: number; topPosts?: Array<{ text?: string; caption?: string; likes?: number; hashtags?: string[] }>;
}

function readLocalResearchFiles(platform: string, limit = 3): ResearchCreator[] {
  const dir = path.join(RESEARCH_DIR, platform);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort().reverse()
    .slice(0, limit);

  const creators: ResearchCreator[] = [];
  for (const file of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      const all: ResearchCreator[] = d.allCreators || [];
      creators.push(...all.filter(c => (c.topPosts?.length || 0) > 0).slice(0, 20));
    } catch {}
  }
  return creators;
}

function extractNichesFromCreators(creators: ResearchCreator[]): Array<{ niche: string; avg_engagement: number; platforms: string[] }> {
  const nicheMap: Record<string, { engagement: number; count: number; platforms: Set<string> }> = {};
  for (const c of creators) {
    const niche = c.niche || 'ai automation';
    if (!nicheMap[niche]) nicheMap[niche] = { engagement: 0, count: 0, platforms: new Set() };
    nicheMap[niche].engagement += c.avgEngagement || 0;
    nicheMap[niche].count++;
    nicheMap[niche].platforms.add('instagram');
  }
  return Object.entries(nicheMap)
    .map(([niche, s]) => ({ niche, avg_engagement: Math.round(s.engagement / s.count), platforms: Array.from(s.platforms) }))
    .sort((a, b) => b.avg_engagement - a.avg_engagement);
}

function extractTopCaptionKeywords(creators: ResearchCreator[]): string[] {
  const keywords = new Set<string>();
  const highValueTerms = ['AI', 'SaaS', 'automation', 'founder', 'build in public', 'startup', 'content creator', 'indie dev', 'vibe coding', 'AI tools', 'passive income'];
  for (const c of creators) {
    for (const p of (c.topPosts || []).slice(0, 2)) {
      const text = (p.text || p.caption || '').toLowerCase();
      for (const term of highValueTerms) {
        if (text.includes(term.toLowerCase())) keywords.add(term);
      }
    }
  }
  return Array.from(keywords).slice(0, 8);
}

async function fetchTrends(platform: string): Promise<Array<{ niche: string; avg_engagement: number; platforms: string[] }>> {
  // Try :3106 first, fall back to local files
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${RESEARCH_BASE}/api/research/trends`, { signal: ctrl.signal });
    if (res.ok) {
      const data = await res.json() as { trends?: Array<{ niche: string; avg_engagement: number; platforms: string[] }> };
      if (data.trends?.length) return data.trends;
    }
  } catch {}

  // Fall back to reading local research files
  const platforms = ['instagram', 'tiktok', 'threads'];
  const allCreators: ResearchCreator[] = [];
  for (const p of platforms) {
    allCreators.push(...readLocalResearchFiles(p));
  }
  if (allCreators.length > 0) return extractNichesFromCreators(allCreators);

  // Final fallback: hardcoded niches from business-goals
  return [
    { niche: 'ai automation', avg_engagement: 5000, platforms: ['instagram', 'tiktok'] },
    { niche: 'saas growth', avg_engagement: 3000, platforms: ['threads', 'twitter'] },
    { niche: 'content creation', avg_engagement: 4000, platforms: ['instagram', 'tiktok'] },
    { niche: 'build in public', avg_engagement: 2500, platforms: ['twitter', 'threads'] },
    { niche: 'indie dev', avg_engagement: 2000, platforms: ['threads'] },
  ];
}

async function fetchTrendingKeywords(platform: string): Promise<string[]> {
  // Read from local research files
  const creators = readLocalResearchFiles(platform);
  const keywords = extractTopCaptionKeywords(creators);
  return keywords.length ? keywords : ['AI automation', 'SaaS', 'build in public', 'creator economy', 'content strategy'];
}

function trendsToPrompts(
  trends: Array<{ niche: string; avg_engagement: number; platforms: string[] }>,
  keywords: string[],
  count = 5
): string[] {
  const top = trends.slice(0, count);
  const kws = keywords.length ? keywords : ['AI automation', 'SaaS', 'creator'];

  const templates = [
    (niche: string, kw: string) => `cinematic close-up of a ${niche} creator recording content, golden hour lighting, satisfying and aspirational — ${kw} aesthetic, ultra-realistic 4K`,
    (niche: string, kw: string) => `dramatic reveal of ${niche} results — metrics climbing, dashboard lighting up, celebration moment, ${kw} success story, vibrant colors`,
    (niche: string, kw: string) => `satisfying ${niche} workflow process video, clean minimal desk setup, focused productive energy, ASMR-style, ${kw} aesthetic`,
    (niche: string, kw: string) => `inspiring ${niche} founder story montage — from laptop to success, fast cuts, motivational energy, ${kw} journey, cinematic`,
    (niche: string, kw: string) => `aesthetic modern workspace with ${niche} tools on screen, morning light through window, coffee steam, ${kw} lifestyle, cozy and productive`,
    (niche: string, kw: string) => `before and after ${niche} transformation split screen — manual chaos vs automated clarity, ${kw} power, satisfying reveal`,
    (niche: string, kw: string) => `time-lapse of ${niche} project being built — code appearing, design taking shape, progress bars, ${kw} creation process`,
  ];

  return top.map((t, i) => {
    const kw = kws[i % kws.length];
    return templates[i % templates.length](t.niche, kw);
  });
}

// ─── MCP Protocol ─────────────────────────────────────────────────────────────
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'sora-safari-automation';
const SERVER_VERSION = '1.0.0';

const TOOLS = [
  {
    name: 'sora_generate',
    description: 'Generate a Sora video from a prompt. Claims the Safari Sora tab, submits the prompt, polls until done, downloads the MP4, and auto-sends to Telegram. Returns file path when complete.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Video generation prompt (do not include @isaiahdupree prefix — it is added automatically)' },
        skip_claim_check: { type: 'boolean', description: 'Skip Safari tab conflict check (default false)' },
        send_telegram: { type: 'boolean', description: 'Auto-send completed video to Telegram (default true)' },
        skip_youtube: { type: 'boolean', description: 'Skip YouTube upload (default false)' },
        youtube_title: { type: 'string', description: 'Custom YouTube title (default: auto-generated from AI analysis)' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'sora_queue_batch',
    description: 'Add multiple prompts to the generation queue. Runs them sequentially with the rate limit (maxPerDay). Use sora_status to track progress.',
    inputSchema: {
      type: 'object',
      properties: {
        prompts: { type: 'array', items: { type: 'string' }, description: 'List of video prompts to queue' },
        source: { type: 'string', description: 'Label for this batch (e.g. "trends-2026-03-05", "manual")' },
      },
      required: ['prompts'],
    },
  },
  {
    name: 'sora_get_trends',
    description: 'Fetch trending topics from the market research service and generate optimized Sora video prompts ready to queue. Returns prompts + raw trend data.',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of prompts to generate (default 5, max 10)' },
        platform: { type: 'string', enum: ['tiktok', 'instagram', 'twitter'], description: 'Platform for hashtag trends (default tiktok)' },
        auto_queue: { type: 'boolean', description: 'Automatically add generated prompts to the queue (default false)' },
      },
    },
  },
  {
    name: 'sora_status',
    description: 'Get Sora generation status: today\'s count, daily limit, pending queue, and list of available outputs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sora_list_outputs',
    description: 'List downloaded Sora MP4 files in the output directory with file sizes and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max files to return (default 20)' },
      },
    },
  },
  {
    name: 'sora_claim_status',
    description: 'Read /tmp/safari-tab-claims.json — shows all active Safari tab claims and whether the Sora tab is currently claimed or in conflict.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sora_config',
    description: 'Read or update Sora MCP configuration (maxPerDay limit, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        max_per_day: { type: 'number', description: 'Max videos to generate per day (1-50). Increase to maximize output.' },
      },
    },
  },
  {
    name: 'sora_drain_queue',
    description: 'Run all pending queue items sequentially, up to the remaining daily limit. Auto-sends each completed video to Telegram. Use sora_get_trends(auto_queue:true) to fill the queue first.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sora_generate_trilogy',
    description: 'Generate a multi-part video series (trilogy or more). Generates each part sequentially, removes watermarks, stitches into one video, uploads to YouTube, sends to Telegram. Use for story arcs, how-to series, before/after sequences.',
    inputSchema: {
      type: 'object',
      properties: {
        concept: { type: 'string', description: 'Overall trilogy title/concept, e.g. "AI Founder Journey"' },
        parts: {
          type: 'array',
          description: 'Each part of the trilogy (2-5 parts)',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Part title, e.g. "Chapter 1: The Problem"' },
              prompt: { type: 'string', description: 'Sora generation prompt for this part' },
            },
            required: ['title', 'prompt'],
          },
        },
        skip_youtube: { type: 'boolean', description: 'Skip YouTube upload (default false)' },
      },
      required: ['concept', 'parts'],
    },
  },
  {
    name: 'sora_process_video',
    description: 'Run post-processing on an already-generated video: copy to Passport drive, remove watermark with ffmpeg, run Claude AI analysis, optionally upload to YouTube.',
    inputSchema: {
      type: 'object',
      properties: {
        video_id: { type: 'string', description: 'Internal video ID from sora_list_videos' },
        file_path: { type: 'string', description: 'Direct file path if video_id is not known' },
        skip_youtube: { type: 'boolean', description: 'Skip YouTube upload (default false)' },
        youtube_title: { type: 'string', description: 'Custom YouTube title (default: auto-generated from AI analysis)' },
      },
    },
  },
  {
    name: 'sora_list_videos',
    description: 'List all tracked videos with their processing status — Passport copy, watermark removal, AI analysis, YouTube URL, trilogy membership.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max videos to return (default 20)' },
        trilogy_id: { type: 'string', description: 'Filter by trilogy ID' },
      },
    },
  },
  {
    name: 'sora_batch_clean',
    description: 'Bulk watermark removal on a folder of raw Sora MP4 files. Scans input_dir for .mp4 files, applies drawbox watermark removal via ffmpeg, saves cleaned files to output_dir. Skips files already cleaned. Copies to Passport drive if mounted.',
    inputSchema: {
      type: 'object',
      properties: {
        input_dir: { type: 'string', description: 'Directory of raw Sora MP4s (default: ~/Downloads/sora-videos)' },
        output_dir: { type: 'string', description: 'Directory for cleaned MP4s (default: ~/Downloads/sora-videos/cleaned)' },
        limit: { type: 'number', description: 'Max files to process in this run (default 20, 0 = all)' },
        skip_passport: { type: 'boolean', description: 'Skip copying to Passport drive (default false)' },
      },
    },
  },
];

// ─── Video Pipeline: Passport copy, watermark removal, AI analysis, YouTube ───

function extractSoraVideoId(draftHref?: string): string | undefined {
  if (!draftHref) return undefined;
  // Sora URLs: /g/abc123def or /d/gen/abc123def
  const m = draftHref.match(/\/(?:g|gen)\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : draftHref.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || undefined;
}

function ensureDir(dir: string): boolean {
  try { fs.mkdirSync(dir, { recursive: true }); return true; } catch { return false; }
}

async function copyToPassport(srcPath: string, videoId: string, subfolder = ''): Promise<string | null> {
  const destDir = subfolder ? path.join(PASSPORT_BASE, subfolder) : PASSPORT_BASE;
  if (!ensureDir(destDir)) return null;
  const ext = path.extname(srcPath);
  const destPath = path.join(destDir, `${videoId}${ext}`);
  try {
    fs.copyFileSync(srcPath, destPath);
    return destPath;
  } catch { return null; }
}

async function removeWatermark(inputPath: string, outputPath: string): Promise<boolean> {
  // Sora watermark is bottom strip on all output formats
  // Strategy 1: drawbox black fill (most reliable — works on any codec)
  // Strategy 2: delogo (fallback — requires compatible codec)
  try {
    const probeCmd = `ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height -of json "${inputPath}"`;
    const { stdout } = await execAsync(probeCmd);
    const info = JSON.parse(stdout);
    const height: number = info.streams?.[0]?.height || 1080;
    const width: number = info.streams?.[0]?.width || 1920;
    const wmH = Math.ceil(height * 0.085); // 8.5% covers Sora watermark bar
    const wmY = height - wmH;
    ensureDir(path.dirname(outputPath));

    // Primary: drawbox (solid black) — works on H.264/H.265/VP9/AV1
    const drawboxCmd = `ffmpeg -i "${inputPath}" -vf "drawbox=x=0:y=${wmY}:w=${width}:h=${wmH}:color=black@1.0:t=fill" -c:v libx264 -crf 18 -preset fast -c:a copy -y "${outputPath}"`;
    try {
      await execAsync(drawboxCmd, { timeout: 180000 });
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return true;
    } catch {}

    // Fallback: delogo filter
    const delogoCmd = `ffmpeg -i "${inputPath}" -vf "delogo=x=0:y=${wmY}:w=${width}:h=${wmH}:show=0" -c:a copy -y "${outputPath}"`;
    try {
      await execAsync(delogoCmd, { timeout: 120000 });
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return true;
    } catch {}

    return false;
  } catch { return false; }
}

async function extractFrameForAnalysis(videoPath: string): Promise<string | null> {
  const framePath = videoPath.replace(/\.mp4$/, '-frame.jpg');
  try {
    await execAsync(`ffmpeg -i "${videoPath}" -ss 00:00:01 -vframes 1 -q:v 2 -y "${framePath}" 2>/dev/null`, { timeout: 30000 });
    return fs.existsSync(framePath) ? framePath : null;
  } catch { return null; }
}

const SAFARI_ENV_FILE = '/Users/isaiahdupree/Documents/Software/Safari Automation/.env';

function loadEnvFiles(...envFiles: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const envFile of envFiles) {
    try {
      for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m) {
          const key = m[1].trim();
          if (!env[key]) env[key] = m[2].trim().replace(/^['"]|['"]$/g, '');
        }
      }
    } catch {}
  }
  return env;
}

async function analyzeVideoWithClaude(videoPath: string, prompt: string): Promise<string> {
  // Extract frame, then call Claude vision API
  const framePath = await extractFrameForAnalysis(videoPath);
  if (!framePath) return 'Frame extraction failed — cannot analyze';

  // Load env from multiple sources: actp-worker first, then Safari Automation
  const env = loadEnvFiles(ACTP_ENV_FILE, SAFARI_ENV_FILE);
  const apiKey = env['ANTHROPIC_API_KEY'] || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 'ANTHROPIC_API_KEY not found — skipping AI analysis';

  try {
    const imageData = fs.readFileSync(framePath).toString('base64');
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageData } },
          { type: 'text', text: `Analyze this Sora AI video frame. Original prompt: "${prompt.slice(0, 100)}"\n\nProvide: 1) Scene description (2 sentences) 2) Visual quality rating (1-10) 3) Suggested YouTube title (max 70 chars) 4) 5 YouTube tags. Be concise.` }
        ]
      }]
    });

    const { stdout } = await execAsync(
      `curl -s -X POST "https://api.anthropic.com/v1/messages" -H "x-api-key: ${apiKey}" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" -d '${body.replace(/'/g, "'\\''")}'`,
      { timeout: 30000 }
    );
    const resp = JSON.parse(stdout);
    return resp.content?.[0]?.text || 'No analysis returned';
  } catch (e) {
    return `Analysis error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function uploadToYouTube(filePath: string, title: string, description: string): Promise<{ success: boolean; url?: string; error?: string }> {
  // Pipeline: local file → Supabase Storage (get public URL) → Blotato /v2/posts
  // Blotato /v2/media does NOT accept direct file uploads — needs a URL
  const env = loadEnvFiles(ACTP_ENV_FILE, SAFARI_ENV_FILE);

  const blaKey = env['BLOTATO_API_KEY'] || process.env.BLOTATO_API_KEY;
  const ytAccountId = env['YOUTUBE_ACCOUNT_ID'] || process.env.YOUTUBE_ACCOUNT_ID || '228';
  const supabaseUrl = env['SUPABASE_URL'] || process.env.SUPABASE_URL;
  const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'] || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!blaKey) return { success: false, error: 'BLOTATO_API_KEY not found' };
  if (!supabaseUrl || !supabaseKey) return { success: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found' };
  if (!fs.existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` };

  try {
    // Step 1: Upload to Supabase Storage → public URL
    const filename = `sora-${Date.now()}-${path.basename(filePath)}`;
    const bucket = 'sora-videos';
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${filename}`;
    const fileBuffer = fs.readFileSync(filePath);
    const supaUploadCmd = `curl -s -X PUT "${uploadUrl}" \
      -H "Authorization: Bearer ${supabaseKey}" \
      -H "Content-Type: video/mp4" \
      --data-binary @"${filePath}"`;
    await execAsync(supaUploadCmd, { timeout: 300000 });
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${filename}`;

    // Step 2: Register URL with Blotato media endpoint to get their CDN URL
    const mediaBody = JSON.stringify({ url: publicUrl });
    const mediaCmd = `curl -s -X POST "https://backend.blotato.com/v2/media" \
      -H "blotato-api-key: ${blaKey}" \
      -H "Content-Type: application/json" \
      -d '${mediaBody.replace(/'/g, "'\\''")}'`;
    const { stdout: mediaOut } = await execAsync(mediaCmd, { timeout: 60000 });
    let blotatoMediaUrl = publicUrl;
    try {
      const mediaResp = JSON.parse(mediaOut);
      if (mediaResp.url) blotatoMediaUrl = mediaResp.url;
    } catch {}

    // Step 3: Post to YouTube via Blotato (correct v2 payload format)
    const postBody = JSON.stringify({
      post: {
        accountId: ytAccountId,
        content: {
          platform: 'youtube',
          text: `${title}\n\n${description}`,
          mediaUrls: [blotatoMediaUrl]
        },
        target: {
          targetType: 'youtube',
          title: title.slice(0, 100),
          privacyStatus: 'public',
          shouldNotifySubscribers: true
        }
      }
    });
    const postCmd = `curl -s -X POST "https://backend.blotato.com/v2/posts" \
      -H "blotato-api-key: ${blaKey}" \
      -H "Content-Type: application/json" \
      -d '${postBody.replace(/'/g, "'\\''")}'`;
    const { stdout: postOut } = await execAsync(postCmd, { timeout: 30000 });
    const postResp = JSON.parse(postOut);
    if (postResp.statusCode >= 400 || postResp.error) {
      return { success: false, error: `Blotato error: ${JSON.stringify(postResp).slice(0, 200)}` };
    }
    const postId = postResp.id || postResp.post_id;
    return { success: true, url: `https://blotato.com/posts/${postId}` };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function stitchTrilogy(parts: string[], outputPath: string): Promise<boolean> {
  ensureDir(path.dirname(outputPath));
  // Create ffmpeg concat list
  const listPath = outputPath.replace(/\.mp4$/, '-list.txt');
  fs.writeFileSync(listPath, parts.map(p => `file '${p}'`).join('\n'));
  try {
    await execAsync(`ffmpeg -f concat -safe 0 -i "${listPath}" -c copy -y "${outputPath}" 2>/dev/null`, { timeout: 300000 });
    fs.unlinkSync(listPath);
    return fs.existsSync(outputPath);
  } catch {
    try { fs.unlinkSync(listPath); } catch {}
    return false;
  }
}

// ─── Full post-processing pipeline for a single video ────────────────────────
async function processVideoFull(opts: {
  rawPath: string; prompt: string; videoId: string;
  skipYoutube?: boolean; youtubeTitle?: string;
}): Promise<{
  passportPath: string | null; processedPath: string | null;
  analysis: string; youtubeResult?: { success: boolean; url?: string; error?: string };
}> {
  const { rawPath, prompt, videoId } = opts;

  // 1. Copy raw to Passport
  const passportPath = await copyToPassport(rawPath, videoId, 'raw');

  // 2. Watermark removal → save processed to Passport
  const processedDir = PASSPORT_PROCESSED;
  ensureDir(processedDir);
  const processedPath = path.join(processedDir, `${videoId}-clean.mp4`);
  const wmOk = await removeWatermark(rawPath, processedPath);

  // 3. AI analysis on processed (or raw if processing failed)
  const analyzeTarget = wmOk ? processedPath : rawPath;
  const analysis = await analyzeVideoWithClaude(analyzeTarget, prompt);

  // 4. YouTube upload (optional)
  let youtubeResult: { success: boolean; url?: string; error?: string } | undefined;
  if (!opts.skipYoutube) {
    const ytTitle = opts.youtubeTitle || `AI Video — ${prompt.slice(0, 50)}`;
    const ytDesc = `${prompt}\n\nGenerated with Sora AI\n\nAnalysis:\n${analysis.slice(0, 300)}`;
    youtubeResult = await uploadToYouTube(wmOk ? processedPath : rawPath, ytTitle, ytDesc);
  }

  return {
    passportPath: passportPath || (wmOk ? processedPath : null),
    processedPath: wmOk ? processedPath : null,
    analysis,
    youtubeResult,
  };
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

async function handleSoraGenerate(args: { prompt: string; skip_claim_check?: boolean; send_telegram?: boolean; skip_youtube?: boolean; youtube_title?: string; trilogyId?: string; trilogyPart?: number }): Promise<string> {
  const state = loadState();
  const sendTg = args.send_telegram !== false; // default true

  if (state.generatedToday >= state.maxPerDay) {
    return JSON.stringify({
      success: false,
      error: `Daily limit reached (${state.generatedToday}/${state.maxPerDay}). Increase limit with sora_config or wait until tomorrow.`,
      generated_today: state.generatedToday,
      max_per_day: state.maxPerDay,
    });
  }

  // Check Safari tab conflict
  if (!args.skip_claim_check) {
    const conflict = await checkConflict();
    if (conflict.conflict) {
      return JSON.stringify({
        success: false,
        error: `Safari tab conflict: ${conflict.blocker.service} is using the same tab (window ${conflict.blocker.windowIndex}, tab ${conflict.blocker.tabIndex}). Wait for it to finish or use sora_claim_status to investigate.`,
        blocker: conflict.blocker,
      });
    }
  }

  const claim = await acquireSoraClaim();

  try {
    const result = await runSoraGenerate(args.prompt);

    if (result.success && result.filePath) {
      state.generatedToday++;

      // Extract Sora video ID from draft href
      const soraVideoId = extractSoraVideoId(result.draftHref);
      const internalId = `vid-${Date.now()}`;

      // Build video record
      const videoRecord: VideoRecord = {
        id: internalId,
        soraVideoId,
        prompt: args.prompt,
        rawPath: result.filePath,
        generatedAt: new Date().toISOString(),
        trilogyId: (args as { trilogyId?: string; trilogyPart?: number }).trilogyId,
        trilogyPart: (args as { trilogyId?: string; trilogyPart?: number }).trilogyPart,
      };

      // Full post-processing pipeline
      const skipYt = args.skip_youtube ?? false;
      const pipeline = await processVideoFull({
        rawPath: result.filePath,
        prompt: args.prompt,
        videoId: soraVideoId || internalId,
        skipYoutube: skipYt,
        youtubeTitle: args.youtube_title,
      });

      videoRecord.passportPath = pipeline.passportPath || undefined;
      videoRecord.processedPath = pipeline.processedPath || undefined;
      videoRecord.aiAnalysis = pipeline.analysis;
      videoRecord.youtubeUrl = pipeline.youtubeResult?.url;

      if (!state.videos) state.videos = [];
      state.videos.push(videoRecord);

      // Telegram — send processed video if available
      if (sendTg) {
        const elapsed = Math.round((result.totalTimeMs || 0) / 1000);
        const sendPath = pipeline.processedPath || result.filePath;
        const caption = `Sora video (${elapsed}s) | ID: ${soraVideoId || internalId}\n${args.prompt.slice(0, 100)}\n\nAnalysis: ${pipeline.analysis.slice(0, 120)}`;
        await telegramSendVideo(sendPath, caption);
      }

      saveState(state);
      await releaseSoraClaim();
      return JSON.stringify({
        success: true,
        video_id: internalId,
        sora_video_id: soraVideoId,
        raw_path: result.filePath,
        passport_path: pipeline.passportPath,
        processed_path: pipeline.processedPath,
        ai_analysis: pipeline.analysis,
        youtube: pipeline.youtubeResult,
        telegram_sent: sendTg,
        generated_today: state.generatedToday,
        remaining_today: Math.max(0, state.maxPerDay - state.generatedToday),
      });
    } else {
      state.failedToday++;
      if (sendTg) await telegramSendText(`Sora generation failed: ${result.error?.slice(0, 100)}`);
      saveState(state);
      await releaseSoraClaim();
      return JSON.stringify({ success: false, error: result.error, generated_today: state.generatedToday });
    }
  } catch (e) {
    await releaseSoraClaim();
    state.failedToday++;
    saveState(state);
    return JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) });
  }
}

async function handleSoraQueueBatch(args: { prompts: string[]; source?: string }): Promise<string> {
  const state = loadState();
  const source = args.source || 'manual';
  const added: string[] = [];

  for (const prompt of args.prompts) {
    const item = {
      id: `sora-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      prompt,
      source,
      queuedAt: new Date().toISOString(),
      status: 'pending' as const,
    };
    state.queue.push(item);
    added.push(item.id);
  }

  saveState(state);
  return JSON.stringify({
    queued: added.length,
    ids: added,
    total_pending: state.queue.filter(q => q.status === 'pending').length,
    generated_today: state.generatedToday,
    remaining_today: Math.max(0, state.maxPerDay - state.generatedToday),
    note: 'Use sora_generate to run the next queued prompt, or run them manually one at a time.',
  });
}

async function handleSoraGetTrends(args: { count?: number; platform?: string; auto_queue?: boolean }): Promise<string> {
  const count = Math.min(args.count || 5, 10);
  const platform = args.platform || 'tiktok';

  const [trends, keywords] = await Promise.all([
    fetchTrends(platform),
    fetchTrendingKeywords(platform),
  ]);

  const prompts = trendsToPrompts(trends, keywords, count);

  if (args.auto_queue && prompts.length > 0) {
    const state = loadState();
    const source = `trends-${platform}-${todayStr()}`;
    for (const p of prompts) {
      state.queue.push({
        id: `sora-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        prompt: p,
        source,
        queuedAt: new Date().toISOString(),
        status: 'pending',
      });
    }
    saveState(state);
  }

  return JSON.stringify({
    success: true,
    data_source: trends.length > 0 ? 'local_research_files' : 'fallback_defaults',
    trend_count: trends.length,
    keyword_count: keywords.length,
    top_trends: trends.slice(0, 10).map(t => ({ niche: t.niche, engagement: t.avg_engagement, platforms: t.platforms })),
    top_keywords: keywords.slice(0, 10),
    generated_prompts: prompts,
    auto_queued: args.auto_queue ? prompts.length : 0,
    next_step: args.auto_queue
      ? `${prompts.length} prompts queued. Run sora_drain_queue to process all.`
      : 'Copy a prompt and run sora_generate, or set auto_queue:true then run sora_drain_queue.',
  });
}

async function handleSoraProcessVideo(args: { video_id?: string; file_path?: string; skip_youtube?: boolean; youtube_title?: string }): Promise<string> {
  const state = loadState();
  let rawPath = args.file_path;
  let prompt = 'Unknown prompt';
  let videoId = args.video_id || `manual-${Date.now()}`;

  if (args.video_id && !rawPath) {
    const rec = (state.videos || []).find(v => v.id === args.video_id || v.soraVideoId === args.video_id);
    if (rec) { rawPath = rec.rawPath; prompt = rec.prompt; videoId = rec.soraVideoId || rec.id; }
  }
  if (!rawPath) return JSON.stringify({ success: false, error: 'Provide video_id or file_path' });
  if (!fs.existsSync(rawPath)) return JSON.stringify({ success: false, error: `File not found: ${rawPath}` });

  const pipeline = await processVideoFull({ rawPath, prompt, videoId, skipYoutube: args.skip_youtube, youtubeTitle: args.youtube_title });

  // Update video record
  const idx = (state.videos || []).findIndex(v => v.rawPath === rawPath);
  if (idx !== -1) {
    state.videos[idx].passportPath = pipeline.passportPath || state.videos[idx].passportPath;
    state.videos[idx].processedPath = pipeline.processedPath || state.videos[idx].processedPath;
    state.videos[idx].aiAnalysis = pipeline.analysis;
    state.videos[idx].youtubeUrl = pipeline.youtubeResult?.url || state.videos[idx].youtubeUrl;
    saveState(state);
  }

  return JSON.stringify({ success: true, ...pipeline });
}

async function handleSoraGenerateTrilogy(args: { concept: string; parts: Array<{ title: string; prompt: string }>; skip_youtube?: boolean }): Promise<string> {
  if (!args.parts || args.parts.length < 2) {
    return JSON.stringify({ success: false, error: 'Provide at least 2 parts for a trilogy (or multi-part series)' });
  }

  const trilogyId = `trilogy-${Date.now()}`;
  const state = loadState();
  if (!state.trilogies) state.trilogies = [];

  const trilogyRecord = {
    id: trilogyId, title: args.concept, concept: args.concept,
    parts: [] as Array<{ part: number; videoId: string; prompt: string }>,
    status: 'generating' as const, createdAt: new Date().toISOString(),
  };
  state.trilogies.push(trilogyRecord);
  saveState(state);

  await telegramSendText(`Trilogy started: "${args.concept}" — ${args.parts.length} parts queued`);

  const partPaths: string[] = [];
  const partResults: Array<{ part: number; success: boolean; videoId?: string; error?: string }> = [];

  for (let i = 0; i < args.parts.length; i++) {
    const part = args.parts[i];
    const fullPrompt = `${part.title}: ${part.prompt}`;

    const genResult = JSON.parse(await handleSoraGenerate({
      prompt: fullPrompt,
      send_telegram: true,
      skip_youtube: true,  // Upload the stitched version, not individual parts
      trilogyId,
      trilogyPart: i + 1,
    } as Parameters<typeof handleSoraGenerate>[0]));

    if (genResult.success && (genResult.processed_path || genResult.raw_path)) {
      const vidPath = genResult.processed_path || genResult.raw_path;
      partPaths.push(vidPath);
      trilogyRecord.parts.push({ part: i + 1, videoId: genResult.video_id, prompt: fullPrompt });
      partResults.push({ part: i + 1, success: true, videoId: genResult.video_id });
    } else {
      partResults.push({ part: i + 1, success: false, error: genResult.error });
    }

    // Pause between parts
    if (i < args.parts.length - 1) await new Promise(r => setTimeout(r, 5000));
  }

  // Stitch if we have multiple successful parts
  let stitchedPath: string | null = null;
  let youtubeResult: { success: boolean; url?: string; error?: string } | undefined;

  if (partPaths.length >= 2) {
    ensureDir(PASSPORT_TRILOGIES);
    const slug = args.concept.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    stitchedPath = path.join(PASSPORT_TRILOGIES, `${trilogyId}-${slug}.mp4`);
    const stitchOk = await stitchTrilogy(partPaths, stitchedPath);
    if (!stitchOk) stitchedPath = null;

    if (stitchedPath && !args.skip_youtube) {
      const ytTitle = `${args.concept} (Full Trilogy)`.slice(0, 70);
      const ytDesc = `Full AI-generated trilogy: ${args.concept}\n\nParts:\n${args.parts.map((p, i) => `${i + 1}. ${p.title}`).join('\n')}\n\nGenerated with Sora AI`;
      youtubeResult = await uploadToYouTube(stitchedPath, ytTitle, ytDesc);
    }

    if (stitchedPath) {
      const creds = loadTelegramEnv();
      if (creds) await telegramSendVideo(stitchedPath, `Trilogy complete: "${args.concept}"\n${args.parts.length} parts stitched`);
    }
  }

  // Update trilogy record
  const freshState = loadState();
  const tidx = (freshState.trilogies || []).findIndex(t => t.id === trilogyId);
  if (tidx !== -1) {
    freshState.trilogies[tidx].parts = trilogyRecord.parts;
    freshState.trilogies[tidx].stitchedPath = stitchedPath || undefined;
    freshState.trilogies[tidx].youtubeUrl = youtubeResult?.url;
    freshState.trilogies[tidx].status = 'done';
    saveState(freshState);
  }

  return JSON.stringify({
    success: partPaths.length > 0,
    trilogy_id: trilogyId,
    parts_succeeded: partPaths.length,
    parts_failed: args.parts.length - partPaths.length,
    part_results: partResults,
    stitched_path: stitchedPath,
    youtube: youtubeResult,
    note: stitchedPath ? 'Stitched video saved to Passport drive' : partPaths.length < 2 ? 'Not enough parts to stitch' : 'Stitch failed',
  });
}

async function handleSoraListVideos(args: { limit?: number; trilogy_id?: string }): Promise<string> {
  const state = loadState();
  let videos = state.videos || [];
  if (args.trilogy_id) videos = videos.filter(v => v.trilogyId === args.trilogy_id);
  videos = videos.slice(-(args.limit || 20)).reverse();
  return JSON.stringify({
    total: (state.videos || []).length,
    trilogies: (state.trilogies || []).length,
    videos: videos.map(v => ({
      id: v.id, sora_id: v.soraVideoId, prompt: v.prompt.slice(0, 60),
      has_passport: !!v.passportPath, has_clean: !!v.processedPath,
      has_analysis: !!v.aiAnalysis, youtube: v.youtubeUrl,
      trilogy: v.trilogyId ? `${v.trilogyId} pt${v.trilogyPart}` : null,
      generated_at: v.generatedAt,
    })),
    trilogies_list: (state.trilogies || []).map(t => ({
      id: t.id, concept: t.concept, parts: t.parts.length, status: t.status,
      stitched: !!t.stitchedPath, youtube: t.youtubeUrl,
    })),
  });
}

async function handleSoraBatchClean(args: {
  input_dir?: string; output_dir?: string; limit?: number; skip_passport?: boolean;
}): Promise<string> {
  const homeDir = process.env.HOME || '/Users/isaiahdupree';
  const inputDir = args.input_dir || `${homeDir}/Downloads/sora-videos`;
  const outputDir = args.output_dir || `${homeDir}/Downloads/sora-videos/cleaned`;
  const limit = args.limit ?? 20;
  const skipPassport = args.skip_passport ?? false;

  ensureDir(outputDir);

  // Scan input for MP4s (not already-cleaned files, not in subdirs)
  let files: string[];
  try {
    files = fs.readdirSync(inputDir)
      .filter(f => f.endsWith('.mp4') && !f.startsWith('cleaned_') && !f.includes('-frame'))
      .map(f => path.join(inputDir, f));
  } catch (e) {
    return JSON.stringify({ error: `Cannot read input_dir: ${inputDir}` });
  }

  // Determine which already have a cleaned version
  const existingCleaned = new Set(
    fs.readdirSync(outputDir).filter(f => f.endsWith('.mp4'))
  );

  const pending = files.filter(f => {
    const outName = `cleaned_${path.basename(f)}`;
    return !existingCleaned.has(outName);
  });

  const toProcess = (limit > 0 ? pending.slice(0, limit) : pending);
  const results: Array<{ file: string; ok: boolean; output?: string; passport?: string; error?: string }> = [];

  for (const inputPath of toProcess) {
    const outName = `cleaned_${path.basename(inputPath)}`;
    const outputPath = path.join(outputDir, outName);
    try {
      const ok = await removeWatermark(inputPath, outputPath);
      let passportPath: string | undefined;
      if (ok && !skipPassport) {
        const videoId = path.basename(inputPath, '.mp4');
        passportPath = await copyToPassport(outputPath, `cleaned_${videoId}`, 'processed') || undefined;
      }
      results.push({ file: path.basename(inputPath), ok, output: ok ? outputPath : undefined, passport: passportPath });
    } catch (e) {
      results.push({ file: path.basename(inputPath), ok: false, error: String(e) });
    }
  }

  const succeeded = results.filter(r => r.ok).length;
  return JSON.stringify({
    total_raw: files.length,
    already_cleaned: existingCleaned.size,
    processed_this_run: toProcess.length,
    succeeded,
    failed: toProcess.length - succeeded,
    remaining: Math.max(0, pending.length - toProcess.length),
    results,
  });
}

async function handleSoraDrainQueue(): Promise<string> {
  const state = loadState();
  const pending = state.queue.filter(q => q.status === 'pending');

  if (pending.length === 0) {
    return JSON.stringify({ message: 'Queue is empty', generated_today: state.generatedToday, remaining_today: Math.max(0, state.maxPerDay - state.generatedToday) });
  }

  const remaining = state.maxPerDay - state.generatedToday;
  if (remaining <= 0) {
    return JSON.stringify({ message: `Daily limit reached (${state.generatedToday}/${state.maxPerDay}). Try sora_config to increase max_per_day.`, pending: pending.length });
  }

  const toRun = pending.slice(0, remaining);
  const results: Array<{ id: string; prompt: string; success: boolean; filePath?: string; error?: string }> = [];

  for (const item of toRun) {
    const genResult = JSON.parse(await handleSoraGenerate({ prompt: item.prompt, send_telegram: true }));

    // Update queue item status
    const freshState = loadState();
    const idx = freshState.queue.findIndex(q => q.id === item.id);
    if (idx !== -1) {
      freshState.queue[idx].status = genResult.success ? 'done' : 'failed';
    }
    saveState(freshState);

    results.push({ id: item.id, prompt: item.prompt.slice(0, 60), success: genResult.success, filePath: genResult.filePath, error: genResult.error });

    // Small pause between generations to avoid Safari thrash
    if (toRun.indexOf(item) < toRun.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const finalState = loadState();

  return JSON.stringify({
    ran: results.length,
    succeeded,
    failed: results.length - succeeded,
    skipped: pending.length - toRun.length,
    results,
    generated_today: finalState.generatedToday,
    remaining_today: Math.max(0, finalState.maxPerDay - finalState.generatedToday),
    still_pending: finalState.queue.filter(q => q.status === 'pending').length,
  });
}

async function handleSoraStatus(): Promise<string> {
  const state = loadState();
  const outputs = listOutputFiles(10);

  return JSON.stringify({
    date: state.date,
    generated_today: state.generatedToday,
    failed_today: state.failedToday,
    max_per_day: state.maxPerDay,
    remaining_today: Math.max(0, state.maxPerDay - state.generatedToday),
    queue: {
      pending: state.queue.filter(q => q.status === 'pending').length,
      done: state.queue.filter(q => q.status === 'done').length,
      failed: state.queue.filter(q => q.status === 'failed').length,
      next_up: state.queue.find(q => q.status === 'pending')?.prompt?.slice(0, 80) || null,
    },
    recent_outputs: outputs.slice(0, 5),
    active_claims: await readActiveClaims(),
  });
}

function listOutputFiles(limit = 20) {
  try {
    if (!fs.existsSync(DOWNLOAD_PATH)) return [];
    return fs.readdirSync(DOWNLOAD_PATH)
      .filter(f => f.endsWith('.mp4'))
      .map(f => {
        const p = path.join(DOWNLOAD_PATH, f);
        const s = fs.statSync(p);
        return { name: f, path: p, size_kb: Math.round(s.size / 1024), modified: s.mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .slice(0, limit);
  } catch { return []; }
}

async function handleSoraListOutputs(args: { limit?: number }): Promise<string> {
  const files = listOutputFiles(args.limit || 20);
  return JSON.stringify({
    count: files.length,
    download_path: DOWNLOAD_PATH,
    files,
  });
}

async function handleSoraClaimStatus(): Promise<string> {
  const claims = await readActiveClaims();
  const soraClaim = claims.find(c => c.service === MY_SERVICE);
  const conflicts = soraClaim
    ? claims.filter(c => c.service !== MY_SERVICE && c.windowIndex === soraClaim.windowIndex && c.tabIndex === soraClaim.tabIndex)
    : [];
  return JSON.stringify({
    sora_claimed: !!soraClaim,
    sora_claim: soraClaim || null,
    conflicts,
    all_claims: claims,
  });
}

async function handleSoraConfig(args: { max_per_day?: number }): Promise<string> {
  const state = loadState();
  if (args.max_per_day !== undefined) {
    state.maxPerDay = Math.max(1, Math.min(50, args.max_per_day));
    saveState(state);
  }
  return JSON.stringify({
    max_per_day: state.maxPerDay,
    generated_today: state.generatedToday,
    remaining_today: Math.max(0, state.maxPerDay - state.generatedToday),
    note: 'OpenAI Sora limits depend on your subscription. Set max_per_day to match your actual quota to prevent failures.',
  });
}

// ─── JSON-RPC dispatch ────────────────────────────────────────────────────────

async function handleRequest(req: { id?: unknown; method: string; params?: { name?: string; arguments?: Record<string, unknown> } }) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } } };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = (params?.arguments || {}) as Record<string, unknown>;
    let content: string;
    try {
      if (name === 'sora_generate') content = await handleSoraGenerate(args as { prompt: string; skip_claim_check?: boolean; send_telegram?: boolean });
      else if (name === 'sora_queue_batch') content = await handleSoraQueueBatch(args as { prompts: string[]; source?: string });
      else if (name === 'sora_get_trends') content = await handleSoraGetTrends(args as { count?: number; platform?: string; auto_queue?: boolean });
      else if (name === 'sora_status') content = await handleSoraStatus();
      else if (name === 'sora_list_outputs') content = await handleSoraListOutputs(args as { limit?: number });
      else if (name === 'sora_claim_status') content = await handleSoraClaimStatus();
      else if (name === 'sora_config') content = await handleSoraConfig(args as { max_per_day?: number });
      else if (name === 'sora_drain_queue') content = await handleSoraDrainQueue();
      else if (name === 'sora_generate_trilogy') content = await handleSoraGenerateTrilogy(args as { concept: string; parts: Array<{ title: string; prompt: string }>; skip_youtube?: boolean });
      else if (name === 'sora_process_video') content = await handleSoraProcessVideo(args as { video_id?: string; file_path?: string; skip_youtube?: boolean; youtube_title?: string });
      else if (name === 'sora_list_videos') content = await handleSoraListVideos(args as { limit?: number; trilogy_id?: string });
      else if (name === 'sora_batch_clean') content = await handleSoraBatchClean(args as { input_dir?: string; output_dir?: string; limit?: number; skip_passport?: boolean });
      else throw new Error(`Unknown tool: ${name}`);
    } catch (e) {
      content = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
    }
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: content }] } };
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ─── Main loop ────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    const res = await handleRequest(req);
    if (res !== null) process.stdout.write(JSON.stringify(res) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
  }
});
