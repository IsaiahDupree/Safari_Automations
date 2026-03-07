/**
 * LinkedIn Action Logger — Supabase + Telegram notifications
 * Fire-and-forget: never blocks the calling code.
 */

const SUPA_URL = process.env.SUPABASE_URL || 'https://ivhfuhxorppptyuofbgq.supabase.co';
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID   || '';

export type LinkedInActionType =
  | 'message_sent'
  | 'connection_sent'
  | 'profile_viewed'
  | 'post_liked'
  | 'post_commented'
  | 'pipeline_run';

export interface LinkedInActionEntry {
  action_type: LinkedInActionType;
  profile_url?: string;
  profile_name?: string;
  message_text?: string;
  note?: string;
  search_query?: string;
  results_count?: number;
  success: boolean;
  error?: string;
}

/** Write one action row to linkedin_actions. */
async function logToSupabase(entry: LinkedInActionEntry): Promise<void> {
  if (!SUPA_KEY) return;
  try {
    await fetch(`${SUPA_URL}/rest/v1/linkedin_actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        action_type:    entry.action_type,
        profile_url:    entry.profile_url    ?? null,
        profile_name:   entry.profile_name   ?? null,
        message_text:   entry.message_text   ? entry.message_text.substring(0, 2000) : null,
        note:           entry.note           ? entry.note.substring(0, 500) : null,
        search_query:   entry.search_query   ?? null,
        results_count:  entry.results_count  ?? null,
        success:        entry.success,
        error:          entry.error          ?? null,
        created_at:     new Date().toISOString(),
      }),
    });
  } catch { /* non-fatal */ }
}

/** Send a Telegram message for high-value LinkedIn events. */
async function notifyTelegram(text: string): Promise<void> {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: Number(TG_CHAT) || TG_CHAT, text, parse_mode: 'HTML' }),
    });
  } catch { /* non-fatal */ }
}

/** Log a LinkedIn action and (for writes) notify Telegram. */
export function logLinkedInAction(entry: LinkedInActionEntry): void {
  // Supabase — always
  logToSupabase(entry).catch(() => {});

  // Telegram — only for outbound write actions
  const writeActions: LinkedInActionType[] = ['message_sent', 'connection_sent', 'post_commented', 'post_liked'];
  if (!writeActions.includes(entry.action_type)) return;

  const icon = entry.action_type === 'message_sent'     ? '💬'
             : entry.action_type === 'connection_sent'   ? '🤝'
             : entry.action_type === 'post_commented'    ? '📝'
             : '👍';
  const nameStr = entry.profile_name ? ` <b>${entry.profile_name}</b>` : '';
  const urlStr  = entry.profile_url  ? `\n<a href="${entry.profile_url}">Profile</a>` : '';
  const msgStr  = entry.message_text ? `\n<i>"${entry.message_text.substring(0, 120)}${entry.message_text.length > 120 ? '…' : ''}"</i>` : '';
  const status  = entry.success ? '' : ' ❌ FAILED';

  const text = `${icon} LinkedIn ${entry.action_type.replace('_', ' ')}${status}${nameStr}${urlStr}${msgStr}`;
  notifyTelegram(text).catch(() => {});
}
