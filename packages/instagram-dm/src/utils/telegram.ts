/**
 * Telegram notifier — fire-and-forget, never throws.
 */
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT  = process.env.TELEGRAM_CHAT_ID   || '';

export function notifyTelegram(text: string): void {
  if (!TG_TOKEN || !TG_CHAT) return;
  fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: Number(TG_CHAT) || TG_CHAT, text, parse_mode: 'HTML' }),
  }).catch(() => {});
}
