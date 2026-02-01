#!/usr/bin/env npx tsx
/**
 * Sora 27 Video Story Generator
 * 9 Trilogies x 3 Videos Each = 27 Badass Videos featuring @isaiahdupree
 * 
 * Usage:
 *   npx tsx scripts/sora-27-stories.ts --list           # List all stories
 *   npx tsx scripts/sora-27-stories.ts --trilogy 1      # Generate trilogy 1
 *   npx tsx scripts/sora-27-stories.ts --all            # Generate all 27
 *   npx tsx scripts/sora-27-stories.ts --export         # Export prompts to JSON
 */

export {};

// ============================================================================
// 9 TRILOGIES - 27 VIDEOS TOTAL
// Each trilogy tells a 3-part story featuring @isaiahdupree
// ============================================================================

interface VideoPrompt {
  part: 1 | 2 | 3;
  title: string;
  prompt: string;
}

interface Trilogy {
  id: number;
  name: string;
  theme: string;
  videos: VideoPrompt[];
}

const TRILOGIES: Trilogy[] = [
  // =========== TRILOGY 1: VOLCANIC FURY ===========
  {
    id: 1,
    name: 'Volcanic Fury',
    theme: 'Conquering an active volcano',
    videos: [
      {
        part: 1,
        title: 'The Awakening',
        prompt: '@isaiahdupree stands at the base of an erupting volcano at night, molten lava rivers flowing around them. They wear a heat-resistant tactical suit with glowing orange accents. The ground trembles as they look up at the fiery peak, determination in their eyes. Ash falls like snow around them as they begin their ascent.',
      },
      {
        part: 2,
        title: 'The Climb',
        prompt: '@isaiahdupree scales the volcanic cliff face as explosions of lava erupt nearby. They leap across a chasm of bubbling magma, grabbing a rock ledge mid-air. Sparks and embers swirl around them in slow motion. Their suit glows from the intense heat as they pull themselves up, never stopping.',
      },
      {
        part: 3,
        title: 'The Summit',
        prompt: '@isaiahdupree stands victorious at the volcano crater edge, arms raised as a massive eruption explodes behind them. Lava fountains spray hundreds of feet into the air. They turn and run, then dive off the cliff edge, deploying a wingsuit as the volcano erupts fully behind them, silhouetted against the orange sky.',
      },
    ],
  },

  // =========== TRILOGY 2: DEEP SEA MISSION ===========
  {
    id: 2,
    name: 'Abyssal Descent',
    theme: 'Exploring the deepest ocean',
    videos: [
      {
        part: 1,
        title: 'The Dive',
        prompt: '@isaiahdupree descends in a sleek one-person submarine into the deep ocean. Sunlight fades as they pass schools of fish. Bioluminescent creatures begin appearing in the darkness. They activate the sub floodlights, revealing the alien landscape of the deep. Pressure gauge climbs as they go deeper.',
      },
      {
        part: 2,
        title: 'The Discovery',
        prompt: '@isaiahdupree navigates through an underwater cave system, discovering an ancient sunken city with impossible architecture. Giant squid tentacles snake past the viewport. They spot a glowing artifact on a pedestal in the ruins. Bubbles stream past as they maneuver closer, the sub lights illuminating hieroglyphics.',
      },
      {
        part: 3,
        title: 'The Escape',
        prompt: '@isaiahdupree grabs the glowing artifact as the ancient structure begins collapsing. A massive deep-sea creature awakens and gives chase. They pilot the sub through narrow passages at full speed, debris falling around them. Breaking through to open water, they rocket toward the surface as sunlight appears above, the creature retreating into the darkness below.',
      },
    ],
  },

  // =========== TRILOGY 3: CYBERPUNK HEIST ===========
  {
    id: 3,
    name: 'Neon Shadows',
    theme: 'High-tech heist in a cyberpunk city',
    videos: [
      {
        part: 1,
        title: 'The Setup',
        prompt: '@isaiahdupree walks through a rain-soaked cyberpunk city street, neon signs reflecting in puddles. Holograms advertise in Japanese and English. They wear a sleek black jacket with LED trim, scanning the massive corporate tower ahead. Drones fly overhead. They check a holographic display on their wrist showing building schematics.',
      },
      {
        part: 2,
        title: 'The Infiltration',
        prompt: '@isaiahdupree hacks through a laser grid in a high-tech corridor, fingers dancing over a holographic keyboard. Security drones patrol above. They slide under closing blast doors, roll to their feet, and run through a server room with walls of blinking lights. Alarms begin blaring red as they reach the vault.',
      },
      {
        part: 3,
        title: 'The Getaway',
        prompt: '@isaiahdupree crashes through a window on the 100th floor holding a glowing data cube, glass shattering in slow motion around them. They spread their arms, deploying a nanomesh wingsuit that glows with circuitry patterns. Flying between skyscrapers as police drones give chase, they weave through holographic billboards and disappear into the neon-lit night.',
      },
    ],
  },

  // =========== TRILOGY 4: ARCTIC SURVIVAL ===========
  {
    id: 4,
    name: 'Frozen Edge',
    theme: 'Surviving the extreme Arctic',
    videos: [
      {
        part: 1,
        title: 'The Storm',
        prompt: '@isaiahdupree trudges through a violent Arctic blizzard, visibility near zero. Ice crystals coat their face mask and thermal suit. Lightning cracks across the frozen sky. They push forward against impossible winds, a massive glacier visible momentarily through breaks in the storm. Their breath freezes instantly in the air.',
      },
      {
        part: 2,
        title: 'The Cave',
        prompt: '@isaiahdupree discovers an ice cave and takes shelter as the blizzard rages outside. Inside, they find ancient frozen creatures preserved in the crystal-clear ice walls. Blue light filters through, creating an ethereal glow. They start a fire with the last of their supplies, shadows dancing on the ice as a polar bear watches from deeper in the cave.',
      },
      {
        part: 3,
        title: 'The Aurora',
        prompt: '@isaiahdupree emerges from the cave as the storm clears, revealing a sky exploding with the Northern Lights. Green, purple, and pink ribbons dance across the heavens. They climb to a frozen peak and stand silhouetted against the aurora, arms outstretched. A rescue helicopter appears on the horizon as the lights reflect off the endless ice below.',
      },
    ],
  },

  // =========== TRILOGY 5: MECH WARRIOR ===========
  {
    id: 5,
    name: 'Titan Protocol',
    theme: 'Piloting a giant mech in battle',
    videos: [
      {
        part: 1,
        title: 'The Activation',
        prompt: '@isaiahdupree climbs into the cockpit of a 50-foot combat mech in an underground hangar. Displays flicker to life around them as they grip the controls. The mech eyes glow blue as it powers on. Steam vents and hydraulics hiss. The hangar doors open revealing a war-torn cityscape. They take the first thundering step forward.',
      },
      {
        part: 2,
        title: 'The Battle',
        prompt: '@isaiahdupree pilots the mech through urban warfare, trading fire with enemy mechs. Buildings crumble from stray shots. They dodge a missile barrage, the mech rolling and firing its plasma cannon. Explosions light up the night as they engage multiple targets, the cockpit shaking from impacts. Sparks fly as they take a hit but keep fighting.',
      },
      {
        part: 3,
        title: 'The Victory',
        prompt: '@isaiahdupree faces the massive enemy boss mech, twice their size. They charge forward, dodging energy beams. At the last second they slide the mech under the enemy, firing all weapons upward. The boss mech explodes spectacularly. @isaiahdupree stands their mech up in the flames, raises its mechanical fist in victory as dawn breaks over the liberated city.',
      },
    ],
  },

  // =========== TRILOGY 6: TIME TRAVELER ===========
  {
    id: 6,
    name: 'Temporal Shift',
    theme: 'Journey through time',
    videos: [
      {
        part: 1,
        title: 'Ancient Egypt',
        prompt: '@isaiahdupree materializes from a time portal in ancient Egypt, the pyramids being constructed in the background. Workers and overseers look in shock. Wearing modern tactical gear that stands out against the ancient setting. The sun blazes overhead as they walk toward the half-built Great Pyramid, sand swirling around the temporal distortion behind them.',
      },
      {
        part: 2,
        title: 'Medieval Battle',
        prompt: '@isaiahdupree appears in the middle of a medieval battlefield, armies clashing with swords and arrows. They dodge a charging knight on horseback, then sprint through the chaos. Castles burn in the distance. They reach a stone monument and activate their time device again, disappearing in a flash of light as soldiers stare in disbelief.',
      },
      {
        part: 3,
        title: 'The Future',
        prompt: '@isaiahdupree arrives in a utopian future city with floating buildings and clean energy towers. Flying vehicles soar overhead. The sky is perfect blue with rings visible like Saturn. They smile, finally home. Citizens in white clothing approach warmly. They look back one last time as the time portal closes, mission complete.',
      },
    ],
  },

  // =========== TRILOGY 7: STREET RACING ===========
  {
    id: 7,
    name: 'Midnight Run',
    theme: 'Illegal street racing',
    videos: [
      {
        part: 1,
        title: 'The Challenge',
        prompt: '@isaiahdupree pulls up to a midnight street race in a matte black modified sports car, neon underglow reflecting on wet asphalt. Crowds line the empty highway. They step out, leather jacket gleaming, and accept the challenge from a rival crew. Engines rev aggressively. They slide back into the drivers seat, hands gripping the wheel.',
      },
      {
        part: 2,
        title: 'The Race',
        prompt: '@isaiahdupree races through city streets at 200mph, drifting around corners with sparks flying. They weave through traffic, barely missing a bus. NOS activates with blue flames from the exhaust. Neck and neck with the rival, they shift gears and the speedometer climbs impossibly high. The city becomes a blur of lights.',
      },
      {
        part: 3,
        title: 'The Finish',
        prompt: '@isaiahdupree crosses the finish line first by inches, the car smoking and steaming. They drift to a perfect stop as the crowd erupts. Stepping out victorious, they toss the keys to a friend. Police sirens approach in the distance. Everyone scatters. @isaiahdupree walks away calmly into an alley as their legend grows.',
      },
    ],
  },

  // =========== TRILOGY 8: MARTIAL ARTS MASTER ===========
  {
    id: 8,
    name: 'Way of the Dragon',
    theme: 'Martial arts journey',
    videos: [
      {
        part: 1,
        title: 'The Training',
        prompt: '@isaiahdupree trains in a misty mountain temple at sunrise, executing perfect martial arts forms. Ancient masters watch from the shadows. Sweat drips as they punch through wooden boards, kick through ceramic, and meditate under a waterfall. Cherry blossoms fall around them as they master an ancient technique, hands glowing with chi energy.',
      },
      {
        part: 2,
        title: 'The Tournament',
        prompt: '@isaiahdupree fights through a martial arts tournament in a grand arena. They defeat opponent after opponent with fluid precision. Flying kicks, rapid punches, acrobatic dodges. The crowd chants their name. In the semifinals, they face a massive fighter twice their size and take them down with a single pressure point strike.',
      },
      {
        part: 3,
        title: 'The Champion',
        prompt: '@isaiahdupree faces the undefeated champion in the final match, an entire stadium watching. They exchange incredible blows, moving almost too fast to see. @isaiahdupree takes a hit but rises again. In slow motion, they leap and deliver the final spinning kick, landing perfectly as the champion falls. They bow respectfully, then raise the trophy.',
      },
    ],
  },

  // =========== TRILOGY 9: SPACE PIONEER ===========
  {
    id: 9,
    name: 'First Contact',
    theme: 'Meeting alien life',
    videos: [
      {
        part: 1,
        title: 'The Signal',
        prompt: '@isaiahdupree sits in a space station control room when alarms suddenly blare. A massive alien ship decloaks outside the window, larger than any human vessel. Strange symbols pulse on its hull. They rush to the airlock, suiting up as humanity receives its first confirmed extraterrestrial contact. Earth glows blue below, unaware.',
      },
      {
        part: 2,
        title: 'The Meeting',
        prompt: '@isaiahdupree floats through a crystalline alien corridor inside the ship, gravity shifting in impossible ways. Bioluminescent patterns guide them forward. They enter a vast chamber where beings of pure light take humanoid form. No words are spoken but understanding passes between them. @isaiahdupree reaches out a hand.',
      },
      {
        part: 3,
        title: 'The Gift',
        prompt: '@isaiahdupree returns to the space station carrying a glowing orb of alien technology. They present it to the assembled world leaders via hologram. The orb activates, projecting star maps showing the path to a thousand inhabited worlds. @isaiahdupree smiles as humanity realizes they are no longer alone. The alien ship departs, leaving a beacon.',
      },
    ],
  },
];

// ============================================================================
// CLI FUNCTIONS
// ============================================================================

function listAllStories(): void {
  console.log('\n' + '═'.repeat(60));
  console.log('  27 SORA VIDEO IDEAS - 9 TRILOGIES');
  console.log('═'.repeat(60) + '\n');

  for (const trilogy of TRILOGIES) {
    console.log(`📽️ TRILOGY ${trilogy.id}: ${trilogy.name.toUpperCase()}`);
    console.log(`   Theme: ${trilogy.theme}\n`);
    
    for (const video of trilogy.videos) {
      console.log(`   Part ${video.part}: ${video.title}`);
      console.log(`   ${video.prompt.substring(0, 80)}...\n`);
    }
    console.log('');
  }

  console.log('═'.repeat(60));
  console.log(`  Total: ${TRILOGIES.length} trilogies, ${TRILOGIES.length * 3} videos`);
  console.log('═'.repeat(60) + '\n');
}

async function exportPrompts(): Promise<void> {
  const exportData = {
    generatedAt: new Date().toISOString(),
    character: '@isaiahdupree',
    totalVideos: TRILOGIES.length * 3,
    trilogies: TRILOGIES,
    flatPrompts: TRILOGIES.flatMap(t => 
      t.videos.map(v => ({
        trilogyId: t.id,
        trilogyName: t.name,
        part: v.part,
        title: v.title,
        prompt: v.prompt,
      }))
    ),
  };

  const fs = await import('fs');
  const outputPath = 'sora-27-prompts.json';
  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  console.log(`\n✅ Exported to ${outputPath}\n`);
  console.log(`   ${exportData.totalVideos} prompts ready for Sora generation\n`);
}

async function generateTrilogy(trilogyId: number): Promise<void> {
  const trilogy = TRILOGIES.find(t => t.id === trilogyId);
  if (!trilogy) {
    console.error(`❌ Trilogy ${trilogyId} not found`);
    return;
  }

  console.log(`\n🎬 Generating Trilogy ${trilogyId}: ${trilogy.name}\n`);
  
  for (const video of trilogy.videos) {
    console.log(`   Part ${video.part}: ${video.title}`);
    console.log(`   Prompt: ${video.prompt.substring(0, 60)}...`);
    console.log(`   [Would queue for Sora generation]\n`);
  }

  console.log(`\n✅ Trilogy ${trilogyId} queued for generation\n`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.includes('--list') || args.includes('-l')) {
    listAllStories();
  } else if (args.includes('--export') || args.includes('-e')) {
    exportPrompts();
  } else if (args.includes('--trilogy') || args.includes('-t')) {
    const idx = args.findIndex(a => a === '--trilogy' || a === '-t');
    const trilogyId = parseInt(args[idx + 1] || '1');
    await generateTrilogy(trilogyId);
  } else if (args.includes('--all') || args.includes('-a')) {
    console.log('\n🚀 Generating all 27 videos...\n');
    for (const trilogy of TRILOGIES) {
      await generateTrilogy(trilogy.id);
    }
  } else {
    console.log(`
Sora 27 Video Story Generator
=============================

Usage:
  npx tsx scripts/sora-27-stories.ts --list          # List all 27 video ideas
  npx tsx scripts/sora-27-stories.ts --trilogy 1     # Generate trilogy 1
  npx tsx scripts/sora-27-stories.ts --all           # Generate all 27 videos
  npx tsx scripts/sora-27-stories.ts --export        # Export prompts to JSON

Trilogies:
  1. Volcanic Fury      - Conquering an active volcano
  2. Abyssal Descent    - Exploring the deepest ocean
  3. Neon Shadows       - Cyberpunk heist
  4. Frozen Edge        - Arctic survival
  5. Titan Protocol     - Mech warrior battle
  6. Temporal Shift     - Time travel journey
  7. Midnight Run       - Street racing
  8. Way of the Dragon  - Martial arts master
  9. First Contact      - Meeting alien life
    `);
  }
}

main().catch(console.error);
