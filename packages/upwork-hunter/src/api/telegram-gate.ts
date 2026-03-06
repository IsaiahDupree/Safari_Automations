import * as https from 'https';
import * as http from 'http';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase.js';
import type { UpworkProposal } from '../types/index.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const UPWORK_AUTOMATION_URL = process.env.UPWORK_AUTOMATION_URL || 'http://localhost:3104';

// Example work snippets shown in approval message — update as wins accumulate
const EXAMPLE_WORK = [
  '✅ Built N8n → Supabase CRM sync for SaaS founder (saved 4hr/wk)',
  '✅ Claude API + Safari automation → auto-DM pipeline (300 prospects/day)',
  '✅ Zapier → custom webhook bridge for $3.2M ARR B2B SaaS',
];

export function isTelegramConfigured(): boolean {
  return !!(BOT_TOKEN && CHAT_ID);
}

function telegramPost(method: string, body: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── upwork-automation bridge ─────────────────────────────────────────────────

function httpGet(url: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function httpPost(url: string, body: unknown, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const protocol = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: timeoutMs,
    };
    const req = protocol.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve(raw));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

async function getConnectsBalance(): Promise<{ available: number; cost: number } | null> {
  try {
    const raw = await httpGet(`${UPWORK_AUTOMATION_URL}/api/upwork/connects`, 5000);
    const data = JSON.parse(raw) as { available?: number; balance?: number };
    const available = data.available ?? data.balance ?? 0;
    return { available, cost: 6 }; // standard proposal = 6 connects
  } catch {
    return null;
  }
}

async function isUpworkAutomationRunning(): Promise<boolean> {
  try {
    const raw = await httpGet(`${UPWORK_AUTOMATION_URL}/health`, 3000);
    return raw.includes('running') || raw.includes('ok');
  } catch {
    return false;
  }
}

// ─── Proposal submission ──────────────────────────────────────────────────────

async function submitApprovedProposal(jobId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = getSupabaseClient();

  const { data: proposal } = await supabase
    .from('upwork_proposals')
    .select('*')
    .eq('job_id', jobId)
    .single();

  if (!proposal) {
    await telegramPost('sendMessage', { chat_id: CHAT_ID, text: `❌ Could not find proposal job_id=${jobId}` });
    return;
  }

  // Check connects balance
  const connects = await getConnectsBalance();
  const connectsLine = connects
    ? `💳 Connects: ${connects.available} available — this job costs ~${connects.cost}`
    : '💳 Connects: upwork-automation offline (will attempt anyway)';

  // Check if upwork-automation is running
  const automationRunning = await isUpworkAutomationRunning();
  if (!automationRunning) {
    await supabase
      .from('upwork_proposals')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('job_id', jobId);

    await telegramPost('sendMessage', {
      chat_id: CHAT_ID,
      text: `✅ Proposal approved — job_id: ${jobId}\n\n${connectsLine}\n\n⚠️ upwork-automation (:3104) is offline — start it to auto-submit.\nManual link: ${proposal.job_url}`,
    });
    return;
  }

  // Check if connects are sufficient
  if (connects && connects.available < connects.cost) {
    await supabase
      .from('upwork_proposals')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('job_id', jobId);
    await telegramPost('sendMessage', {
      chat_id: CHAT_ID,
      text: `⚠️ Approved but NOT submitted — only ${connects.available} connects (need ${connects.cost}).\nBuy more at: https://www.upwork.com/nx/find-work/my-connects`,
    });
    return;
  }

  // Submit proposal via upwork-automation
  await telegramPost('sendMessage', { chat_id: CHAT_ID, text: `🚀 Submitting proposal for "${proposal.job_title}"...` });

  try {
    const raw = await httpPost(`${UPWORK_AUTOMATION_URL}/api/upwork/proposals/submit`, {
      jobUrl: proposal.job_url,
      coverLetter: proposal.proposal_text,
      dryRun: false,
    }, 60000);

    const result = JSON.parse(raw) as { success?: boolean; error?: string; connectsUsed?: number; applicationUrl?: string };

    if (result.success) {
      await supabase
        .from('upwork_proposals')
        .update({ status: 'submitted', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('job_id', jobId);

      await telegramPost('sendMessage', {
        chat_id: CHAT_ID,
        text:
          `✅ *Proposal submitted!*\n` +
          `Job: "${proposal.job_title}"\n` +
          `${connects ? `Connects used: ~${connects.cost} (${connects.available - connects.cost} remaining)\n` : ''}` +
          `${result.applicationUrl ? `Application: ${result.applicationUrl}` : ''}`,
        parse_mode: 'Markdown',
      });
      console.log(`[telegram-gate] Proposal submitted job_id=${jobId}`);
    } else {
      throw new Error(result.error || 'Unknown submit error');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('upwork_proposals')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('job_id', jobId);
    await telegramPost('sendMessage', {
      chat_id: CHAT_ID,
      text: `❌ Submit failed: ${msg.slice(0, 200)}\n\nManual link: ${proposal.job_url}`,
    });
    console.error(`[telegram-gate] Submit failed job_id=${jobId}:`, msg);
  }
}

// ─── Send proposal to Telegram ────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendProposalToTelegram(proposal: UpworkProposal): Promise<number | null> {
  if (!isTelegramConfigured()) {
    console.log('[telegram-gate] Not configured — skipping Telegram notification');
    return null;
  }

  const connects = await getConnectsBalance();
  const connectsLine = connects
    ? `💳 Connects: ${connects.available} available (this costs ~${connects.cost})`
    : `💳 Connects: upwork-automation offline`;

  const scoreTier =
    (proposal.score ?? 0) >= 80 ? '🔥 HOT' :
    (proposal.score ?? 0) >= 60 ? '✅ GOOD' :
    (proposal.score ?? 0) >= 40 ? '🟡 OK' : '🔵 LOW';

  const proposalPreview = escHtml((proposal.proposal_text || '').slice(0, 600));
  const truncated = (proposal.proposal_text || '').length > 600 ? `\n[/view_${proposal.job_id} for full]` : '';
  const exampleBlock = EXAMPLE_WORK.join('\n');

  const text =
    `🎯 <b>NEW UPWORK JOB</b> — ${scoreTier} (${proposal.score}/100)\n` +
    `📌 ${escHtml(proposal.job_title)}\n` +
    `💰 Budget: ${escHtml(proposal.budget || 'Not specified')}\n` +
    `${connectsLine}\n` +
    `🔗 ${escHtml(proposal.job_url)}\n\n` +
    `<b>PROPOSAL:</b>\n${proposalPreview}${truncated}\n\n` +
    `<b>EXAMPLE WORK:</b>\n${exampleBlock}\n\n` +
    `▶️ /approve_${proposal.job_id}   ❌ /reject_${proposal.job_id}   📄 /view_${proposal.job_id}`;

  try {
    const result = (await telegramPost('sendMessage', {
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })) as { ok: boolean; result?: { message_id: number } };

    if (result.ok && result.result?.message_id) {
      const messageId = result.result.message_id;
      if (isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        await supabase
          .from('upwork_proposals')
          .update({ telegram_message_id: messageId })
          .eq('job_id', proposal.job_id);
      }
      console.log(`[telegram-gate] Sent to Telegram, message_id=${messageId}`);
      return messageId;
    }
    return null;
  } catch (err) {
    console.error('[telegram-gate] Failed to send:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─── Polling + command handling ───────────────────────────────────────────────

let _lastUpdateId = 0;
let _polling = false;

async function processUpdate(update: {
  update_id: number;
  message?: { text?: string };
}): Promise<void> {
  _lastUpdateId = update.update_id;
  const text = update.message?.text || '';

  const approveMatch = /^\/approve_([a-f0-9]+)/i.exec(text);
  const rejectMatch = /^\/reject_([a-f0-9]+)/i.exec(text);
  const viewMatch = /^\/view_([a-f0-9]+)/i.exec(text);
  const statusMatch = /^\/upwork_status/i.exec(text);
  const scanMatch = /^\/upwork_scan/i.exec(text);

  if (!isSupabaseConfigured() && !approveMatch && !statusMatch && !scanMatch) return;

  if (approveMatch) {
    const jobId = approveMatch[1];
    console.log(`[telegram-gate] Approve command for job_id=${jobId}`);
    await submitApprovedProposal(jobId);

  } else if (rejectMatch) {
    const jobId = rejectMatch[1];
    if (isSupabaseConfigured()) {
      const supabase = getSupabaseClient();
      await supabase
        .from('upwork_proposals')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('job_id', jobId);
    }
    await telegramPost('sendMessage', { chat_id: CHAT_ID, text: `❌ Rejected job_id: ${jobId}` });
    console.log(`[telegram-gate] Rejected job_id=${jobId}`);

  } else if (viewMatch) {
    const jobId = viewMatch[1];
    if (isSupabaseConfigured()) {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('upwork_proposals')
        .select('proposal_text, job_title, job_url, score, budget, status')
        .eq('job_id', jobId)
        .single();
      if (data) {
        await telegramPost('sendMessage', {
          chat_id: CHAT_ID,
          text:
            `📄 <b>Full Proposal — "${escHtml(data.job_title)}"</b>\n` +
            `Score: ${data.score} | Budget: ${escHtml(data.budget || '?')} | Status: ${data.status}\n` +
            `Link: ${escHtml(data.job_url)}\n\n` +
            `${escHtml(data.proposal_text || '(no proposal text)')}`,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
      }
    }

  } else if (statusMatch) {
    // Quick status: pending proposals count + connects balance
    const supabase = isSupabaseConfigured() ? getSupabaseClient() : null;
    let pending = 0;
    if (supabase) {
      const { data } = await supabase.from('upwork_proposals').select('status');
      pending = (data || []).filter((r: { status: string }) => r.status === 'pending').length;
    }
    const connects = await getConnectsBalance();
    const automationUp = await isUpworkAutomationRunning();
    await telegramPost('sendMessage', {
      chat_id: CHAT_ID,
      text:
        `📊 *Upwork Status*\n` +
        `Pending proposals: ${pending}\n` +
        `Automation (:3104): ${automationUp ? '✅ Running' : '❌ Offline'}\n` +
        `${connects ? `Connects: ${connects.available} available` : 'Connects: N/A'}`,
      parse_mode: 'Markdown',
    });

  } else if (scanMatch) {
    // Trigger a manual scan via upwork-hunter
    await telegramPost('sendMessage', { chat_id: CHAT_ID, text: '🔍 Triggering job scan...' });
    try {
      const raw = await httpPost('http://localhost:3107/api/scan', {}, 120000);
      const result = JSON.parse(raw) as { jobs_found?: number; above_threshold?: number; proposals_generated?: number };
      await telegramPost('sendMessage', {
        chat_id: CHAT_ID,
        text:
          `🔍 *Scan complete*\n` +
          `Jobs found: ${result.jobs_found ?? 0}\n` +
          `Above threshold: ${result.above_threshold ?? 0}\n` +
          `Proposals generated: ${result.proposals_generated ?? 0}`,
        parse_mode: 'Markdown',
      });
    } catch (err) {
      await telegramPost('sendMessage', { chat_id: CHAT_ID, text: `❌ Scan failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
}

export async function pollTelegramUpdates(): Promise<void> {
  if (!isTelegramConfigured() || _polling) return;
  _polling = true;

  try {
    const result = (await telegramPost('getUpdates', {
      offset: _lastUpdateId + 1,
      timeout: 10,
      allowed_updates: ['message'],
    })) as { ok: boolean; result?: Array<{ update_id: number; message?: { text?: string } }> };

    if (result.ok && result.result) {
      for (const update of result.result) {
        await processUpdate(update);
      }
    }
  } catch (err) {
    console.error('[telegram-gate] Poll error:', err instanceof Error ? err.message : String(err));
  } finally {
    _polling = false;
  }
}

export function startPollingLoop(intervalMs = 5000): NodeJS.Timeout {
  console.log('[telegram-gate] Starting poll loop — commands: /approve_ID /reject_ID /view_ID /upwork_status /upwork_scan');
  return setInterval(pollTelegramUpdates, intervalMs);
}
