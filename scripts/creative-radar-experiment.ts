#!/usr/bin/env npx tsx
/**
 * Creative Radar → Sora Experiment Runner
 * ========================================
 * Bridges Creative Radar market research briefs into the Sora content pipeline.
 *
 * Flow:
 *   1. Load awareness_briefs.json + patterns.json + scored_posts.json
 *   2. Convert each awareness-stage brief into Sora video prompts
 *   3. Save as a batch compatible with sora-content-generator.ts --from-batch
 *   4. Track experiments in ~/market-research/creative-radar/{offer}/experiments.json
 *
 * Usage:
 *   npx tsx scripts/creative-radar-experiment.ts                      # Preview prompts
 *   npx tsx scripts/creative-radar-experiment.ts --generate           # Generate Sora videos
 *   npx tsx scripts/creative-radar-experiment.ts --offer steadyletters
 *   npx tsx scripts/creative-radar-experiment.ts --stages unaware,problem_aware
 *   npx tsx scripts/creative-radar-experiment.ts --variants 3         # 3 variants per stage
 *   npx tsx scripts/creative-radar-experiment.ts --status             # Show experiment history
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RESEARCH_BASE = path.join(process.env.HOME || '', 'market-research');
const SORA_DIR = path.join(process.env.HOME || '', 'sora-videos');
const BATCH_DIR = path.join(SORA_DIR, 'generated');
const BATCH_FILE = path.join(BATCH_DIR, 'current-batch.json');
const BACKEND = 'http://localhost:5555';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Brief {
  stage: string;
  goal: string;
  primary_hook: string;
  script_beats: string[];
  cta: string;
  competitor_hooks: string[];
  recommended_format: string;
  generated_at: string;
}

interface Pattern {
  hook: string;
  type: string;
  stage: string;
  fit: number;
  advertiser: string;
}

interface ScoredPost {
  scores: { total_score: number; fit_score: number; confidence: number; reuse_style: string; why_it_ranked: string };
  tags: { awareness_stage: string };
  text_content?: string;
  ad_text?: string;
  author_name?: string;
  advertiser_name?: string;
  _source: string;
}

interface SoraPrompt {
  id: string;
  title: string;
  sora_prompt: string;
  caption: string;
  hashtags: string[];
  trend_name: string;
  source: string;
  format: string;
  part?: number;
  series_id?: string;
}

interface Experiment {
  id: string;
  offer: string;
  created_at: string;
  stages: string[];
  variants_per_stage: number;
  prompts: SoraPrompt[];
  status: 'created' | 'generating' | 'generated' | 'published';
  batch_name?: string;
  results?: Record<string, any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA LOADING
// ─────────────────────────────────────────────────────────────────────────────

function loadRadarData(offer: string): {
  briefs: Record<string, Brief>;
  patterns: { hook_templates: Pattern[]; scroll_stoppers: string[] };
  scoredPosts: ScoredPost[];
} {
  const radarDir = path.join(RESEARCH_BASE, 'creative-radar', offer);

  if (!fs.existsSync(radarDir)) {
    console.log(`\n❌ No Creative Radar data for "${offer}" at ${radarDir}`);
    console.log(`   Run: python3 python/market_research/creative_radar.py ${offer} --skip-discover`);
    process.exit(1);
  }

  const briefsPath = path.join(radarDir, 'awareness_briefs.json');
  const patternsPath = path.join(radarDir, 'patterns.json');
  const scoredPath = path.join(radarDir, 'scored_posts.json');

  const briefs = fs.existsSync(briefsPath) ? JSON.parse(fs.readFileSync(briefsPath, 'utf-8')) : {};
  const patterns = fs.existsSync(patternsPath) ? JSON.parse(fs.readFileSync(patternsPath, 'utf-8')) : { hook_templates: [], scroll_stoppers: [] };
  const scoredPosts = fs.existsSync(scoredPath) ? JSON.parse(fs.readFileSync(scoredPath, 'utf-8')) : [];

  return { briefs, patterns, scoredPosts };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT GENERATION — Brief → Sora Prompts
// ─────────────────────────────────────────────────────────────────────────────

const STAGE_VISUALS: Record<string, string> = {
  unaware: 'Warm, relatable, intimate setting. Person scrolling phone alone on couch, soft golden hour lighting. Close-up on face showing subtle guilt/longing. No product shown.',
  problem_aware: 'Split-screen energy: person staring at unread messages on phone with mounting anxiety. Clock ticking overlay. Moody blue-to-warm lighting transition.',
  solution_aware: 'Energetic reveal moment. Person discovers a simple system on their phone — eyes light up. Clean desk, organized life aesthetic. Bright natural light.',
  product_aware: 'Sleek app demo energy. Screen recording style with face cam overlay. Three quick feature reveals with satisfying UI animations. Modern minimal workspace.',
  most_aware: 'Confident, direct-to-camera testimonial energy. Person speaking naturally, warm background. Social proof overlays. Calm, trustworthy, zero-hype.',
};

const STAGE_MUSIC: Record<string, string> = {
  unaware: 'lo-fi emotional piano',
  problem_aware: 'building tension, subtle urgency',
  solution_aware: 'uplifting reveal, hope',
  product_aware: 'clean tech demo, modern',
  most_aware: 'warm conversational, confident',
};

const VARIANT_ANGLES: string[][] = [
  ['direct-to-camera confessional', 'warm golden hour lighting, intimate close-up'],
  ['montage with text overlays', 'fast cuts, kinetic typography, moody blue tones'],
  ['POV scroll-stop style', 'phone-in-hand POV, notification sounds, green-screen energy'],
];

function briefToSoraPrompts(
  brief: Brief,
  offer: string,
  patterns: { hook_templates: Pattern[]; scroll_stoppers: string[] },
  variantCount: number,
): SoraPrompt[] {
  const prompts: SoraPrompt[] = [];
  const stage = brief.stage;
  const baseVisual = STAGE_VISUALS[stage] || STAGE_VISUALS.unaware;

  // Gather competitor hooks: prefer same stage, fall back to high-fit from any stage
  const allHooks = (patterns.hook_templates || [])
    .filter(h => h.fit > 0.05)
    .sort((a, b) => {
      const stageBonus = (s: string) => s === stage ? 0.5 : 0;
      return (b.fit + stageBonus(b.stage)) - (a.fit + stageBonus(a.stage));
    })
    .map(h => h.hook.slice(0, 100));

  // Dedupe hooks
  const uniqueHooks = [...new Set(allHooks)];

  for (let v = 0; v < variantCount; v++) {
    const variantLabel = variantCount > 1 ? ` (v${v + 1})` : '';
    const id = `cr-${offer}-${stage}-v${v + 1}-${Date.now() + v}`;

    // v0 = primary hook, v1+ = competitor hooks
    const hookVariant = v === 0
      ? brief.primary_hook
      : uniqueHooks[v - 1] || brief.competitor_hooks[v - 1]?.slice(0, 100) || brief.primary_hook;

    // Vary the script ordering for each variant
    const beats = [...brief.script_beats];
    if (v > 0) {
      // Rotate beats: move first beat to end for v2, shuffle middle for v3
      const rotated = [...beats.slice(v % beats.length), ...beats.slice(0, v % beats.length)];
      beats.splice(0, beats.length, ...rotated);
    }
    const scriptText = beats.join('. ');

    // Vary the visual angle per variant
    const angle = VARIANT_ANGLES[v % VARIANT_ANGLES.length];
    const visual = v === 0 ? baseVisual : `${angle[0]} style. ${angle[1]}. ${baseVisual.split('.').slice(1).join('.')}`;

    const soraPrompt = buildSoraPrompt(hookVariant, scriptText, visual, brief.recommended_format, offer);
    const caption = buildCaption(brief, offer, uniqueHooks.slice(0, 3));
    const hashtags = buildHashtags(offer, stage);

    prompts.push({
      id,
      title: `${capitalize(offer)} — ${formatStage(stage)}${variantLabel}`,
      sora_prompt: soraPrompt,
      caption,
      hashtags,
      trend_name: `Creative Radar: ${formatStage(stage)}`,
      source: 'creative-radar',
      format: 'single',
      part: 1,
    });
  }

  return prompts;
}

function buildSoraPrompt(hook: string, script: string, visual: string, format: string, offer: string): string {
  return [
    `Cinematic vertical video (9:16 aspect ratio, ${format}).`,
    `Opening shot: ${visual}`,
    `The character @isaiahdupree, a charismatic Black man in his late 20s with a warm smile, wearing a casual hoodie and gold chain, speaks directly to camera.`,
    `Hook text overlay: "${hook}"`,
    `He delivers the script naturally: "${script.slice(0, 200)}"`,
    `Mood: authentic, warm, zero-hype. Lighting transitions from moody to hopeful.`,
    `Final frame: clean CTA text overlay on screen.`,
  ].join(' ');
}

function buildCaption(brief: Brief, offer: string, topHooks: string[]): string {
  const lines = [
    brief.primary_hook,
    '',
    ...brief.script_beats.slice(0, 3),
    '',
    `${brief.cta}`,
    '',
    `#${offer} #personalcrm #relationships`,
  ];
  return lines.join('\n');
}

function buildHashtags(offer: string, stage: string): string[] {
  const base = [offer, 'personalcrm', 'relationships', 'selfimprovement'];
  const stageMap: Record<string, string[]> = {
    unaware: ['adultfriendships', 'adulting', 'relatable'],
    problem_aware: ['socialanxiety', 'adhd', 'ghosting'],
    solution_aware: ['lifehack', 'productivity', 'systems'],
    product_aware: ['appreview', 'techlife', 'crm'],
    most_aware: ['review', 'freetrial', 'recommendation'],
  };
  return [...base, ...(stageMap[stage] || [])];
}

function formatStage(stage: string): string {
  return stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPERIMENT TRACKING
// ─────────────────────────────────────────────────────────────────────────────

function getExperimentsPath(offer: string): string {
  return path.join(RESEARCH_BASE, 'creative-radar', offer, 'experiments.json');
}

function loadExperiments(offer: string): Experiment[] {
  const p = getExperimentsPath(offer);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function saveExperiment(offer: string, experiment: Experiment): void {
  const experiments = loadExperiments(offer);
  const idx = experiments.findIndex(e => e.id === experiment.id);
  if (idx >= 0) experiments[idx] = experiment;
  else experiments.push(experiment);
  const p = getExperimentsPath(offer);
  fs.writeFileSync(p, JSON.stringify(experiments, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────────────────────────

function showStatus(offer: string): void {
  const experiments = loadExperiments(offer);
  const { briefs, scoredPosts } = loadRadarData(offer);

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log(`║   🧪 CREATIVE RADAR EXPERIMENTS — ${offer.toUpperCase().padEnd(23)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  console.log(`\n📊 Creative Radar Data:`);
  console.log(`   Scored posts: ${scoredPosts.length}`);
  console.log(`   Briefs: ${Object.keys(briefs).join(', ')}`);

  if (experiments.length === 0) {
    console.log('\n📋 No experiments yet. Run without --status to create one.');
    return;
  }

  console.log(`\n📋 Experiments (${experiments.length}):`);
  for (const exp of experiments) {
    const icon = exp.status === 'generated' ? '✅' : exp.status === 'published' ? '🚀' : exp.status === 'generating' ? '⏳' : '📝';
    console.log(`\n  ${icon} ${exp.id}`);
    console.log(`     Created: ${exp.created_at}`);
    console.log(`     Stages: ${exp.stages.join(', ')}`);
    console.log(`     Prompts: ${exp.prompts.length} (${exp.variants_per_stage} variants/stage)`);
    console.log(`     Status: ${exp.status}${exp.batch_name ? ` → batch: ${exp.batch_name}` : ''}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Creative Radar → Sora Experiment Runner

USAGE:
  npx tsx scripts/creative-radar-experiment.ts [OPTIONS]

OPTIONS:
  --offer NAME         Offer key (default: everreach)
  --stages LIST        Comma-separated stages (default: all 5)
  --variants N         Variants per stage (default: 1, max 3)
  --generate           Run Sora generation (otherwise preview only)
  --save-batch         Save as batch for sora-content-generator.ts
  --status             Show experiment history
  --help               Show this help
`);
    return;
  }

  const getArg = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
  };
  const offer = getArg('--offer', 'everreach');
  const stagesArg = args.includes('--stages') ? getArg('--stages', '') : '';
  const variants = Math.min(3, Math.max(1, parseInt(getArg('--variants', '1'))));
  const generate = args.includes('--generate');
  const saveBatch = args.includes('--save-batch') || !generate;

  if (args.includes('--status')) {
    showStatus(offer);
    return;
  }

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   🧪 CREATIVE RADAR → SORA EXPERIMENT RUNNER               ║');
  console.log('║   Market Research Briefs → AI Video Prompts                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n📅 ${new Date().toISOString().split('T')[0]}`);
  console.log(`🎯 Offer: ${offer} | Variants: ${variants}/stage${generate ? ' | 🚀 GENERATE' : ' | 📋 PREVIEW'}`);

  // Load Creative Radar data
  const { briefs, patterns, scoredPosts } = loadRadarData(offer);
  const allStages = Object.keys(briefs);
  const targetStages = stagesArg ? stagesArg.split(',').filter(s => allStages.includes(s)) : allStages;

  if (targetStages.length === 0) {
    console.log(`\n❌ No valid stages. Available: ${allStages.join(', ')}`);
    process.exit(1);
  }

  console.log(`\n📊 Loaded: ${scoredPosts.length} scored posts, ${allStages.length} briefs, ${(patterns.hook_templates || []).length} hooks`);
  console.log(`🎬 Target stages: ${targetStages.join(', ')}`);
  console.log(`📹 Will generate: ${targetStages.length * variants} prompts`);

  // Generate prompts from briefs
  const allPrompts: SoraPrompt[] = [];
  for (const stage of targetStages) {
    const brief = briefs[stage];
    if (!brief) continue;
    const stagePrompts = briefToSoraPrompts(brief, offer, patterns, variants);
    allPrompts.push(...stagePrompts);
  }

  // Display prompts
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`📋 GENERATED ${allPrompts.length} SORA PROMPTS FROM CREATIVE RADAR:`);
  console.log(`${'═'.repeat(64)}`);

  for (const p of allPrompts) {
    console.log(`\n  🎬 ${p.title}`);
    console.log(`     Hook: ${p.caption.split('\n')[0]}`);
    console.log(`     Prompt: ${p.sora_prompt.slice(0, 120)}...`);
    console.log(`     Tags: ${p.hashtags.slice(0, 5).map(t => `#${t}`).join(' ')}`);
  }

  // Create experiment record
  const experiment: Experiment = {
    id: `exp-${offer}-${Date.now()}`,
    offer,
    created_at: new Date().toISOString(),
    stages: targetStages,
    variants_per_stage: variants,
    prompts: allPrompts,
    status: 'created',
  };

  // Save as Sora batch
  if (saveBatch) {
    fs.mkdirSync(BATCH_DIR, { recursive: true });
    const batch = {
      id: experiment.id,
      generated_at: experiment.created_at,
      mode: 'creative-radar',
      source_offer: offer,
      prompts: allPrompts,
      stats: {
        total: allPrompts.length,
        stages: targetStages.length,
        variants_per_stage: variants,
      },
    };
    fs.writeFileSync(BATCH_FILE, JSON.stringify(batch, null, 2));
    console.log(`\n💾 Batch saved: ${BATCH_FILE}`);
    console.log(`   Generate videos: npx tsx scripts/sora-content-generator.ts --from-batch --generate`);
  }

  // Run Sora generation
  if (generate) {
    experiment.status = 'generating';
    saveExperiment(offer, experiment);

    console.log('\n🚀 Running Sora generation...');
    try {
      const { execSync } = await import('child_process');
      // Save batch first, then use --from-batch
      fs.mkdirSync(BATCH_DIR, { recursive: true });
      const batch = {
        id: experiment.id,
        generated_at: experiment.created_at,
        mode: 'creative-radar',
        prompts: allPrompts,
        stats: { total: allPrompts.length },
      };
      fs.writeFileSync(BATCH_FILE, JSON.stringify(batch, null, 2));

      execSync(`npx tsx scripts/sora-content-generator.ts --from-batch --generate`, {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        timeout: 45 * 60 * 1000,
      });

      experiment.status = 'generated';
      experiment.batch_name = experiment.id;
      console.log('\n✅ Generation complete!');
    } catch (e: any) {
      console.log(`\n❌ Generation failed: ${e.message}`);
      experiment.status = 'created';
    }
  }

  // Save experiment
  saveExperiment(offer, experiment);
  console.log(`\n📝 Experiment saved: ${experiment.id}`);
  console.log(`   View history: npx tsx scripts/creative-radar-experiment.ts --status --offer ${offer}`);

  // Summary
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  🧪 EXPERIMENT SUMMARY`);
  console.log(`${'═'.repeat(64)}`);
  console.log(`  Offer:     ${offer}`);
  console.log(`  Stages:    ${targetStages.join(', ')}`);
  console.log(`  Prompts:   ${allPrompts.length}`);
  console.log(`  Status:    ${experiment.status}`);
  if (saveBatch && !generate) {
    console.log(`\n  Next steps:`);
    console.log(`    1. Review prompts above`);
    console.log(`    2. Generate: npx tsx scripts/sora-content-generator.ts --from-batch --generate`);
    console.log(`    3. Queue:    npx tsx scripts/daily-content-pipeline.ts --count 4 --platform youtube`);
    console.log(`    4. Drain:    npx tsx scripts/queue-drain.ts`);
  }
}

main().catch(console.error);
