import * as https from 'https';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase.js';
import type { UpworkProposal } from '../types/index.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

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
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

export async function sendProposalToTelegram(proposal: UpworkProposal): Promise<number | null> {
  if (!isTelegramConfigured()) {
    console.log('[telegram-gate] Not configured — skipping Telegram notification');
    return null;
  }

  const preview = (proposal.proposal_text || '').slice(0, 200);
  const text =
    `🎯 NEW UPWORK JOB — Score: ${proposal.score}/100\n` +
    `Title: "${proposal.job_title}"\n` +
    `Budget: ${proposal.budget || 'Not specified'}\n` +
    `URL: ${proposal.job_url}\n\n` +
    `PROPOSAL PREVIEW:\n${preview}...\n\n` +
    `Reply: /approve_${proposal.job_id} | /reject_${proposal.job_id} | /view_${proposal.job_id}`;

  try {
    const result = (await telegramPost('sendMessage', {
      chat_id: CHAT_ID,
      text,
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
      console.log(`[telegram-gate] Sent proposal to Telegram, message_id=${messageId}`);
      return messageId;
    }
    return null;
  } catch (err) {
    console.error('[telegram-gate] Failed to send to Telegram:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

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

  if (!isSupabaseConfigured()) return;
  const supabase = getSupabaseClient();

  if (approveMatch) {
    const jobId = approveMatch[1];
    await supabase
      .from('upwork_proposals')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('job_id', jobId);
    console.log(`[telegram-gate] Proposal approved via Telegram: job_id=${jobId}`);
    if (isTelegramConfigured()) {
      await telegramPost('sendMessage', {
        chat_id: CHAT_ID,
        text: `✅ Proposal approved for job_id: ${jobId}`,
      });
    }
  } else if (rejectMatch) {
    const jobId = rejectMatch[1];
    await supabase
      .from('upwork_proposals')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('job_id', jobId);
    console.log(`[telegram-gate] Proposal rejected via Telegram: job_id=${jobId}`);
  } else if (viewMatch) {
    const jobId = viewMatch[1];
    const { data } = await supabase
      .from('upwork_proposals')
      .select('proposal_text, job_title')
      .eq('job_id', jobId)
      .single();
    if (data && isTelegramConfigured()) {
      await telegramPost('sendMessage', {
        chat_id: CHAT_ID,
        text: `📄 Full proposal for "${data.job_title}":\n\n${data.proposal_text}`,
      });
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
  console.log('[telegram-gate] Starting long-poll loop');
  return setInterval(pollTelegramUpdates, intervalMs);
}
