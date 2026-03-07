import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);
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

async function main() {
  const env = loadEnv('/Users/isaiahdupree/Documents/Software/actp-worker/.env');
  const KEY = env['SUPABASE_SERVICE_ROLE_KEY'];
  const client = createClient(SUPABASE_URL, KEY);

  // Check if table exists
  const { error: checkErr } = await client.from('sora_creator_prompts').select('id').limit(1);

  if (checkErr?.code === 'PGRST205') {
    console.log('Table missing — applying migration via management API...');
    const migrationSQL = fs.readFileSync(
      '/Users/isaiahdupree/Documents/Software/autonomous-coding-dashboard/harness/migrations/20260306_sora_creator_prompts.sql',
      'utf-8'
    );
    const body = JSON.stringify({ query: migrationSQL });
    const { stdout } = await execAsync(
      `curl -s -X POST "https://api.supabase.com/v1/projects/ivhfuhxorppptyuofbgq/database/query" \
        -H "Authorization: Bearer ${KEY}" \
        -H "Content-Type: application/json" \
        -d '${body.replace(/'/g, "'\\''")}'`,
      { timeout: 30000 }
    );
    console.log('DDL result:', stdout.slice(0, 300));
    return;
  }

  if (!checkErr) {
    console.log('Table exists. Testing insert...');
    const { error: insertErr } = await client.from('sora_creator_prompts').upsert({
      id: 'test-migration-check', username: 'test', prompt: 'test', post_href: '/p/s_test',
      views: null, likes: null, comments: null, video_url: null,
    });
    if (insertErr) { console.log('Insert failed:', insertErr.message); return; }
    await client.from('sora_creator_prompts').delete().eq('id', 'test-migration-check');
    console.log('Table ready — insert + delete test passed.');
    return;
  }

  console.log('Unexpected error:', checkErr.message);
}

main().catch(e => { console.error(e.message); process.exit(1); });
