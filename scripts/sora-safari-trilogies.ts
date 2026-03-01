#!/usr/bin/env npx tsx
/**
 * Sora Safari Trilogies — Pure Safari Automation
 * No MediaPoster dependency. Trends pre-cached + OpenAI direct + Safari Sora.
 * 
 * Usage:
 *   npx tsx scripts/sora-safari-trilogies.ts              # run all
 *   npx tsx scripts/sora-safari-trilogies.ts --dry-run     # preview only
 *   npx tsx scripts/sora-safari-trilogies.ts --from 4      # resume from trilogy 4
 *   npx tsx scripts/sora-safari-trilogies.ts --from 3 --from-part 1  # resume specific
 */
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(process.env.HOME || '', 'sora-videos', 'trending-trilogies-' + new Date().toISOString().slice(0, 10));

// ─── Types ───────────────────────────────────────────────
interface Video { part: number; title: string; stage: string; prompt: string; }
interface Trilogy { id: number; title: string; trend: string; source: string; videos: Video[]; }

// ─── CLI Args ────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FROM_IDX = args.includes('--from') ? parseInt(args[args.indexOf('--from') + 1]) : 1;
const FROM_PART = args.includes('--from-part') ? parseInt(args[args.indexOf('--from-part') + 1]) : 1;

// ─── Pre-cached curated trilogies from MediaPoster trends ─
const CURATED_TRILOGIES: Trilogy[] = [
  {
    id: 1, title: 'Reality TV Edit', trend: 'Reality TV Edit', source: 'TikTok Feb 2026 Week 2',
    videos: [
      { part: 1, title: 'Reality TV Creator — The Setup', stage: 'Setup/Hook',
        prompt: '@isaiahdupree sitting in a modern home office with multiple monitors, dramatic shadows, cinematic camera slowly pushing in on his face as he stares at code on screen. Expression shifts from focused to shocked. Moody lighting, over-the-top dramatic atmosphere like a reality TV confessional. Portrait 9:16, cinematic 4K.' },
      { part: 2, title: 'Reality TV Creator — The Cliffhanger', stage: 'Build/Development',
        prompt: '@isaiahdupree standing in a sleek kitchen, mid-conversation, suddenly freezes mid-sentence. Camera zooms in dramatically on his face. Freeze frame. Warm tones, reality TV aesthetic, text overlay space at bottom. Cinematic 4K, portrait 9:16.' },
      { part: 3, title: 'Reality TV Creator — The Confessional', stage: 'Payoff/Reveal',
        prompt: '@isaiahdupree sitting in a chair against a plain background, speaking directly to camera with exaggerated serious energy. Dramatic pause, then breaks into a knowing smile. Reality TV confessional lighting with soft key light. Portrait 9:16, cinematic 4K.' },
    ]
  },
  {
    id: 2, title: 'Serialized AI Content', trend: 'Serialized AI Content', source: 'Sprout Social 2026 Trends',
    videos: [
      { part: 1, title: 'Automation Flex — The Discovery', stage: 'Setup/Hook',
        prompt: '@isaiahdupree walking through a futuristic corridor filled with floating holographic screens and data visualizations, wearing a casual hoodie and gold chain. He stops, notices something on one of the screens, and his eyes widen with realization. Cool blue and purple lighting, sci-fi atmosphere. Portrait 9:16, cinematic 4K.' },
      { part: 2, title: 'Automation Flex — The Build', stage: 'Build/Development',
        prompt: '@isaiahdupree sitting at a sleek glass desk, holographic interfaces floating around him, hands moving through the air manipulating code blocks and data flows. Intense focus on his face, code reflecting in his eyes. Neon accents, futuristic workspace. Portrait 9:16, cinematic 4K.' },
      { part: 3, title: 'Automation Flex — The Payoff', stage: 'Payoff/Reveal',
        prompt: '@isaiahdupree leaning back in his chair with a satisfied smile as all the holographic screens around him turn green with success indicators. Camera pulls back to reveal the full scope of his creation. Triumphant lighting, warm golden tones. Portrait 9:16, cinematic 4K.' },
    ]
  },
  {
    id: 3, title: "Builder's Legacy (BHM)", trend: 'Black History Month — Authentic Storytelling', source: 'Cultural moment + Sprout 2026',
    videos: [
      { part: 1, title: "Builder's Legacy — The Foundation", stage: 'Setup/Hook',
        prompt: '@isaiahdupree standing in front of a wall of vintage photographs and newspaper clippings about Black innovators and inventors. Warm amber lighting, documentary style. He reaches out to touch one of the photos, expression reverent and inspired. Rich textures, sepia undertones. Portrait 9:16, cinematic 4K.' },
      { part: 2, title: "Builder's Legacy — The Parallel", stage: 'Build/Development',
        prompt: '@isaiahdupree sitting at a workstation building something, intercut with split-screen showing historical Black inventors in similar poses of creation. Modern meets historical, warm lighting on both sides. Focused expression, hands working with purpose. Portrait 9:16, cinematic 4K.' },
      { part: 3, title: "Builder's Legacy — The Future", stage: 'Payoff/Reveal',
        prompt: '@isaiahdupree looking directly at camera, a confident knowing smile. Behind him, a timeline of innovation stretches into the future with glowing nodes. He nods once, acknowledging the legacy and the future. Warm golden light, inspiring atmosphere. Portrait 9:16, cinematic 4K.' },
    ]
  },
];

// ─── Trending themes for AI-generated trilogies ──────────
const TRENDING_THEMES = [
  { title: 'Universe Sign — Build the App', theme: 'Asking the Universe for a Sign trend — developer asks the universe for guidance on what to build, gets a cosmic sign pointing to code. Spiritual meets tech, dramatic reveal.' },
  { title: 'Euphoria Glam — Late Night Glow Up', theme: 'Euphoria Glam Transition trend — dramatic before/after glow-up transformation. Dark room to neon-lit glamour, confidence reveal moment.' },
  { title: 'Group Consensus — Learn to Code?', theme: 'Group Consensus trend — asking a group of people "should you learn to code?" with dramatic slow-mo reactions, split opinions, ultimate verdict.' },
  { title: 'Key & Peele — IDE Edition', theme: 'Key & Peele Audio Trend — programmer version. Dramatic eye rolls at code, dismissive hand waves at bugs, exaggerated reactions to IDE notifications.' },
  { title: 'Birth Year Dinosaur Edit', theme: 'What Year Were You Born trend — prehistoric caveman version. Waking up confused in a jungle, encountering dinosaurs, dramatic survival energy.' },
];

// ─── Generate AI trilogies via OpenAI ────────────────────
async function generateAITrilogies(startId: number): Promise<Trilogy[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Set OPENAI_API_KEY in .env');

  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });
  const trilogies: Trilogy[] = [];

  for (let i = 0; i < TRENDING_THEMES.length; i++) {
    const t = TRENDING_THEMES[i];
    console.log(`  🎬 [${i + 1}/${TRENDING_THEMES.length}] AI trilogy: "${t.title}"...`);
    try {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You write cinematic Sora AI video prompts. Create a 3-part trilogy for @isaiahdupree — a charismatic Black man in his late 20s, warm smile, casual hoodie and gold chain, expressive and confident.

Each prompt: 2-4 sentences, vivid visual details, camera angles, lighting, atmosphere.
Style: Cinematic 4K, portrait 9:16, dramatic lighting, TikTok/Reels energy.

Return JSON: {"videos": [{"part": 1, "title": "...", "stage": "Setup", "prompt": "..."}, {"part": 2, "title": "...", "stage": "Escalation", "prompt": "..."}, {"part": 3, "title": "...", "stage": "Climax", "prompt": "..."}]}`
          },
          {
            role: 'user',
            content: `Trending theme: "${t.theme}"\n\nReturn exactly 3 cinematic video prompts.`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.8,
      }, { timeout: 30000 });

      const content = resp.choices[0]?.message?.content;
      if (!content) throw new Error('Empty OpenAI response');

      const parsed = JSON.parse(content);
      const vids: any[] = parsed.videos || parsed.prompts || parsed.parts || [];

      if (!Array.isArray(vids) || vids.length < 3) {
        throw new Error(`Expected 3 videos, got ${Array.isArray(vids) ? vids.length : typeof vids}`);
      }

      trilogies.push({
        id: startId + i,
        title: t.title,
        trend: t.title,
        source: 'AI from MediaPoster trends',
        videos: vids.slice(0, 3).map((v: any, idx: number) => ({
          part: v.part || idx + 1,
          title: v.title || `Part ${idx + 1}`,
          stage: v.stage || ['Setup', 'Escalation', 'Climax'][idx],
          prompt: v.prompt,
        })),
      });
      console.log(`     ✅ 3 parts ready`);
    } catch (e: any) {
      console.log(`     ❌ ${e.message}`);
    }
  }
  return trilogies;
}

// ─── Run Sora generation via Safari ──────────────────────
async function runSoraGeneration(trilogies: Trilogy[]): Promise<void> {
  const total = trilogies.reduce((s, t) => s + t.videos.length, 0);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🚀 SORA SAFARI GENERATION — ${trilogies.length} trilogies, ${total} videos`);
  console.log(`${'═'.repeat(60)}`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  let ok = 0, fail = 0;
  const results: any[] = [];

  for (const trilogy of trilogies) {
    if (trilogy.id < FROM_IDX) continue;

    const dir = path.join(OUTPUT_DIR, `${trilogy.id}-${trilogy.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`);
    fs.mkdirSync(dir, { recursive: true });

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`🎬 [${trilogy.id}/${trilogies.length}] ${trilogy.title}`);
    console.log(`${'─'.repeat(50)}`);

    for (const vid of trilogy.videos) {
      if (trilogy.id === FROM_IDX && vid.part < FROM_PART) continue;

      console.log(`\n  📽️  Part ${vid.part}/3: ${vid.title}`);
      console.log(`     ${(vid.prompt || '').slice(0, 90)}...`);

      if (!vid.prompt) {
        console.log('     ⚠️  No prompt — skip');
        results.push({ t: trilogy.title, p: vid.part, ok: false, err: 'No prompt' });
        fail++;
        continue;
      }

      if (DRY_RUN) {
        console.log('     🏷️  [DRY RUN]');
        results.push({ t: trilogy.title, p: vid.part, ok: true });
        ok++;
        continue;
      }

      const t0 = Date.now();
      try {
        const sora = new SoraFullAutomation();
        const r = await sora.fullRun(vid.prompt);

        if (r.download?.success && r.download.filePath) {
          const slug = vid.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
          const dest = path.join(dir, `part-${vid.part}-${slug}.mp4`);
          fs.copyFileSync(r.download.filePath, dest);
          const sec = Math.round((Date.now() - t0) / 1000);
          console.log(`     ✅ ${path.basename(dest)} (${sec}s)`);
          results.push({ t: trilogy.title, p: vid.part, ok: true, path: dest, sec });
          ok++;
        } else {
          const err = r.download?.error || r.poll?.error || 'Unknown';
          console.log(`     ❌ ${err}`);
          results.push({ t: trilogy.title, p: vid.part, ok: false, err });
          fail++;
        }
      } catch (e: any) {
        console.log(`     ❌ ${e.message}`);
        results.push({ t: trilogy.title, p: vid.part, ok: false, err: e.message });
        fail++;
      }

      // Brief pauses
      if (vid.part < 3) await new Promise(r => setTimeout(r, 8000));
    }

    // Pause between trilogies
    const nextIdx = trilogies.findIndex(t => t.id > trilogy.id);
    if (nextIdx !== -1) {
      console.log('\n  ⏳ 15s pause...');
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 DONE — ✅ ${ok} success, ❌ ${fail} failed`);
  console.log(`📂 ${OUTPUT_DIR}`);
  console.log(`${'═'.repeat(60)}`);
  for (const r of results) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.t} P${r.p} ${r.path ? path.basename(r.path) : r.err || ''}`);
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'results.json'), JSON.stringify({
    at: new Date().toISOString(), ok, fail, total: results.length, results,
    trilogies: trilogies.map(t => ({ id: t.id, title: t.title, videos: t.videos })),
  }, null, 2));
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  SORA SAFARI TRILOGIES — Pure Safari Automation   ║');
  console.log('║  8 Trilogies × 3 Parts = 24 Videos               ║');
  console.log('║  Starring: @isaiahdupree                         ║');
  console.log('╚════════════════════════════════════════════════════╝');
  if (DRY_RUN) console.log('🏷️  DRY RUN MODE\n');

  // Step 1: Curated trilogies (pre-cached from MediaPoster)
  console.log('📋 3 curated trilogies from MediaPoster trends (cached)');
  for (const t of CURATED_TRILOGIES) console.log(`   ${t.id}. ${t.title} (${t.videos.length} parts)`);

  // Step 2: Generate 5 AI trilogies from trending themes
  console.log('\n🤖 Generating 5 AI trilogies from trending themes...');
  const aiTrilogies = await generateAITrilogies(4);

  const all = [...CURATED_TRILOGIES, ...aiTrilogies];
  const totalVids = all.reduce((s, t) => s + t.videos.length, 0);
  console.log(`\n📋 Final: ${all.length} trilogies, ${totalVids} videos`);

  // Step 3: Check Sora credits
  if (!DRY_RUN) {
    console.log('\n📊 Checking Sora credits...');
    try {
      const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
      const u = await new SoraFullAutomation().getUsage();
      if (u.success) console.log(`   🎬 ${u.videoGensLeft} gens left (need ${totalVids})`);
    } catch {}
  }

  // Step 4: Run
  await runSoraGeneration(all);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
