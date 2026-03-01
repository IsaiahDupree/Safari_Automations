#!/usr/bin/env npx tsx
/**
 * Sora Trending Trilogies Runner
 * Fetches trending content from MediaPoster → generates 8 trilogies (24 videos) → runs Sora
 * 
 * Usage: npx tsx scripts/sora-trending-trilogies.ts [--dry-run] [--from N] [--from-part N]
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BACKEND = 'http://localhost:5555';
const OUTPUT_DIR = path.join(process.env.HOME || '', 'sora-videos', 'trending-trilogies-' + new Date().toISOString().slice(0, 10));
const CONFIG_FILE = path.join(PROJECT_ROOT, `sora-trending-trilogies-${new Date().toISOString().slice(0, 10)}.json`);

// ─── Types ───────────────────────────────────────────────
interface TrilogyVideo {
  part: number;
  title: string;
  stage: string;
  prompt: string;
}

interface Trilogy {
  id: number;
  title: string;
  trend: string;
  source: string;
  videos: TrilogyVideo[];
}

interface CuratedPrompt {
  id: string;
  title: string;
  sora_prompt: string;
  trend_name: string;
  trend_source: string;
  category: string;
  series_id?: string;
  caption?: string;
  hashtags?: string[];
}

// ─── CLI Args ────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FROM_IDX = args.includes('--from') ? parseInt(args[args.indexOf('--from') + 1]) : 1;
const FROM_PART = args.includes('--from-part') ? parseInt(args[args.indexOf('--from-part') + 1]) : 1;

// ─── API Helper ──────────────────────────────────────────
async function api(ep: string, method = 'GET', body?: any): Promise<any> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BACKEND}${ep}`, opts);
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// ─── Step 1: Fetch curated trilogies from MediaPoster ────
async function fetchCuratedTrilogies(): Promise<Trilogy[]> {
  console.log('\n📡 Fetching curated trilogies from MediaPoster...');
  const data = await api('/api/sora-daily/trend-prompts/series');
  const trilogies: Trilogy[] = [];
  let id = 1;

  for (const [seriesId, series] of Object.entries(data.series || {}) as any) {
    const parts: TrilogyVideo[] = series.parts.map((p: CuratedPrompt, i: number) => ({
      part: i + 1,
      title: p.title,
      stage: i === 0 ? 'Setup/Hook' : i === series.parts.length - 1 ? 'Payoff/Reveal' : 'Build/Development',
      prompt: p.sora_prompt,
    }));
    trilogies.push({
      id: id++,
      title: series.trend_name,
      trend: series.trend_name,
      source: series.parts[0]?.trend_source || 'MediaPoster Curated',
      videos: parts,
    });
  }

  console.log(`  ✅ ${trilogies.length} curated trilogies (${trilogies.reduce((s, t) => s + t.videos.length, 0)} videos)`);
  for (const t of trilogies) console.log(`     ${t.id}. ${t.title} (${t.videos.length} parts)`);
  return trilogies;
}

// ─── Step 2: Fetch trending singles & generate new trilogies via AI ───
async function generateNewTrilogies(existingCount: number, needed: number): Promise<Trilogy[]> {
  console.log(`\n🤖 Generating ${needed} new trilogies from trending themes via AI...`);

  // Get all prompts, filter to singles
  const data = await api('/api/sora-daily/trend-prompts');
  const singles = (data.prompts || []).filter((p: CuratedPrompt) => p.category === 'single');
  console.log(`  📈 ${singles.length} trending singles available`);

  // Pick themes for new trilogies
  const themes = singles.slice(0, needed).map((p: CuratedPrompt) => ({
    title: p.trend_name,
    theme: `${p.trend_name} — ${p.title}. Original prompt context: ${p.sora_prompt.slice(0, 150)}`,
  }));

  // If we need more themes than singles, add extras
  const extraThemes = [
    { title: 'AI Startup Founder Journey', theme: 'A young tech entrepreneur building an AI startup from scratch — late night coding, investor pitches, product launch' },
    { title: 'Digital Nomad Adventures', theme: 'Living the digital nomad lifestyle — coding from exotic locations, creative freedom, building an online empire' },
    { title: 'From Zero to Viral', theme: 'The journey of creating viral content — first video flop, learning the algorithm, then explosive overnight success' },
    { title: 'Future Tech Visionary', theme: 'A visionary developer exploring emerging technologies — holographic interfaces, AI companions, smart city systems' },
    { title: 'Creative Hustle Montage', theme: 'The grind of a creative tech entrepreneur — early mornings, multiple screens, shipping products, celebrating wins' },
  ];

  while (themes.length < needed) {
    themes.push(extraThemes[themes.length - singles.length] || extraThemes[0]);
  }

  // Direct OpenAI call for reliable trilogy generation
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const trilogies: Trilogy[] = [];
  let id = existingCount + 1;

  for (let i = 0; i < needed; i++) {
    const t = themes[i];
    console.log(`\n  🎬 [${i + 1}/${needed}] Generating trilogy: "${t.title}"...`);
    try {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a cinematic video prompt writer for Sora AI video generation.
Create vivid, visual prompts for a 3-part video trilogy featuring @isaiahdupree — Isaiah, a charismatic Black man in his late 20s with a warm smile, wearing a casual hoodie and gold chain, expressive and confident.

Each prompt should be 2-4 sentences, highly visual and cinematic, describing actions, lighting, atmosphere, camera angles.
Style: Cinematic 4K, portrait 9:16 vertical video, dramatic lighting, trending TikTok/Reels energy.

You MUST return a JSON object with exactly this structure:
{"videos": [{"part": 1, "title": "...", "stage": "Setup", "prompt": "..."}, {"part": 2, "title": "...", "stage": "Escalation", "prompt": "..."}, {"part": 3, "title": "...", "stage": "Climax", "prompt": "..."}]}`
          },
          {
            role: 'user',
            content: `Create a 3-part video trilogy based on this trending theme: "${t.theme}"\n\nReturn exactly 3 video prompts in the JSON format specified.`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.8,
      }, { timeout: 30000 });

      const content = resp.choices[0]?.message?.content;
      if (!content) throw new Error('No response from OpenAI');

      const parsed = JSON.parse(content);
      const videos: any[] = parsed.videos || parsed.prompts || parsed.parts || parsed.trilogy || [];

      if (!Array.isArray(videos) || videos.length === 0) {
        throw new Error(`Unexpected response format: ${Object.keys(parsed).join(', ')}`);
      }

      trilogies.push({
        id: id++,
        title: t.title,
        trend: t.title,
        source: 'AI-generated from MediaPoster trends',
        videos: videos.slice(0, 3).map((v: any, idx: number) => ({
          part: v.part || idx + 1,
          title: v.title || `Part ${idx + 1}`,
          stage: v.stage || (idx === 0 ? 'Setup' : idx === 2 ? 'Climax' : 'Escalation'),
          prompt: v.prompt,
        })),
      });
      console.log(`     ✅ Generated ${Math.min(videos.length, 3)} parts`);
      for (const v of videos.slice(0, 3)) console.log(`        Part ${v.part}: ${v.title} — ${(v.prompt || '').slice(0, 60)}...`);
    } catch (e: any) {
      console.log(`     ❌ Failed: ${e.message}`);
    }
  }

  return trilogies;
}

// ─── Step 3: Check Sora credits ──────────────────────────
async function checkCredits(needed: number): Promise<{ available: boolean; gensLeft: number }> {
  console.log('\n📊 Checking Sora credits...');
  try {
    const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
    const sora = new SoraFullAutomation();
    const usage = await sora.getUsage();
    if (usage.success && usage.videoGensLeft !== null) {
      console.log(`  🎬 ${usage.videoGensLeft} gens left (need ${needed})`);
      if (usage.videoGensLeft < needed) {
        console.log(`  ⚠️  Only ${usage.videoGensLeft} gens available, need ${needed}`);
      }
      return { available: usage.videoGensLeft >= needed, gensLeft: usage.videoGensLeft };
    }
    console.log('  ⚠️  Could not read usage — proceeding anyway');
    return { available: true, gensLeft: -1 };
  } catch (e: any) {
    console.log(`  ⚠️  Usage check failed: ${e.message} — proceeding anyway`);
    return { available: true, gensLeft: -1 };
  }
}

// ─── Step 4: Run Sora generation ─────────────────────────
async function runGeneration(trilogies: Trilogy[]): Promise<void> {
  const totalVideos = trilogies.reduce((s, t) => s + t.videos.length, 0);
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🚀 SORA GENERATION — ${trilogies.length} trilogies, ${totalVideos} videos`);
  console.log(`${'═'.repeat(70)}`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  let success = 0, failed = 0;
  const results: { trilogy: string; part: number; success: boolean; path?: string; error?: string; timeMs?: number }[] = [];

  for (const trilogy of trilogies) {
    if (trilogy.id < FROM_IDX) continue;

    const trilogyDir = path.join(OUTPUT_DIR, `${trilogy.id}-${trilogy.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`);
    fs.mkdirSync(trilogyDir, { recursive: true });

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🎬 Trilogy ${trilogy.id}/${trilogies.length}: ${trilogy.title}`);
    console.log(`   Trend: ${trilogy.trend} | Source: ${trilogy.source}`);
    console.log(`${'─'.repeat(60)}`);

    for (const video of trilogy.videos) {
      if (trilogy.id === FROM_IDX && video.part < FROM_PART) continue;

      console.log(`\n  📽️  Part ${video.part}/3: ${video.title}`);
      console.log(`     Stage: ${video.stage}`);
      console.log(`     Prompt: ${(video.prompt || 'NO PROMPT').slice(0, 100)}...`);

      if (!video.prompt) {
        console.log('     ⚠️  No prompt — skipping');
        results.push({ trilogy: trilogy.title, part: video.part, success: false, error: 'No prompt' });
        failed++;
        continue;
      }

      if (DRY_RUN) {
        console.log('     🏷️  [DRY RUN] Skipping generation');
        results.push({ trilogy: trilogy.title, part: video.part, success: true });
        success++;
        continue;
      }

      const startTime = Date.now();
      try {
        const sora = new SoraFullAutomation();
        const result = await sora.fullRun(video.prompt);

        if (result.download?.success && result.download.filePath) {
          const slug = video.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
          const dest = path.join(trilogyDir, `part-${video.part}-${slug}.mp4`);
          fs.copyFileSync(result.download.filePath, dest);
          const timeMs = Date.now() - startTime;
          console.log(`     ✅ Generated: ${dest} (${Math.round(timeMs / 1000)}s)`);
          results.push({ trilogy: trilogy.title, part: video.part, success: true, path: dest, timeMs });
          success++;
        } else {
          const error = result.download?.error || result.poll?.error || 'Unknown error';
          console.log(`     ❌ Failed: ${error}`);
          results.push({ trilogy: trilogy.title, part: video.part, success: false, error });
          failed++;
        }
      } catch (e: any) {
        console.log(`     ❌ Error: ${e.message}`);
        results.push({ trilogy: trilogy.title, part: video.part, success: false, error: e.message });
        failed++;
      }

      // Brief pause between videos
      if (video.part < 3) {
        console.log('     ⏳ Waiting 10s before next part...');
        await new Promise(r => setTimeout(r, 10000));
      }
    }

    // Longer pause between trilogies
    if (trilogy.id < trilogies.length) {
      console.log('\n  ⏳ Waiting 20s before next trilogy...');
      await new Promise(r => setTimeout(r, 20000));
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log('📊 GENERATION COMPLETE');
  console.log(`${'═'.repeat(70)}`);
  console.log(`  ✅ Success: ${success}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  📂 Output:  ${OUTPUT_DIR}`);
  console.log();

  for (const r of results) {
    const icon = r.success ? '✅' : '❌';
    const detail = r.path ? path.basename(r.path) : r.error || '';
    console.log(`  ${icon} ${r.trilogy} Part ${r.part} — ${detail}`);
  }

  // Save results
  const resultsFile = path.join(OUTPUT_DIR, 'generation-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify({ 
    generatedAt: new Date().toISOString(),
    totalTrilogies: trilogies.length,
    totalVideos: results.length,
    success,
    failed,
    outputDir: OUTPUT_DIR,
    results,
  }, null, 2));
  console.log(`\n  📝 Results saved: ${resultsFile}`);
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SORA TRENDING TRILOGIES — 8 Trilogies × 3 Parts = 24 Videos  ║');
  console.log('║  Starring: @isaiahdupree                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  if (DRY_RUN) console.log('\n🏷️  DRY RUN MODE — no videos will be generated\n');

  // Step 1: Fetch curated trilogies from MediaPoster
  const curated = await fetchCuratedTrilogies();

  // Step 2: Generate new trilogies from trending singles
  const needed = 8 - curated.length;
  const generated = needed > 0 ? await generateNewTrilogies(curated.length, needed) : [];

  // Combine all trilogies
  const allTrilogies = [...curated, ...generated];
  const totalVideos = allTrilogies.reduce((s, t) => s + t.videos.length, 0);

  console.log(`\n📋 Final Lineup: ${allTrilogies.length} trilogies, ${totalVideos} videos`);
  for (const t of allTrilogies) {
    console.log(`  ${t.id}. ${t.title} (${t.videos.length} parts) — ${t.source}`);
  }

  // Save config
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    character: '@isaiahdupree',
    totalTrilogies: allTrilogies.length,
    totalVideos,
    trilogies: allTrilogies,
  }, null, 2));
  console.log(`\n📁 Config saved: ${CONFIG_FILE}`);

  // Step 3: Check credits
  const credits = await checkCredits(totalVideos);
  if (!credits.available && !DRY_RUN) {
    console.log('\n❌ Not enough Sora credits. Aborting.');
    console.log(`   Config saved — resume later with: npx tsx scripts/sora-trending-trilogies.ts --from 1`);
    process.exit(1);
  }

  // Step 4: Run generation
  await runGeneration(allTrilogies);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
