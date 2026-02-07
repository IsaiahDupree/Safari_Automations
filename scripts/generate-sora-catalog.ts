#!/usr/bin/env npx tsx
/**
 * Sora Master Video Catalog Generator
 * Reads all config files, scans disk, and produces a unified catalog
 * Output: ~/sora-videos/SORA_MASTER_CATALOG.json + .md
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..');
const SORA_DIR = path.join(process.env.HOME || '', 'sora-videos');

// ============================================================================
// TYPES
// ============================================================================

interface VideoEntry {
  part: number;
  title: string;
  prompt: string;
  filename: string;
  path: string;
  exists: boolean;
  fileSize: string;
  stage?: string;
  cleanedPath?: string;
  cleanedExists?: boolean;
}

interface MovieEntry {
  id: number;
  title: string;
  theme: string;
  format: string;
  category: string;
  totalParts: number;
  folder: string;
  loveInterest?: { name: string; description: string };
  loveType?: string;
  finalVideo?: { path: string; exists: boolean; fileSize: string };
  videos: VideoEntry[];
}

interface CatalogSummary {
  totalMovies: number;
  totalIndividualVideos: number;
  totalFinalVideos: number;
  totalFilesOnDisk: number;
  categoryCounts: Record<string, { movies: number; videos: number }>;
  publishReady: number;
}

interface MasterCatalog {
  generatedAt: string;
  character: string;
  summary: CatalogSummary;
  movies: MovieEntry[];
}

// ============================================================================
// HELPERS
// ============================================================================

function fileSize(filePath: string): string {
  try {
    const stats = fs.statSync(filePath);
    const kb = Math.round(stats.size / 1024 * 10) / 10;
    return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
  } catch { return 'N/A'; }
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

// ============================================================================
// LOAD CONFIGS
// ============================================================================

let movieId = 0;
const movies: MovieEntry[] = [];

// --- 1. Valentine's 22 Tips ---
console.log('📋 Loading Valentine\'s 22 Tips...');
const tipsConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'sora-valentines-22-tips.json'), 'utf-8'));
for (const v of tipsConfig.videos) {
  movieId++;
  const slug = `tip-${String(v.id).padStart(2, '0')}-${v.tipTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`;
  const rawPath = path.join(SORA_DIR, 'valentines-22-tips', `${slug}.mp4`);
  const cleanedPath = path.join(SORA_DIR, 'valentines-22-tips', 'cleaned', `cleaned_${slug}.mp4`);

  movies.push({
    id: movieId,
    title: `Valentine's Tip #${v.id}: ${v.tipTitle}`,
    theme: v.tipTitle,
    format: 'Standalone Short',
    category: "Valentine's 22 Tips",
    totalParts: 1,
    folder: 'valentines-22-tips',
    videos: [{
      part: 1,
      title: v.tipTitle,
      prompt: v.prompt,
      filename: `${slug}.mp4`,
      path: rawPath,
      exists: fileExists(rawPath),
      fileSize: fileSize(rawPath),
      cleanedPath,
      cleanedExists: fileExists(cleanedPath),
    }],
  });
}

// --- 2. Valentine's Love Trilogies ---
console.log('💕 Loading Valentine\'s Love Trilogies...');
const loveConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'sora-valentines-love-trilogies-v2.json'), 'utf-8'));
for (const m of loveConfig.movies) {
  movieId++;
  const movieKey = m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const movieDir = path.join(SORA_DIR, 'valentines-love', movieKey);
  const finalPath = path.join(movieDir, `${movieKey}-final.mp4`);

  const vids: VideoEntry[] = m.videos.map((v: any) => {
    const slug = `part-${v.part}-${v.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const rawPath = path.join(movieDir, `${slug}.mp4`);
    const cleanedPath = path.join(movieDir, 'cleaned', `cleaned_${slug}.mp4`);
    return {
      part: v.part,
      title: v.title,
      prompt: v.prompt,
      stage: v.stage,
      filename: `${slug}.mp4`,
      path: rawPath,
      exists: fileExists(rawPath),
      fileSize: fileSize(rawPath),
      cleanedPath,
      cleanedExists: fileExists(cleanedPath),
    };
  });

  movies.push({
    id: movieId,
    title: m.title,
    theme: m.theme,
    format: 'Love Trilogy (3 parts)',
    category: "Valentine's Love Trilogies",
    totalParts: 3,
    folder: `valentines-love/${movieKey}`,
    loveType: m.loveType,
    loveInterest: m.loveInterest,
    finalVideo: { path: finalPath, exists: fileExists(finalPath), fileSize: fileSize(finalPath) },
    videos: vids,
  });
}

// --- 3. Action Trilogies (from sora-trilogy-runner.ts presets) ---
console.log('💥 Loading Action Trilogies...');
const STORY_PRESETS: Record<string, { title: string; prompt: string }[]> = {
  badass: [
    { title: 'Volcano Surfing', prompt: '@isaiahdupree rides a titanium surfboard down the side of an erupting volcano, molten lava spraying on both sides, wearing a flame-resistant suit with the visor up showing pure determination. Explosions of fire behind them as they carve through rivers of magma, the sky glowing orange and red.' },
    { title: 'Skydive Through Lightning', prompt: '@isaiahdupree freefalls through a massive thunderstorm without a parachute, lightning bolts striking all around them, electricity arcing off their wingsuit. They spin and dodge between bolts, grinning as they plummet through the chaos of the storm, clouds swirling violently.' },
    { title: 'Riding a Meteor', prompt: '@isaiahdupree stands on a flaming meteor hurtling through Earths atmosphere, the ground rapidly approaching below. Fire and plasma trail behind as they surf the space rock, then at the last second leap off and deploy a parachute as the meteor explodes into the ocean behind them in a massive impact.' },
  ],
  'space-journey': [
    { title: 'Earth Departure', prompt: '@isaiahdupree stands at the launchpad in a sleek white spacesuit, gazing up at a massive rocket against a brilliant sunrise. Countdown begins as steam billows from the engines. The rocket ignites with a thunderous roar, and @isaiahdupree waves goodbye to Earth as the spacecraft lifts off, climbing through clouds into the darkening sky above.' },
    { title: 'Moon Landing', prompt: '@isaiahdupree descends the ladder of the lunar module onto the grey dusty surface of the Moon. Earth hangs blue and beautiful in the black sky above. @isaiahdupree plants a flag, takes a giant leap in the low gravity, and looks toward the distant red dot of Mars with determination in their eyes.' },
    { title: 'Mars Arrival', prompt: '@isaiahdupree emerges from the spacecraft onto the rust-red Martian surface, massive mountains and canyons visible in the distance. A dust devil swirls in the thin atmosphere. @isaiahdupree raises their arms in triumph, the first human to walk on Mars, as the sun sets casting long shadows across the alien landscape.' },
  ],
  volcanic_fury: [
    { title: 'The Awakening', prompt: '@isaiahdupree stands at the base of an erupting volcano at night, molten lava rivers flowing around them. They wear a heat-resistant tactical suit with glowing orange accents. The ground trembles as they look up at the fiery peak, determination in their eyes. Ash falls like snow around them as they begin their ascent.' },
    { title: 'The Climb', prompt: '@isaiahdupree scales the volcanic cliff face as explosions of lava erupt nearby. They leap across a chasm of bubbling magma, grabbing a rock ledge mid-air. Sparks and embers swirl around them in slow motion. Their suit glows from the intense heat as they pull themselves up, never stopping.' },
    { title: 'The Summit', prompt: '@isaiahdupree stands victorious at the volcano crater edge, arms raised as a massive eruption explodes behind them. Lava fountains spray hundreds of feet into the air. They turn and run, then dive off the cliff edge, deploying a wingsuit as the volcano erupts fully behind them, silhouetted against the orange sky.' },
  ],
  abyssal_descent: [
    { title: 'The Dive', prompt: '@isaiahdupree descends in a sleek one-person submarine into the deep ocean. Sunlight fades as they pass schools of fish. Bioluminescent creatures begin appearing in the darkness. They activate the sub floodlights, revealing the alien landscape of the deep. Pressure gauge climbs as they go deeper.' },
    { title: 'The Discovery', prompt: '@isaiahdupree navigates through an underwater cave system, discovering an ancient sunken city with impossible architecture. Giant squid tentacles snake past the viewport. They spot a glowing artifact on a pedestal in the ruins. Bubbles stream past as they maneuver closer, the sub lights illuminating hieroglyphics.' },
    { title: 'The Escape', prompt: '@isaiahdupree grabs the glowing artifact as the ancient structure begins collapsing. A massive deep-sea creature awakens and gives chase. They pilot the sub through narrow passages at full speed, debris falling around them. Breaking through to open water, they rocket toward the surface as sunlight appears above, the creature retreating into the darkness below.' },
  ],
  neon_shadows: [
    { title: 'The Setup', prompt: '@isaiahdupree walks through a rain-soaked cyberpunk city street, neon signs reflecting in puddles. Holograms advertise in Japanese and English. They wear a sleek black jacket with LED trim, scanning the massive corporate tower ahead. Drones fly overhead. They check a holographic display on their wrist showing building schematics.' },
    { title: 'The Infiltration', prompt: '@isaiahdupree hacks through a laser grid in a high-tech corridor, fingers dancing over a holographic keyboard. Security drones patrol above. They slide under closing blast doors, roll to their feet, and run through a server room with walls of blinking lights. Alarms begin blaring red as they reach the vault.' },
    { title: 'The Getaway', prompt: '@isaiahdupree crashes through a window on the 100th floor holding a glowing data cube, glass shattering in slow motion around them. They spread their arms, deploying a nanomesh wingsuit that glows with circuitry patterns. Flying between skyscrapers as police drones give chase, they weave through holographic billboards and disappear into the neon-lit night.' },
  ],
  frozen_edge: [
    { title: 'The Storm', prompt: '@isaiahdupree trudges through a violent Arctic blizzard, visibility near zero. Ice crystals coat their face mask and thermal suit. Lightning cracks across the frozen sky. They push forward against impossible winds, a massive glacier visible momentarily through breaks in the storm. Their breath freezes instantly in the air.' },
    { title: 'The Cave', prompt: '@isaiahdupree discovers an ice cave and takes shelter as the blizzard rages outside. Inside, they find ancient frozen creatures preserved in the crystal-clear ice walls. Blue light filters through, creating an ethereal glow. They start a fire with the last of their supplies, shadows dancing on the ice as a polar bear watches from deeper in the cave.' },
    { title: 'The Aurora', prompt: '@isaiahdupree emerges from the cave as the storm clears, revealing a sky exploding with the Northern Lights. Green, purple, and pink ribbons dance across the heavens. They climb to a frozen peak and stand silhouetted against the aurora, arms outstretched. A rescue helicopter appears on the horizon as the lights reflect off the endless ice below.' },
  ],
  titan_protocol: [
    { title: 'The Activation', prompt: '@isaiahdupree climbs into the cockpit of a 50-foot combat mech in an underground hangar. Displays flicker to life around them as they grip the controls. The mech eyes glow blue as it powers on. Steam vents and hydraulics hiss. The hangar doors open revealing a war-torn cityscape. They take the first thundering step forward.' },
    { title: 'The Battle', prompt: '@isaiahdupree pilots the mech through urban warfare, trading fire with enemy mechs. Buildings crumble from stray shots. They dodge a missile barrage, the mech rolling and firing its plasma cannon. Explosions light up the night as they engage multiple targets, the cockpit shaking from impacts. Sparks fly as they take a hit but keep fighting.' },
    { title: 'The Victory', prompt: '@isaiahdupree faces the massive enemy boss mech, twice their size. They charge forward, dodging energy beams. At the last second they slide the mech under the enemy, firing all weapons upward. The boss mech explodes spectacularly. @isaiahdupree stands their mech up in the flames, raises its mechanical fist in victory as dawn breaks over the liberated city.' },
  ],
  temporal_shift: [
    { title: 'Ancient Egypt', prompt: '@isaiahdupree materializes from a time portal in ancient Egypt, the pyramids being constructed in the background. Workers and overseers look in shock. Wearing modern tactical gear that stands out against the ancient setting. The sun blazes overhead as they walk toward the half-built Great Pyramid, sand swirling around the temporal distortion behind them.' },
    { title: 'Medieval Battle', prompt: '@isaiahdupree appears in the middle of a medieval battlefield, armies clashing with swords and arrows. They dodge a charging knight on horseback, then sprint through the chaos. Castles burn in the distance. They reach a stone monument and activate their time device again, disappearing in a flash of light as soldiers stare in disbelief.' },
    { title: 'The Future', prompt: '@isaiahdupree arrives in a utopian future city with floating buildings and clean energy towers. Flying vehicles soar overhead. The sky is perfect blue with rings visible like Saturn. They smile, finally home. Citizens in white clothing approach warmly. They look back one last time as the time portal closes, mission complete.' },
  ],
  midnight_run: [
    { title: 'The Challenge', prompt: '@isaiahdupree pulls up to a midnight street race in a matte black modified sports car, neon underglow reflecting on wet asphalt. Crowds line the empty highway. They step out, leather jacket gleaming, and accept the challenge from a rival crew. Engines rev aggressively. They slide back into the drivers seat, hands gripping the wheel.' },
    { title: 'The Race', prompt: '@isaiahdupree races through city streets at 200mph, drifting around corners with sparks flying. They weave through traffic, barely missing a bus. NOS activates with blue flames from the exhaust. Neck and neck with the rival, they shift gears and the speedometer climbs impossibly high. The city becomes a blur of lights.' },
    { title: 'The Finish', prompt: '@isaiahdupree crosses the finish line first by inches, the car smoking and steaming. They drift to a perfect stop as the crowd erupts. Stepping out victorious, they toss the keys to a friend. Police sirens approach in the distance. Everyone scatters. @isaiahdupree walks away calmly into an alley as their legend grows.' },
  ],
  way_of_dragon: [
    { title: 'The Training', prompt: '@isaiahdupree trains in a misty mountain temple at sunrise, executing perfect martial arts forms. Ancient masters watch from the shadows. Sweat drips as they punch through wooden boards, kick through ceramic, and meditate under a waterfall. Cherry blossoms fall around them as they master an ancient technique, hands glowing with chi energy.' },
    { title: 'The Tournament', prompt: '@isaiahdupree fights through a martial arts tournament in a grand arena. They defeat opponent after opponent with fluid precision. Flying kicks, rapid punches, acrobatic dodges. The crowd chants their name. In the semifinals, they face a massive fighter twice their size and take them down with a single pressure point strike.' },
    { title: 'The Champion', prompt: '@isaiahdupree faces the undefeated champion in the final match, an entire stadium watching. They exchange incredible blows, moving almost too fast to see. @isaiahdupree takes a hit but rises again. In slow motion, they leap and deliver the final spinning kick, landing perfectly as the champion falls. They bow respectfully, then raise the trophy.' },
  ],
};

for (const [storyName, chapters] of Object.entries(STORY_PRESETS)) {
  movieId++;
  const storyDir = path.join(SORA_DIR, storyName);
  const displayName = storyName.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const finalPath = path.join(storyDir, `${storyName}-final.mp4`);

  const vids: VideoEntry[] = chapters.map((ch, i) => {
    const rawPath = path.join(storyDir, `chapter-${i + 1}-raw.mp4`);
    const cleanedPath = path.join(storyDir, 'cleaned', `cleaned_chapter-${i + 1}-raw.mp4`);
    return {
      part: i + 1,
      title: ch.title,
      prompt: ch.prompt,
      filename: `chapter-${i + 1}-raw.mp4`,
      path: rawPath,
      exists: fileExists(rawPath),
      fileSize: fileSize(rawPath),
      cleanedPath,
      cleanedExists: fileExists(cleanedPath),
    };
  });

  movies.push({
    id: movieId,
    title: displayName,
    theme: `${displayName} action trilogy`,
    format: 'Action Trilogy (3 parts)',
    category: 'Action Trilogies',
    totalParts: 3,
    folder: storyName,
    finalVideo: { path: finalPath, exists: fileExists(finalPath), fileSize: fileSize(finalPath) },
    videos: vids,
  });
}

// --- 4. Hero's Journeys (from existing catalog JSON) ---
console.log('⚔️  Loading Hero\'s Journeys & Classic Trilogies...');
const existingCatalog = JSON.parse(fs.readFileSync(path.join(SORA_DIR, 'VIDEO_CATALOG.json'), 'utf-8'));
for (const m of existingCatalog.movies) {
  // Skip entries 13-19 (action trilogies already added from presets above)
  if (m.id >= 13) continue;

  movieId++;
  let category = 'Hero\'s Journeys';
  if (m.format === '6-Part Epic') category = '6-Part Epics';
  if (m.format.includes('Trilogy')) category = 'Classic Trilogies';

  const vids: VideoEntry[] = m.videos.map((v: any) => ({
    part: v.part,
    title: v.title,
    prompt: v.prompt,
    stage: v.stage,
    filename: v.filename,
    path: v.path,
    exists: fileExists(v.path),
    fileSize: fileSize(v.path),
  }));

  movies.push({
    id: movieId,
    title: m.title,
    theme: m.theme,
    format: m.format,
    category,
    totalParts: m.totalParts,
    folder: m.folder,
    videos: vids,
  });
}

// --- 5. Badass Marathon (13 standalone action videos) ---
console.log('🔥 Loading Badass Marathon...');
const marathonDir = path.join(SORA_DIR, 'badass-marathon');
const marathonFiles = fs.readdirSync(marathonDir).filter(f => f.endsWith('.mp4') && !f.includes('cleaned')).sort();
movieId++;
movies.push({
  id: movieId,
  title: 'BADASS MARATHON',
  theme: '13 standalone extreme action videos',
  format: 'Marathon (13 standalone)',
  category: 'Badass Marathon',
  totalParts: marathonFiles.length,
  folder: 'badass-marathon',
  videos: marathonFiles.map((f, i) => {
    const fullPath = path.join(marathonDir, f);
    const cleanedPath = path.join(marathonDir, 'cleaned', `cleaned_${f}`);
    return {
      part: i + 1,
      title: f.replace('.mp4', ''),
      prompt: '(Generated from Sora badass action preset — individual prompts not stored)',
      filename: f,
      path: fullPath,
      exists: true,
      fileSize: fileSize(fullPath),
      cleanedPath,
      cleanedExists: fileExists(cleanedPath),
    };
  }),
});

// --- 6. Chad Advice ---
console.log('😎 Loading Chad Advice...');
const chadDir = path.join(SORA_DIR, 'chad-advice');
const chadFiles = fs.readdirSync(chadDir).filter(f => f.endsWith('.mp4')).sort();
let chadConfig: any = null;
try {
  chadConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'sora-valentines-chad-advice.json'), 'utf-8'));
} catch { /* no config found */ }

movieId++;
movies.push({
  id: movieId,
  title: 'CHAD ADVICE',
  theme: 'Direct-to-camera confidence and dating advice',
  format: `Standalone (${chadFiles.length} videos)`,
  category: 'Chad Advice',
  totalParts: chadFiles.length,
  folder: 'chad-advice',
  videos: chadFiles.map((f, i) => {
    const fullPath = path.join(chadDir, f);
    const matchingPrompt = chadConfig?.videos?.find((v: any) => v.id === parseInt(f.split('-')[0]));
    return {
      part: parseInt(f.split('-')[0]) || i + 1,
      title: f.replace('.mp4', '').replace(/^\d+-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      prompt: matchingPrompt?.prompt || '(Prompt stored in sora-valentines-chad-advice.json)',
      filename: f,
      path: fullPath,
      exists: true,
      fileSize: fileSize(fullPath),
    };
  }),
});

// --- 7. Old Storytelling Batch (archived) ---
console.log('📦 Loading Old Storytelling Batch...');
const oldBatchDir = path.join(SORA_DIR, 'valentines-22-tips', 'old-storytelling-batch');
if (fs.existsSync(oldBatchDir)) {
  const oldFiles = fs.readdirSync(oldBatchDir).filter(f => f.endsWith('.mp4')).sort();
  movieId++;
  movies.push({
    id: movieId,
    title: 'VALENTINE\'S TIPS — OLD STORYTELLING BATCH (Archived)',
    theme: 'Original Valentine\'s tips in storytelling format (replaced by direct-to-camera batch)',
    format: `Archived (${oldFiles.length} videos)`,
    category: 'Archived',
    totalParts: oldFiles.length,
    folder: 'valentines-22-tips/old-storytelling-batch',
    videos: oldFiles.map((f, i) => ({
      part: i + 1,
      title: f.replace('.mp4', '').replace(/^tip-\d+-/, '').replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      prompt: '(Original storytelling prompts — replaced by cinematic direct-to-camera format)',
      filename: f,
      path: path.join(oldBatchDir, f),
      exists: true,
      fileSize: fileSize(path.join(oldBatchDir, f)),
    })),
  });
}

// ============================================================================
// BUILD SUMMARY
// ============================================================================

const categoryCounts: Record<string, { movies: number; videos: number }> = {};
let totalVideos = 0;
let totalFinals = 0;
let publishReady = 0;

for (const m of movies) {
  if (!categoryCounts[m.category]) categoryCounts[m.category] = { movies: 0, videos: 0 };
  categoryCounts[m.category].movies++;
  categoryCounts[m.category].videos += m.videos.length;
  totalVideos += m.videos.length;
  if (m.finalVideo?.exists) totalFinals++;
  // Count publish-ready: cleaned standalone or final exists
  if (m.category === "Valentine's 22 Tips") {
    publishReady += m.videos.filter(v => v.cleanedExists).length;
  } else if (m.finalVideo?.exists) {
    publishReady++;
  }
}

const totalFilesOnDisk = parseInt(execSync(`find ${SORA_DIR} -name "*.mp4" | wc -l`).toString().trim());

const catalog: MasterCatalog = {
  generatedAt: new Date().toISOString(),
  character: '@isaiahdupree',
  summary: {
    totalMovies: movies.length,
    totalIndividualVideos: totalVideos,
    totalFinalVideos: totalFinals,
    totalFilesOnDisk,
    categoryCounts,
    publishReady,
  },
  movies,
};

// ============================================================================
// WRITE JSON
// ============================================================================

const jsonPath = path.join(SORA_DIR, 'SORA_MASTER_CATALOG.json');
fs.writeFileSync(jsonPath, JSON.stringify(catalog, null, 2));
console.log(`\n✅ JSON catalog written: ${jsonPath}`);

// ============================================================================
// WRITE MARKDOWN
// ============================================================================

let md = `# @isaiahdupree — Sora Master Video Catalog\n\n`;
md += `> **Generated:** ${new Date().toLocaleString()}\n`;
md += `> **Character:** @isaiahdupree\n\n`;
md += `## Summary\n\n`;
md += `| Metric | Count |\n|---|---|\n`;
md += `| Total Movies/Collections | ${catalog.summary.totalMovies} |\n`;
md += `| Total Individual Videos | ${catalog.summary.totalIndividualVideos} |\n`;
md += `| Stitched Final Videos | ${catalog.summary.totalFinalVideos} |\n`;
md += `| Total .mp4 Files on Disk | ${catalog.summary.totalFilesOnDisk} |\n`;
md += `| **Publish-Ready Videos** | **${catalog.summary.publishReady}** |\n\n`;

md += `### By Category\n\n`;
md += `| Category | Movies | Videos |\n|---|---|---|\n`;
for (const [cat, counts] of Object.entries(categoryCounts)) {
  md += `| ${cat} | ${counts.movies} | ${counts.videos} |\n`;
}
md += `\n---\n\n`;

// Group by category
const byCategory: Record<string, MovieEntry[]> = {};
for (const m of movies) {
  if (!byCategory[m.category]) byCategory[m.category] = [];
  byCategory[m.category].push(m);
}

for (const [category, catMovies] of Object.entries(byCategory)) {
  md += `## ${category}\n\n`;

  for (const m of catMovies) {
    md += `### ${m.id}. ${m.title}\n\n`;
    md += `- **Theme:** ${m.theme}\n`;
    md += `- **Format:** ${m.format}\n`;
    md += `- **Folder:** \`${m.folder}\`\n`;
    if (m.loveType) md += `- **Love Type:** ${m.loveType}\n`;
    if (m.loveInterest) md += `- **Love Interest:** ${m.loveInterest.name} — ${m.loveInterest.description.slice(0, 100)}...\n`;
    if (m.finalVideo) {
      md += `- **Final Video:** \`${path.basename(m.finalVideo.path)}\` ${m.finalVideo.exists ? `✅ (${m.finalVideo.fileSize})` : '❌ Missing'}\n`;
    }
    md += `\n`;

    md += `| Part | Title | File | Status | Size |\n`;
    md += `|------|-------|------|--------|------|\n`;
    for (const v of m.videos) {
      const status = v.cleanedExists ? '✅ Cleaned' : v.exists ? '⚠️ Raw only' : '❌ Missing';
      md += `| ${v.part} | ${v.title} | \`${v.filename}\` | ${status} | ${v.fileSize} |\n`;
    }
    md += `\n`;

    md += `<details>\n<summary>📜 Prompts</summary>\n\n`;
    for (const v of m.videos) {
      md += `**Part ${v.part}: ${v.title}**${v.stage ? ` *(${v.stage})*` : ''}\n`;
      md += `> ${v.prompt}\n\n`;
    }
    md += `</details>\n\n---\n\n`;
  }
}

const mdPath = path.join(SORA_DIR, 'SORA_MASTER_CATALOG.md');
fs.writeFileSync(mdPath, md);
console.log(`✅ Markdown catalog written: ${mdPath}`);

// Final summary
console.log(`\n${'═'.repeat(60)}`);
console.log(`📊 SORA MASTER CATALOG — COMPLETE`);
console.log(`${'═'.repeat(60)}`);
console.log(`   Movies/Collections: ${catalog.summary.totalMovies}`);
console.log(`   Individual Videos:  ${catalog.summary.totalIndividualVideos}`);
console.log(`   Stitched Finals:    ${catalog.summary.totalFinalVideos}`);
console.log(`   Files on Disk:      ${catalog.summary.totalFilesOnDisk}`);
console.log(`   Publish-Ready:      ${catalog.summary.publishReady}`);
console.log(`\n   JSON: ${jsonPath}`);
console.log(`   MD:   ${mdPath}`);
