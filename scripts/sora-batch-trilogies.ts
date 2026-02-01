#!/usr/bin/env npx tsx
/**
 * Sora Batch Trilogy Runner
 * Main feature for running multiple trilogies sequentially (one after another)
 * Safest approach - waits for each to complete before starting next
 * 
 * Usage:
 *   npx tsx scripts/sora-batch-trilogies.ts --all              # Run all 9 trilogies
 *   npx tsx scripts/sora-batch-trilogies.ts --list             # List available trilogies
 *   npx tsx scripts/sora-batch-trilogies.ts --run 1 2 3        # Run specific trilogies by number
 *   npx tsx scripts/sora-batch-trilogies.ts --skip 1 2         # Run all except 1 and 2
 *   npx tsx scripts/sora-batch-trilogies.ts --from 3           # Start from trilogy 3
 *   npx tsx scripts/sora-batch-trilogies.ts --status           # Check generation status
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TRILOGY DEFINITIONS
// ============================================================================

interface Trilogy {
  id: number;
  name: string;
  key: string;
  theme: string;
  videos: Array<{ title: string; prompt: string }>;
}

const TRILOGIES: Trilogy[] = [
  {
    id: 1,
    name: 'Volcanic Fury',
    key: 'volcanic_fury',
    theme: 'Conquering an active volcano',
    videos: [
      { title: 'Part 1: The Awakening', prompt: '@isaiahdupree stands at the base of an erupting volcano at night, molten lava rivers flowing around them. They wear a heat-resistant tactical suit with glowing orange accents. The ground trembles as they look up at the fiery peak, determination in their eyes. Ash falls like snow around them as they begin their ascent.' },
      { title: 'Part 2: The Climb', prompt: '@isaiahdupree scales the volcanic cliff face as explosions of lava erupt nearby. They leap across a chasm of bubbling magma, grabbing a rock ledge mid-air. Sparks and embers swirl around them in slow motion. Their suit glows from the intense heat as they pull themselves up, never stopping.' },
      { title: 'Part 3: The Summit', prompt: '@isaiahdupree stands victorious at the volcano crater edge, arms raised as a massive eruption explodes behind them. Lava fountains spray hundreds of feet into the air. They turn and run, then dive off the cliff edge, deploying a wingsuit as the volcano erupts fully behind them, silhouetted against the orange sky.' },
    ],
  },
  {
    id: 2,
    name: 'Abyssal Descent',
    key: 'abyssal_descent',
    theme: 'Exploring the deepest ocean',
    videos: [
      { title: 'Part 1: The Dive', prompt: '@isaiahdupree descends in a sleek one-person submarine into the deep ocean. Sunlight fades as they pass schools of fish. Bioluminescent creatures begin appearing in the darkness. They activate the sub floodlights, revealing the alien landscape of the deep. Pressure gauge climbs as they go deeper.' },
      { title: 'Part 2: The Discovery', prompt: '@isaiahdupree navigates through an underwater cave system, discovering an ancient sunken city with impossible architecture. Giant squid tentacles snake past the viewport. They spot a glowing artifact on a pedestal in the ruins. Bubbles stream past as they maneuver closer, the sub lights illuminating hieroglyphics.' },
      { title: 'Part 3: The Escape', prompt: '@isaiahdupree grabs the glowing artifact as the ancient structure begins collapsing. A massive deep-sea creature awakens and gives chase. They pilot the sub through narrow passages at full speed, debris falling around them. Breaking through to open water, they rocket toward the surface as sunlight appears above, the creature retreating into the darkness below.' },
    ],
  },
  {
    id: 3,
    name: 'Neon Shadows',
    key: 'neon_shadows',
    theme: 'Cyberpunk heist',
    videos: [
      { title: 'Part 1: The Setup', prompt: '@isaiahdupree walks through a rain-soaked cyberpunk city street, neon signs reflecting in puddles. Holograms advertise in Japanese and English. They wear a sleek black jacket with LED trim, scanning the massive corporate tower ahead. Drones fly overhead. They check a holographic display on their wrist showing building schematics.' },
      { title: 'Part 2: The Infiltration', prompt: '@isaiahdupree hacks through a laser grid in a high-tech corridor, fingers dancing over a holographic keyboard. Security drones patrol above. They slide under closing blast doors, roll to their feet, and run through a server room with walls of blinking lights. Alarms begin blaring red as they reach the vault.' },
      { title: 'Part 3: The Getaway', prompt: '@isaiahdupree crashes through a window on the 100th floor holding a glowing data cube, glass shattering in slow motion around them. They spread their arms, deploying a nanomesh wingsuit that glows with circuitry patterns. Flying between skyscrapers as police drones give chase, they weave through holographic billboards and disappear into the neon-lit night.' },
    ],
  },
  {
    id: 4,
    name: 'Frozen Edge',
    key: 'frozen_edge',
    theme: 'Arctic survival',
    videos: [
      { title: 'Part 1: The Storm', prompt: '@isaiahdupree trudges through a violent Arctic blizzard, visibility near zero. Ice crystals coat their face mask and thermal suit. Lightning cracks across the frozen sky. They push forward against impossible winds, a massive glacier visible momentarily through breaks in the storm. Their breath freezes instantly in the air.' },
      { title: 'Part 2: The Cave', prompt: '@isaiahdupree discovers an ice cave and takes shelter as the blizzard rages outside. Inside, they find ancient frozen creatures preserved in the crystal-clear ice walls. Blue light filters through, creating an ethereal glow. They start a fire with the last of their supplies, shadows dancing on the ice as a polar bear watches from deeper in the cave.' },
      { title: 'Part 3: The Aurora', prompt: '@isaiahdupree emerges from the cave as the storm clears, revealing a sky exploding with the Northern Lights. Green, purple, and pink ribbons dance across the heavens. They climb to a frozen peak and stand silhouetted against the aurora, arms outstretched. A rescue helicopter appears on the horizon as the lights reflect off the endless ice below.' },
    ],
  },
  {
    id: 5,
    name: 'Titan Protocol',
    key: 'titan_protocol',
    theme: 'Mech warrior battle',
    videos: [
      { title: 'Part 1: The Activation', prompt: '@isaiahdupree climbs into the cockpit of a 50-foot combat mech in an underground hangar. Displays flicker to life around them as they grip the controls. The mech eyes glow blue as it powers on. Steam vents and hydraulics hiss. The hangar doors open revealing a war-torn cityscape. They take the first thundering step forward.' },
      { title: 'Part 2: The Battle', prompt: '@isaiahdupree pilots the mech through urban warfare, trading fire with enemy mechs. Buildings crumble from stray shots. They dodge a missile barrage, the mech rolling and firing its plasma cannon. Explosions light up the night as they engage multiple targets, the cockpit shaking from impacts. Sparks fly as they take a hit but keep fighting.' },
      { title: 'Part 3: The Victory', prompt: '@isaiahdupree faces the massive enemy boss mech, twice their size. They charge forward, dodging energy beams. At the last second they slide the mech under the enemy, firing all weapons upward. The boss mech explodes spectacularly. @isaiahdupree stands their mech up in the flames, raises its mechanical fist in victory as dawn breaks over the liberated city.' },
    ],
  },
  {
    id: 6,
    name: 'Temporal Shift',
    key: 'temporal_shift',
    theme: 'Time travel journey',
    videos: [
      { title: 'Part 1: Ancient Egypt', prompt: '@isaiahdupree materializes from a time portal in ancient Egypt, the pyramids being constructed in the background. Workers and overseers look in shock. Wearing modern tactical gear that stands out against the ancient setting. The sun blazes overhead as they walk toward the half-built Great Pyramid, sand swirling around the temporal distortion behind them.' },
      { title: 'Part 2: Medieval Battle', prompt: '@isaiahdupree appears in the middle of a medieval battlefield, armies clashing with swords and arrows. They dodge a charging knight on horseback, then sprint through the chaos. Castles burn in the distance. They reach a stone monument and activate their time device again, disappearing in a flash of light as soldiers stare in disbelief.' },
      { title: 'Part 3: The Future', prompt: '@isaiahdupree arrives in a utopian future city with floating buildings and clean energy towers. Flying vehicles soar overhead. The sky is perfect blue with rings visible like Saturn. They smile, finally home. Citizens in white clothing approach warmly. They look back one last time as the time portal closes, mission complete.' },
    ],
  },
  {
    id: 7,
    name: 'Midnight Run',
    key: 'midnight_run',
    theme: 'Street racing',
    videos: [
      { title: 'Part 1: The Challenge', prompt: '@isaiahdupree pulls up to a midnight street race in a matte black modified sports car, neon underglow reflecting on wet asphalt. Crowds line the empty highway. They step out, leather jacket gleaming, and accept the challenge from a rival crew. Engines rev aggressively. They slide back into the drivers seat, hands gripping the wheel.' },
      { title: 'Part 2: The Race', prompt: '@isaiahdupree races through city streets at 200mph, drifting around corners with sparks flying. They weave through traffic, barely missing a bus. NOS activates with blue flames from the exhaust. Neck and neck with the rival, they shift gears and the speedometer climbs impossibly high. The city becomes a blur of lights.' },
      { title: 'Part 3: The Finish', prompt: '@isaiahdupree crosses the finish line first by inches, the car smoking and steaming. They drift to a perfect stop as the crowd erupts. Stepping out victorious, they toss the keys to a friend. Police sirens approach in the distance. Everyone scatters. @isaiahdupree walks away calmly into an alley as their legend grows.' },
    ],
  },
  {
    id: 8,
    name: 'Way of the Dragon',
    key: 'way_of_dragon',
    theme: 'Martial arts master',
    videos: [
      { title: 'Part 1: The Training', prompt: '@isaiahdupree trains in a misty mountain temple at sunrise, executing perfect martial arts forms. Ancient masters watch from the shadows. Sweat drips as they punch through wooden boards, kick through ceramic, and meditate under a waterfall. Cherry blossoms fall around them as they master an ancient technique, hands glowing with chi energy.' },
      { title: 'Part 2: The Tournament', prompt: '@isaiahdupree fights through a martial arts tournament in a grand arena. They defeat opponent after opponent with fluid precision. Flying kicks, rapid punches, acrobatic dodges. The crowd chants their name. In the semifinals, they face a massive fighter twice their size and take them down with a single pressure point strike.' },
      { title: 'Part 3: The Champion', prompt: '@isaiahdupree faces the undefeated champion in the final match, an entire stadium watching. They exchange incredible blows, moving almost too fast to see. @isaiahdupree takes a hit but rises again. In slow motion, they leap and deliver the final spinning kick, landing perfectly as the champion falls. They bow respectfully, then raise the trophy.' },
    ],
  },
  {
    id: 9,
    name: 'First Contact',
    key: 'first_contact',
    theme: 'Meeting alien life',
    videos: [
      { title: 'Part 1: The Signal', prompt: '@isaiahdupree sits in a space station control room when alarms suddenly blare. A massive alien ship decloaks outside the window, larger than any human vessel. Strange symbols pulse on its hull. They rush to the airlock, suiting up as humanity receives its first confirmed extraterrestrial contact. Earth glows blue below, unaware.' },
      { title: 'Part 2: The Meeting', prompt: '@isaiahdupree floats through a crystalline alien corridor inside the ship, gravity shifting in impossible ways. Bioluminescent patterns guide them forward. They enter a vast chamber where beings of pure light take humanoid form. No words are spoken but understanding passes between them. @isaiahdupree reaches out a hand.' },
      { title: 'Part 3: The Gift', prompt: '@isaiahdupree returns to the space station carrying a glowing orb of alien technology. They present it to the assembled world leaders via hologram. The orb activates, projecting star maps showing the path to a thousand inhabited worlds. @isaiahdupree smiles as humanity realizes they are no longer alone. The alien ship departs, leaving a beacon.' },
    ],
  },
];

// ============================================================================
// STATUS TRACKING
// ============================================================================

interface BatchStatus {
  startedAt: string;
  trilogies: Array<{
    id: number;
    name: string;
    status: 'pending' | 'running' | 'complete' | 'failed';
    startedAt?: string;
    completedAt?: string;
    duration?: string;
    outputPath?: string;
    error?: string;
  }>;
  totalVideos: number;
  completedVideos: number;
  creditsUsed: number;
}

const STATUS_FILE = path.join(process.env.HOME || '', 'sora-videos', 'batch-status.json');

function loadStatus(): BatchStatus | null {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

function saveStatus(status: BatchStatus): void {
  const dir = path.dirname(STATUS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
}

// ============================================================================
// TRILOGY RUNNER
// ============================================================================

async function runTrilogy(trilogy: Trilogy): Promise<{ success: boolean; duration: number; outputPath?: string; error?: string }> {
  const startTime = Date.now();
  
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🎬 STARTING TRILOGY ${trilogy.id}: ${trilogy.name.toUpperCase()}`);
  console.log(`   Theme: ${trilogy.theme}`);
  console.log(`   Videos: ${trilogy.videos.length}`);
  console.log('═'.repeat(70));

  try {
    // Run the trilogy using the existing sora-trilogy-runner.ts
    const result = execSync(
      `npx tsx scripts/sora-trilogy-runner.ts --story ${trilogy.key}`,
      { 
        cwd: process.cwd(),
        stdio: 'inherit',
        timeout: 30 * 60 * 1000 // 30 minute timeout per trilogy
      }
    );

    const duration = Date.now() - startTime;
    const outputPath = path.join(process.env.HOME || '', 'sora-videos', trilogy.key, `${trilogy.key}-final.mp4`);
    
    if (fs.existsSync(outputPath)) {
      console.log(`\n✅ TRILOGY ${trilogy.id} COMPLETE: ${trilogy.name}`);
      console.log(`   Duration: ${Math.round(duration / 60000)} minutes`);
      console.log(`   Output: ${outputPath}`);
      return { success: true, duration, outputPath };
    } else {
      return { success: false, duration, error: 'Final video not found' };
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.log(`\n❌ TRILOGY ${trilogy.id} FAILED: ${errorMsg}`);
    return { success: false, duration, error: errorMsg };
  }
}

async function runBatch(trilogyIds: number[]): Promise<void> {
  const trilogiesToRun = TRILOGIES.filter(t => trilogyIds.includes(t.id));
  
  if (trilogiesToRun.length === 0) {
    console.log('❌ No valid trilogies selected');
    return;
  }

  const totalVideos = trilogiesToRun.length * 3;
  const startTime = new Date();

  console.log('\n' + '╔'.padEnd(71, '═') + '╗');
  console.log('║' + '  SORA BATCH TRILOGY RUNNER'.padEnd(70) + '║');
  console.log('║' + `  Sequential Generation - ${trilogiesToRun.length} trilogies, ${totalVideos} videos`.padEnd(70) + '║');
  console.log('║' + `  Estimated credits: ${totalVideos}`.padEnd(70) + '║');
  console.log('╚' + '═'.repeat(70) + '╝');

  console.log('\n📋 Queue:');
  trilogiesToRun.forEach((t, i) => {
    console.log(`   ${i + 1}. [${t.id}] ${t.name} - ${t.theme}`);
  });

  // Initialize status
  const status: BatchStatus = {
    startedAt: startTime.toISOString(),
    trilogies: trilogiesToRun.map(t => ({
      id: t.id,
      name: t.name,
      status: 'pending',
    })),
    totalVideos,
    completedVideos: 0,
    creditsUsed: 0,
  };
  saveStatus(status);

  // Run each trilogy sequentially
  for (let i = 0; i < trilogiesToRun.length; i++) {
    const trilogy = trilogiesToRun[i];
    const statusEntry = status.trilogies.find(t => t.id === trilogy.id)!;

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📊 PROGRESS: ${i + 1}/${trilogiesToRun.length} trilogies`);
    console.log(`   Completed: ${status.completedVideos}/${totalVideos} videos`);
    console.log(`   Credits used: ${status.creditsUsed}`);
    console.log('─'.repeat(70));

    statusEntry.status = 'running';
    statusEntry.startedAt = new Date().toISOString();
    saveStatus(status);

    const result = await runTrilogy(trilogy);

    if (result.success) {
      statusEntry.status = 'complete';
      statusEntry.completedAt = new Date().toISOString();
      statusEntry.duration = `${Math.round(result.duration / 60000)} min`;
      statusEntry.outputPath = result.outputPath;
      status.completedVideos += 3;
      status.creditsUsed += 3;
    } else {
      statusEntry.status = 'failed';
      statusEntry.error = result.error;
    }
    saveStatus(status);

    // Wait between trilogies to avoid rate limits
    if (i < trilogiesToRun.length - 1) {
      console.log('\n⏳ Waiting 30 seconds before next trilogy...');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }

  // Final summary
  const endTime = new Date();
  const totalDuration = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
  const successful = status.trilogies.filter(t => t.status === 'complete').length;
  const failed = status.trilogies.filter(t => t.status === 'failed').length;

  console.log('\n' + '╔'.padEnd(71, '═') + '╗');
  console.log('║' + '  BATCH COMPLETE'.padEnd(70) + '║');
  console.log('╠'.padEnd(71, '═') + '╣');
  console.log('║' + `  Total trilogies: ${trilogiesToRun.length}`.padEnd(70) + '║');
  console.log('║' + `  Successful: ${successful}`.padEnd(70) + '║');
  console.log('║' + `  Failed: ${failed}`.padEnd(70) + '║');
  console.log('║' + `  Videos generated: ${status.completedVideos}`.padEnd(70) + '║');
  console.log('║' + `  Credits used: ${status.creditsUsed}`.padEnd(70) + '║');
  console.log('║' + `  Total time: ${totalDuration} minutes`.padEnd(70) + '║');
  console.log('╚' + '═'.repeat(70) + '╝');

  if (successful > 0) {
    console.log('\n✅ Generated videos:');
    status.trilogies
      .filter(t => t.status === 'complete')
      .forEach(t => console.log(`   ${t.name}: ${t.outputPath}`));
  }

  if (failed > 0) {
    console.log('\n❌ Failed trilogies:');
    status.trilogies
      .filter(t => t.status === 'failed')
      .forEach(t => console.log(`   ${t.name}: ${t.error}`));
  }
}

// ============================================================================
// CLI
// ============================================================================

function listTrilogies(): void {
  console.log('\n📽️  AVAILABLE TRILOGIES (9 total, 27 videos)\n');
  console.log('┌─────┬──────────────────────┬────────────────────────────┐');
  console.log('│ ID  │ Name                 │ Theme                      │');
  console.log('├─────┼──────────────────────┼────────────────────────────┤');
  TRILOGIES.forEach(t => {
    console.log(`│ ${String(t.id).padEnd(3)} │ ${t.name.padEnd(20)} │ ${t.theme.padEnd(26)} │`);
  });
  console.log('└─────┴──────────────────────┴────────────────────────────┘');
  
  // Check existing
  const existing: string[] = [];
  TRILOGIES.forEach(t => {
    const finalPath = path.join(process.env.HOME || '', 'sora-videos', t.key, `${t.key}-final.mp4`);
    if (fs.existsSync(finalPath)) {
      existing.push(`${t.id}. ${t.name}`);
    }
  });
  
  if (existing.length > 0) {
    console.log('\n✅ Already generated:');
    existing.forEach(e => console.log(`   ${e}`));
  }
}

function showStatus(): void {
  const status = loadStatus();
  if (!status) {
    console.log('\n📊 No batch status found. Run a batch first.');
    return;
  }

  console.log('\n📊 BATCH STATUS\n');
  console.log(`Started: ${status.startedAt}`);
  console.log(`Progress: ${status.completedVideos}/${status.totalVideos} videos`);
  console.log(`Credits used: ${status.creditsUsed}\n`);

  status.trilogies.forEach(t => {
    const icon = t.status === 'complete' ? '✅' : t.status === 'running' ? '🔄' : t.status === 'failed' ? '❌' : '⏳';
    console.log(`${icon} ${t.name}: ${t.status}${t.duration ? ` (${t.duration})` : ''}`);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--list') || args.includes('-l')) {
    listTrilogies();
    return;
  }

  if (args.includes('--status') || args.includes('-s')) {
    showStatus();
    return;
  }

  if (args.includes('--all') || args.includes('-a')) {
    await runBatch(TRILOGIES.map(t => t.id));
    return;
  }

  if (args.includes('--run') || args.includes('-r')) {
    const idx = args.findIndex(a => a === '--run' || a === '-r');
    const ids = args.slice(idx + 1).filter(a => !a.startsWith('-')).map(Number).filter(n => !isNaN(n));
    if (ids.length > 0) {
      await runBatch(ids);
      return;
    }
  }

  if (args.includes('--skip')) {
    const idx = args.findIndex(a => a === '--skip');
    const skipIds = args.slice(idx + 1).filter(a => !a.startsWith('-')).map(Number).filter(n => !isNaN(n));
    const ids = TRILOGIES.map(t => t.id).filter(id => !skipIds.includes(id));
    await runBatch(ids);
    return;
  }

  if (args.includes('--from')) {
    const idx = args.findIndex(a => a === '--from');
    const fromId = parseInt(args[idx + 1] || '1');
    const ids = TRILOGIES.filter(t => t.id >= fromId).map(t => t.id);
    await runBatch(ids);
    return;
  }

  // Default: show help
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  SORA BATCH TRILOGY RUNNER                                           ║
║  Run multiple trilogies sequentially (safest, one after another)     ║
╚══════════════════════════════════════════════════════════════════════╝

Usage:
  npx tsx scripts/sora-batch-trilogies.ts --list              List all trilogies
  npx tsx scripts/sora-batch-trilogies.ts --status            Check batch status
  npx tsx scripts/sora-batch-trilogies.ts --all               Run all 9 trilogies (27 videos)
  npx tsx scripts/sora-batch-trilogies.ts --run 3 4 5         Run specific trilogies
  npx tsx scripts/sora-batch-trilogies.ts --skip 1 2          Skip trilogies 1 and 2
  npx tsx scripts/sora-batch-trilogies.ts --from 3            Start from trilogy 3

Trilogies:
  1. Volcanic Fury      5. Titan Protocol
  2. Abyssal Descent    6. Temporal Shift
  3. Neon Shadows       7. Midnight Run
  4. Frozen Edge        8. Way of the Dragon
                        9. First Contact

Credits: Each trilogy uses 3 credits (3 videos). All 9 = 27 credits.
Time: ~17-20 minutes per trilogy.
  `);
}

main().catch(console.error);
