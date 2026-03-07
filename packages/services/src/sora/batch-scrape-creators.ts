import { SoraFullAutomation } from './sora-full-automation.js';
import * as fs from 'fs';

const SUPABASE_URL = 'https://ivhfuhxorppptyuofbgq.supabase.co';

function loadEnv(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {}
  return env;
}

async function upsertRows(rows: object[], key: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sora_creator_prompts`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upsert failed ${res.status}: ${err}`);
  }
}

async function main() {
  const creators = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ['memexpert', 'dheera', 'artexmg', 'highkey', 'metin'];
  const postsPerCreator = 10;

  const env = loadEnv('/Users/isaiahdupree/Documents/Software/actp-worker/.env');
  const key = env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not found');

  const sora = new SoraFullAutomation();
  let totalSaved = 0;

  for (const username of creators) {
    console.log(`\n[BATCH] Scraping ${username}...`);
    try {
      const result = await sora.getCreatorPrompts(username, postsPerCreator);
      if (!result.success || !result.posts.length) {
        console.log(`[BATCH] No posts for ${username}, skipping`);
        continue;
      }

      const rows = result.posts.map((p: any) => ({
        id: p.id,
        username,
        prompt: p.prompt,
        post_href: p.post_href,
        views: p.views ?? null,
        likes: p.likes ?? null,
        comments: p.comments ?? null,
        video_url: p.video_url ?? null,
      }));

      await upsertRows(rows, key);
      totalSaved += rows.length;
      console.log(`[BATCH] Saved ${rows.length} posts for ${username} (top: ${rows[0]?.views ?? '?'} views)`);
    } catch (e: any) {
      console.error(`[BATCH] Error for ${username}:`, e.message);
    }
  }

  console.log(`\n[BATCH] Done — ${totalSaved} rows saved across ${creators.length} creators`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
