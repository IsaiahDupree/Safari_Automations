#!/usr/bin/env npx tsx
/**
 * Sora Content Generator — Trends + Offers → Sora Videos
 * Usage: npx tsx scripts/sora-content-generator.ts --help
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = 'http://localhost:5555';
const SORA_DIR = path.join(process.env.HOME || '', 'sora-videos');
const BATCH_DIR = path.join(SORA_DIR, 'generated');
const BATCH_FILE = path.join(BATCH_DIR, 'current-batch.json');
const WM_TOOL = '/Users/isaiahdupree/Documents/Software/MediaPoster/Backend/SoraWatermarkCleaner';

interface Prompt { id: string; title: string; sora_prompt: string; caption: string; hashtags: string[]; trend_name: string; source: string; format: string; part?: number; series_id?: string; }

async function api(ep: string, method = 'GET', body?: any): Promise<any> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BACKEND}${ep}`, opts);
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function fromTrends(count: number): Promise<Prompt[]> {
  console.log(`\n📈 Generating ${count} from live trends...`);
  try {
    const res = await api('/api/sora-daily/scripts/generate-sync', 'POST', { source: 'live', count, include_series: true });
    const out: Prompt[] = [];
    for (const s of res.scripts || []) for (const p of s.parts || [])
      out.push({ id: `${s.id}-p${p.part_number||1}`, title: s.title, sora_prompt: p.sora_prompt, caption: p.caption||'', hashtags: p.hashtags||[], trend_name: s.trend_name||'', source: 'trends', format: s.format_type||'single', part: p.part_number, series_id: (s.parts||[]).length>1?s.id:undefined });
    console.log(`  ✅ ${out.length} trend prompts`); return out;
  } catch (e: any) { console.log(`  ❌ ${e.message}`); return []; }
}

async function fromOffers(count: number): Promise<Prompt[]> {
  console.log(`\n🏷️  Generating ${count} offer/brand scripts...`);
  const themes = [
    'Tech entrepreneur showcasing automated content creation — screens, dashboards, hustle energy',
    'Personal branding flex — stylish studio, creating digital content, confident and aspirational',
    'Side hustle motivation — coding at night to building a digital empire, montage energy',
    'AI tools showcase — cutting-edge AI tools for creators, futuristic workspace',
    'Creator economy lifestyle — aesthetic day-in-the-life as tech content creator',
  ];
  try {
    const offersData = await api('/api/ugc-content/offers').catch(() => ({ offers: [] }));
    const offers = offersData.offers || [];
    const descs = offers.length > 0
      ? offers.slice(0, count).map((o: any) => `Product: "${o.title}" — show @isaiahdupree using it cinematically`)
      : themes.slice(0, count);
    const res = await api('/api/sora-daily/scripts/generate-sync', 'POST', { source: 'manual', count: descs.length, include_series: false, descriptions: descs });
    const out: Prompt[] = [];
    for (const s of res.scripts || []) for (const p of s.parts || [])
      out.push({ id: `offer-${s.id}`, title: s.title, sora_prompt: p.sora_prompt, caption: p.caption||'', hashtags: p.hashtags||[], trend_name: 'Brand/Offer', source: 'offers', format: 'single', part: 1 });
    console.log(`  ✅ ${out.length} offer/brand prompts`); return out;
  } catch (e: any) { console.log(`  ❌ ${e.message}`); return []; }
}

async function fromCurated(count: number): Promise<Prompt[]> {
  console.log(`\n📚 Selecting ${count} curated prompts...`);
  try {
    const res = await api('/api/sora-daily/trend-prompts');
    const all = (res.prompts || []).sort(() => Math.random() - 0.5).slice(0, count);
    const out: Prompt[] = all.map((p: any) => ({ id: p.id, title: p.title, sora_prompt: p.sora_prompt, caption: p.caption||'', hashtags: p.hashtags||[], trend_name: p.trend_name||'', source: 'curated', format: p.category==='single'?'single':'series', part: 1, series_id: p.series_id }));
    console.log(`  ✅ ${out.length} curated prompts`); return out;
  } catch (e: any) { console.log(`  ❌ ${e.message}`); return []; }
}

async function buildMix(total: number, mode: string): Promise<Prompt[]> {
  if (mode === 'trends') return fromTrends(total);
  if (mode === 'offers') return fromOffers(total);
  if (mode === 'curated') return fromCurated(total);
  // mix mode
  const tC = Math.max(1, Math.round(total * 0.4));
  const oC = Math.max(1, Math.round(total * 0.3));
  const cC = Math.max(1, total - tC - oC);
  const [t, o, c] = await Promise.all([fromTrends(tC), fromOffers(oC), fromCurated(cC)]);
  return [...t, ...o, ...c];
}

async function checkSoraUsage(needed: number): Promise<boolean> {
  console.log('\n📊 Checking Sora usage...');
  try {
    const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
    const sora = new SoraFullAutomation();
    const usage = await sora.getUsage();
    if (usage.success && usage.videoGensLeft !== null) {
      console.log(`  🎬 ${usage.videoGensLeft} gens left (${usage.freeCount} free, ${usage.paidCount} paid)`);
      if (usage.videoGensLeft < needed) console.log(`  ⚠️  Only ${usage.videoGensLeft} gens but need ${needed}`);
      return usage.videoGensLeft > 0;
    }
    console.log('  ⚠️  Could not read usage — proceeding anyway');
    return true;
  } catch (e: any) { console.log(`  ⚠️  Usage check failed: ${e.message}`); return true; }
}

async function runGeneration(prompts: Prompt[]): Promise<string> {
  console.log(`\n🚀 Running Sora generation for ${prompts.length} prompts...`);
  const hasCredits = await checkSoraUsage(prompts.length);
  if (!hasCredits) { console.log('\n❌ No Sora credits available'); return ''; }

  const batchName = `gen-${Date.now()}`;
  const batchDir = path.join(BATCH_DIR, batchName);
  fs.mkdirSync(batchDir, { recursive: true });
  fs.mkdirSync(path.join(batchDir, 'cleaned'), { recursive: true });

  let success = 0, failed = 0;
  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    console.log(`\n🎬 [${i+1}/${prompts.length}] ${p.title}`);
    console.log(`   Prompt: ${p.sora_prompt.slice(0, 80)}...`);
    try {
      const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
      const sora = new SoraFullAutomation();
      const result = await sora.fullRun(p.sora_prompt);
      if (result.download?.success && result.download.filePath) {
        const baseSlug = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
        const slug = p.part && p.series_id ? `${baseSlug}-part-${p.part}` : baseSlug;
        const dest = path.join(batchDir, `${slug}-raw.mp4`);
        fs.copyFileSync(result.download.filePath, dest);
        console.log(`   ✅ Generated: ${dest}`);
        success++;
      } else {
        console.log(`   ❌ Failed: ${result.download?.error || result.poll?.error || 'Unknown'}`);
        failed++;
      }
    } catch (e: any) { console.log(`   ❌ Error: ${e.message}`); failed++; }
  }
  console.log(`\n📊 Generation: ${success} success, ${failed} failed`);

  // Watermark removal
  if (success > 0) {
    console.log('\n🧹 Removing watermarks...');
    try {
      execSync(`cd "${WM_TOOL}" && uv run python cli.py -i "${batchDir}" -o "${batchDir}/cleaned" -p "*-raw.mp4"`, { stdio: 'inherit' });
      console.log('  ✅ Watermarks removed');
      // Copy cleaned to main cleaned dir
      const cleanedDest = path.join(SORA_DIR, 'cleaned', batchName);
      fs.mkdirSync(cleanedDest, { recursive: true });
      const cleaned = fs.readdirSync(path.join(batchDir, 'cleaned')).filter(f => f.endsWith('.mp4'));
      for (const f of cleaned) fs.copyFileSync(path.join(batchDir, 'cleaned', f), path.join(cleanedDest, f));
      console.log(`  📂 ${cleaned.length} cleaned videos → ${cleanedDest}`);
    } catch (e: any) { console.log(`  ❌ Watermark removal failed: ${e.message}`); }
  }

  // Auto-register batch in daily pipeline
  if (success > 0) autoRegisterBatch(batchName, prompts);
  return batchName;
}

function autoRegisterBatch(batchName: string, prompts: Prompt[]): void {
  console.log('\n📝 Auto-registering batch in daily pipeline...');
  const projectRoot = path.resolve(__dirname, '..');
  const cleanedDir = path.join(SORA_DIR, 'cleaned', batchName);

  // Group prompts into "movies" for pipeline config
  const seriesMap = new Map<string, Prompt[]>();
  const singles: Prompt[] = [];
  for (const p of prompts) {
    if (p.series_id) {
      if (!seriesMap.has(p.series_id)) seriesMap.set(p.series_id, []);
      seriesMap.get(p.series_id)!.push(p);
    } else {
      singles.push(p);
    }
  }

  const movies: any[] = [];
  let movieId = 1;

  // Series → trilogy movies
  for (const [, parts] of seriesMap) {
    const sorted = parts.sort((a, b) => (a.part || 1) - (b.part || 1));
    const first = sorted[0];
    movies.push({
      id: movieId++,
      title: first.title.toUpperCase(),
      trend: `${first.trend_name} (${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })})`,
      niche: first.source === 'offers' ? 'Brand/Offer' : first.trend_name || 'General',
      format: sorted.length > 1 ? 'trilogy' : 'single',
      bestPlatform: 'TikTok, Instagram Reels, YouTube Shorts',
      captionIdea: first.caption?.slice(0, 100) || '',
      videos: sorted.map(p => ({
        part: p.part || 1,
        title: p.title + (sorted.length > 1 ? ` Part ${p.part || 1}` : ''),
        stage: sorted.length === 1 ? 'Full Video' : p.part === 1 ? 'Setup/Hook' : p.part === sorted.length ? 'Payoff/Reveal' : 'Build/Development',
        prompt: p.sora_prompt.slice(0, 200),
      })),
    });
  }

  // Singles
  for (const p of singles) {
    movies.push({
      id: movieId++,
      title: p.title.toUpperCase(),
      trend: `${p.trend_name} (${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })})`,
      niche: p.source === 'offers' ? 'Brand/Offer' : p.trend_name || 'General',
      format: 'single',
      bestPlatform: 'TikTok, Instagram Reels, YouTube Shorts',
      captionIdea: p.caption?.slice(0, 100) || '',
      videos: [{ part: 1, title: p.title, stage: 'Full Video', prompt: p.sora_prompt.slice(0, 200) }],
    });
  }

  // Find next batch number
  const existingConfigs = fs.readdirSync(projectRoot).filter(f => f.match(/^sora-content-gen-batch-\d+\.json$/));
  const maxNum = existingConfigs.reduce((max, f) => {
    const m = f.match(/batch-(\d+)/);
    return m ? Math.max(max, parseInt(m[1])) : max;
  }, 0);
  const batchNum = maxNum + 1;
  const configFileName = `sora-content-gen-batch-${batchNum}.json`;
  const batchLabel = `content-gen-${batchNum}`;

  // Write pipeline batch config
  const pipelineConfig = {
    generatedAt: new Date().toISOString(),
    character: '@isaiahdupree',
    theme: `Content Gen Batch ${batchNum} — Auto-generated`,
    characterDescription: 'Isaiah, a charismatic Black man in his late 20s with a warm smile, wearing a casual hoodie and gold chain, expressive and humorous',
    niches: [...new Set(movies.map(m => m.niche))],
    movies,
  };
  fs.writeFileSync(path.join(projectRoot, configFileName), JSON.stringify(pipelineConfig, null, 2));
  console.log(`  ✅ Created ${configFileName} (${movies.length} movies)`);

  // Rename cleaned files: strip -raw suffix for pipeline compatibility
  if (fs.existsSync(cleanedDir)) {
    const files = fs.readdirSync(cleanedDir).filter(f => f.endsWith('.mp4'));
    for (const f of files) {
      const newName = f.replace(/-raw/g, '');
      if (newName !== f) {
        fs.renameSync(path.join(cleanedDir, f), path.join(cleanedDir, newName));
      }
    }
    // Rename trilogy files to match pipeline's part-N-slug pattern
    for (const movie of movies) {
      if (movie.videos.length > 1) {
        for (const v of movie.videos) {
          const videoSlug = v.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const current = path.join(cleanedDir, `cleaned_${videoSlug}.mp4`);
          const target = path.join(cleanedDir, `cleaned_part-${v.part}-${videoSlug}.mp4`);
          if (fs.existsSync(current) && !fs.existsSync(target)) {
            fs.renameSync(current, target);
          }
        }
      }
    }
    console.log(`  ✅ Cleaned filenames normalized`);
  }

  // Auto-register in daily-content-pipeline.ts CONFIG_FILES
  const pipelinePath = path.join(projectRoot, 'scripts', 'daily-content-pipeline.ts');
  if (fs.existsSync(pipelinePath)) {
    let src = fs.readFileSync(pipelinePath, 'utf-8');
    const entry = `  { file: '${configFileName}', cleanedDir: '${batchName}', batch: '${batchLabel}' },`;
    if (!src.includes(configFileName)) {
      src = src.replace(
        /^(const CONFIG_FILES = \[[\s\S]*?)(^\];)/m,
        `$1${entry}\n$2`
      );
      fs.writeFileSync(pipelinePath, src);
      console.log(`  ✅ Registered in daily-content-pipeline.ts`);
    } else {
      console.log(`  ℹ️  Already registered in pipeline`);
    }
  }

  console.log(`  📋 Rebuild catalog: npx tsx scripts/daily-content-pipeline.ts --catalog`);
}

// ── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Sora Content Generator — @isaiahdupree

MODES:
  --mode trends    Generate from live social media trends
  --mode offers    Generate offer/brand-focused content
  --mode curated   Use curated trend prompt library
  --mode mix       Balanced mix of all sources (default)

OPTIONS:
  --count N        Number of prompts to generate (default: 5)
  --dry-run        Preview prompts without running Sora
  --generate       Actually run Sora generation + watermark clean
  --save           Save batch config for later generation
  --from-batch     Load saved batch from current-batch.json and generate
`);
    return;
  }

  const mode = args[args.indexOf('--mode') + 1] || 'mix';
  const count = parseInt(args[args.indexOf('--count') + 1] || '5');
  const dryRun = args.includes('--dry-run');
  const generate = args.includes('--generate');
  const fromBatch = args.includes('--from-batch');
  const save = args.includes('--save') || (!generate && !fromBatch);

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   🎬 SORA CONTENT GENERATOR — @isaiahdupree              ║');
  console.log('║   Trends + Offers → AI Prompts → Sora Videos             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n📅 ${new Date().toISOString().split('T')[0]}`);

  // --from-batch: load saved batch and generate
  if (fromBatch) {
    if (!fs.existsSync(BATCH_FILE)) { console.log(`\n❌ No saved batch at ${BATCH_FILE}`); process.exit(1); }
    const batch = JSON.parse(fs.readFileSync(BATCH_FILE, 'utf-8'));
    console.log(`📂 Loaded batch: ${batch.id} (${batch.prompts.length} prompts, mode=${batch.mode})`);
    if (!dryRun) await runGeneration(batch.prompts);
    else console.log('🧪 DRY RUN — would generate', batch.prompts.length, 'videos');
    return;
  }

  console.log(`🎯 Mode: ${mode} | Count: ${count}${dryRun ? ' | 🧪 DRY RUN' : ''}${generate ? ' | 🚀 GENERATE' : ''}`);

  // Check backend
  try { await api('/health'); } catch {
    console.log('\n❌ MediaPoster backend not running at ' + BACKEND);
    process.exit(1);
  }

  // Build content mix
  const prompts = await buildMix(count, mode);
  if (prompts.length === 0) { console.log('\n❌ No prompts generated'); process.exit(1); }

  // Display
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`📋 GENERATED ${prompts.length} PROMPTS:`);
  console.log(`═══════════════════════════════════════════════════════════`);
  const bySource: Record<string, number> = {};
  for (const p of prompts) {
    bySource[p.source] = (bySource[p.source] || 0) + 1;
    console.log(`\n  ${p.source === 'trends' ? '📈' : p.source === 'offers' ? '🏷️' : '📚'} [${p.source}] ${p.title}`);
    console.log(`     Trend: ${p.trend_name}`);
    console.log(`     Prompt: ${p.sora_prompt.slice(0, 100)}...`);
    if (p.caption) console.log(`     Caption: ${p.caption.slice(0, 60)}...`);
  }
  console.log(`\n📊 Mix: ${Object.entries(bySource).map(([k,v]) => `${k}=${v}`).join(', ')}`);

  // Save batch
  if (save) {
    fs.mkdirSync(BATCH_DIR, { recursive: true });
    const batch = { id: `batch-${Date.now()}`, generated_at: new Date().toISOString(), mode, prompts, stats: { total: prompts.length, ...bySource } };
    fs.writeFileSync(BATCH_FILE, JSON.stringify(batch, null, 2));
    console.log(`\n💾 Batch saved: ${BATCH_FILE}`);
    console.log(`   Run generation: npx tsx scripts/sora-content-generator.ts --generate`);
  }

  // Generate
  if (generate && !dryRun) {
    await runGeneration(prompts);
    console.log('\n✅ Content generation complete! Run catalog rebuild:');
    console.log('   npx tsx scripts/daily-content-pipeline.ts --catalog');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
