/**
 * Backfill sentiment classification on existing platform_comments
 * Usage: npx tsx packages/cloud-sync/src/backfill-sentiment.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { classifyComment } from './comment-classifier';

async function backfill() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  const client = createClient(url, key);

  const { data: comments, error } = await client
    .from('platform_comments')
    .select('id, comment_text, sentiment_class')
    .order('synced_at', { ascending: false });

  if (error) { console.error('Fetch error:', error.message); return; }
  if (!comments?.length) { console.log('No comments to backfill'); return; }

  console.log(`\n🔄 Backfilling ${comments.length} comments...\n`);
  let updated = 0;

  for (const c of comments) {
    const cls = classifyComment(c.comment_text);
    const { error: updateErr } = await client
      .from('platform_comments')
      .update({
        sentiment_class: cls.sentiment_class,
        sentiment_score: cls.sentiment_score,
        is_question: cls.is_question,
        is_testimonial: cls.is_testimonial,
      })
      .eq('id', c.id);

    if (updateErr) {
      console.error(`  ❌ ${c.id}: ${updateErr.message}`);
    } else {
      const text = c.comment_text.substring(0, 50);
      console.log(`  ✅ ${cls.sentiment_class.padEnd(10)} | q=${cls.is_question ? 'Y' : 'N'} t=${cls.is_testimonial ? 'Y' : 'N'} | score=${cls.sentiment_score.toString().padEnd(5)} | "${text}"`);
      updated++;
    }
  }

  console.log(`\n✅ Backfilled ${updated}/${comments.length} comments\n`);
}

backfill().catch(e => { console.error('FATAL:', e); process.exit(1); });
