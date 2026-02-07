#!/usr/bin/env npx tsx
/**
 * Universal Sora Story Generator CLI
 * Prompt-agnostic system for generating any type of video story
 * 
 * Usage:
 *   npx tsx scripts/sora-generate.ts --help
 *   npx tsx scripts/sora-generate.ts templates                    # List templates
 *   npx tsx scripts/sora-generate.ts generate --theme "..." --template heros-journey
 *   npx tsx scripts/sora-generate.ts run --config story.json
 *   npx tsx scripts/sora-generate.ts batch --themes themes.json --template love-story
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { SoraStoryGenerator, STORY_TEMPLATES, StoryConfig, Character } from '../packages/services/src/sora/story-generator';

const SORA_VIDEOS_DIR = path.join(process.env.HOME || '', 'sora-videos');

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║   🎬 SORA UNIVERSAL STORY GENERATOR                                  ║
║   Generate any type of video story with AI-powered prompts           ║
╚══════════════════════════════════════════════════════════════════════╝

COMMANDS:
  templates              List all available story templates
  generate               Generate prompts for a single story
  batch                  Generate prompts for multiple stories
  run                    Run Sora generation from a config file
  quick                  Quick generate & run (all-in-one)

GENERATE OPTIONS:
  --theme <text>         Story theme/description (required)
  --title <text>         Story title (optional, derived from theme)
  --template <name>      Template: heros-journey, love-story, action-trilogy, 
                         transformation, epic-saga (default: action-trilogy)
  --character <name>     Main character (default: @isaiahdupree)
  --secondary <json>     Secondary character as JSON: '{"name":"X","description":"Y"}'
  --style <text>         Visual style guidance
  --output <path>        Output JSON file path

BATCH OPTIONS:
  --themes <path>        JSON file with array of themes
  --template <name>      Template to use for all stories
  --output <path>        Output JSON file path

RUN OPTIONS:
  --config <path>        Path to story config JSON
  --start-movie <n>      Start from movie number (default: 1)
  --start-part <n>       Start from part number (default: 1)
  --output-dir <path>    Output directory (default: ~/sora-videos/<project>)

QUICK OPTIONS:
  --theme <text>         Story theme (required)
  --template <name>      Template to use
  --project <name>       Project name for output folder

EXAMPLES:
  # List available templates
  npx tsx scripts/sora-generate.ts templates

  # Generate a hero's journey story about space exploration
  npx tsx scripts/sora-generate.ts generate \\
    --theme "An astronaut discovers alien life on Mars" \\
    --template heros-journey \\
    --output space-story.json

  # Generate love story with secondary character
  npx tsx scripts/sora-generate.ts generate \\
    --theme "Two artists find love in Paris" \\
    --template love-story \\
    --secondary '{"name":"Claire","description":"A French painter with red hair"}' \\
    --output paris-love.json

  # Run generation from config
  npx tsx scripts/sora-generate.ts run --config paris-love.json

  # Quick all-in-one
  npx tsx scripts/sora-generate.ts quick \\
    --theme "A warrior's quest for redemption" \\
    --template heros-journey \\
    --project warrior-redemption
`);
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
      result[key] = value;
      if (value !== 'true') i++;
    }
  }
  return result;
}

async function cmdTemplates() {
  const generator = new SoraStoryGenerator();
  generator.listTemplates();
}

async function cmdGenerate(args: Record<string, string>) {
  if (!args.theme) {
    console.error('❌ --theme is required');
    process.exit(1);
  }

  const generator = new SoraStoryGenerator();
  const template = args.template || 'action-trilogy';
  const character = args.character || '@isaiahdupree';
  
  let secondaryCharacter: Character | undefined;
  if (args.secondary) {
    try {
      secondaryCharacter = JSON.parse(args.secondary);
    } catch {
      console.error('❌ Invalid --secondary JSON');
      process.exit(1);
    }
  }

  console.log('\n🎬 Generating story prompts...');
  console.log(`   Theme: ${args.theme}`);
  console.log(`   Template: ${template}`);
  console.log(`   Character: ${character}`);
  if (secondaryCharacter) {
    console.log(`   Secondary: ${secondaryCharacter.name}`);
  }

  const videos = await generator.generatePromptsFromTheme({
    theme: args.theme,
    character,
    secondaryCharacter,
    template,
    style: args.style
  });

  const templateInfo = STORY_TEMPLATES[template];
  const story: StoryConfig = {
    id: 1,
    title: args.title || args.theme.split(' ').slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    theme: args.theme,
    format: templateInfo.format,
    totalParts: templateInfo.stages.length,
    character,
    secondaryCharacter,
    storyStructure: template,
    videos
  };

  const outputPath = args.output || `sora-story-${Date.now()}.json`;
  generator.saveStoryConfig([story], outputPath, {
    character,
    template,
    theme: args.theme
  });

  console.log('\n✅ Story config generated!');
  console.log(`   Output: ${outputPath}`);
  console.log(`   Videos: ${videos.length}`);
  console.log('\n📝 Generated prompts:');
  for (const v of videos) {
    console.log(`\n   Part ${v.part}: ${v.title}`);
    console.log(`   Stage: ${v.stage}`);
    console.log(`   Prompt: ${v.prompt.slice(0, 100)}...`);
  }

  console.log(`\n🚀 To run generation: npx tsx scripts/sora-generate.ts run --config ${outputPath}`);
}

async function cmdBatch(args: Record<string, string>) {
  if (!args.themes) {
    console.error('❌ --themes JSON file is required');
    process.exit(1);
  }

  const generator = new SoraStoryGenerator();
  const template = args.template || 'action-trilogy';
  const character = args.character || '@isaiahdupree';

  const themesData = JSON.parse(fs.readFileSync(args.themes, 'utf-8'));
  const themes = Array.isArray(themesData) ? themesData : themesData.themes;

  console.log(`\n🎬 Generating ${themes.length} stories using "${template}" template...`);

  const stories = await generator.generateBatchStories({
    themes,
    character,
    template,
    style: args.style
  });

  const outputPath = args.output || `sora-batch-${Date.now()}.json`;
  generator.saveStoryConfig(stories, outputPath, {
    character,
    template,
    batchSource: args.themes
  });

  console.log('\n✅ Batch config generated!');
  console.log(`   Stories: ${stories.length}`);
  console.log(`   Total videos: ${stories.reduce((s, m) => s + m.videos.length, 0)}`);
  console.log(`   Output: ${outputPath}`);
}

async function cmdRun(args: Record<string, string>) {
  if (!args.config) {
    console.error('❌ --config is required');
    process.exit(1);
  }

  const generator = new SoraStoryGenerator();
  const stories = generator.loadStoryConfig(args.config);

  if (stories.length === 0) {
    console.error('❌ No stories found in config');
    process.exit(1);
  }

  const projectName = path.basename(args.config, '.json');
  const outputDir = args['output-dir'] || path.join(SORA_VIDEOS_DIR, projectName);

  console.log('\n🎬 Starting Sora generation...');
  console.log(`   Stories: ${stories.length}`);
  console.log(`   Total videos: ${stories.reduce((s, m) => s + m.videos.length, 0)}`);
  console.log(`   Output: ${outputDir}`);

  // Check credits first
  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  const sora = new SoraFullAutomation();
  const usage = await sora.getUsage();
  const totalNeeded = stories.reduce((s, m) => s + m.videos.length, 0);

  console.log(`\n📊 Credits: ${usage.videoGensLeft ?? 'Unknown'} available, ${totalNeeded} needed`);

  if (usage.videoGensLeft !== null && usage.videoGensLeft < totalNeeded) {
    console.log(`⚠️  Warning: Not enough credits. Will generate as many as possible.`);
  }

  const result = await generator.runGeneration(stories, {
    outputDir,
    startFromMovie: parseInt(args['start-movie'] || '1'),
    startFromPart: parseInt(args['start-part'] || '1')
  });

  console.log('\n' + '═'.repeat(70));
  console.log('📊 GENERATION COMPLETE');
  console.log('═'.repeat(70));
  console.log(`   Completed: ${result.completed}`);
  console.log(`   Failed: ${result.failed}`);
  console.log(`   Output: ${outputDir}`);
}

async function cmdQuick(args: Record<string, string>) {
  if (!args.theme) {
    console.error('❌ --theme is required');
    process.exit(1);
  }

  const template = args.template || 'action-trilogy';
  const projectName = args.project || `quick-${Date.now()}`;
  const configPath = path.join(__dirname, '..', `${projectName}.json`);

  // Generate
  console.log('\n📝 Step 1: Generating prompts...');
  await cmdGenerate({ ...args, output: configPath });

  // Run
  console.log('\n🎬 Step 2: Running Sora generation...');
  await cmdRun({ config: configPath, 'output-dir': path.join(SORA_VIDEOS_DIR, projectName) });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const options = parseArgs(args.slice(1));

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  switch (command) {
    case 'templates':
      await cmdTemplates();
      break;
    case 'generate':
      await cmdGenerate(options);
      break;
    case 'batch':
      await cmdBatch(options);
      break;
    case 'run':
      await cmdRun(options);
      break;
    case 'quick':
      await cmdQuick(options);
      break;
    default:
      console.error(`❌ Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
