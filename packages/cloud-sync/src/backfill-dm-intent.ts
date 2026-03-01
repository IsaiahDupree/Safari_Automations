/**
 * Backfill DM intent classification on existing platform_dms
 * Usage: npx tsx packages/cloud-sync/src/backfill-dm-intent.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { classifyDM } from './dm-classifier';

async function backfill() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  const client = createClient(url, key);

  const { data: dms, error } = await client
    .from('platform_dms')
    .select('id, message_text, direction, platform, intent')
    .order('synced_at', { ascending: false });

  if (error) { console.error('Fetch error:', error.message); return; }
  if (!dms?.length) { console.log('No DMs to backfill'); return; }

  console.log(`\n🔄 Backfilling ${dms.length} DMs with intent classification...\n`);
  let updated = 0;

  for (const dm of dms) {
    const cls = classifyDM(dm.message_text, dm.direction, dm.platform);
    const { error: updateErr } = await client
      .from('platform_dms')
      .update({
        intent: cls.intent,
        intent_score: cls.intent_score,
        sentiment: cls.sentiment,
        reply_needed: cls.reply_needed,
        suggested_reply: cls.suggested_reply,
        lead_score: cls.lead_score,
      })
      .eq('id', dm.id);

    if (updateErr) {
      console.error(`  ❌ ${dm.id}: ${updateErr.message}`);
    } else {
      const text = (dm.message_text || '').substring(0, 50);
      console.log(`  ✅ ${cls.intent.padEnd(14)} | lead=${String(cls.lead_score).padStart(3)} | reply=${cls.reply_needed ? 'Y' : 'N'} | ${cls.sentiment.padEnd(8)} | "${text}"`);
      updated++;
    }
  }

  console.log(`\n✅ Backfilled ${updated}/${dms.length} DMs\n`);
}

backfill().catch(e => { console.error('FATAL:', e); process.exit(1); });
