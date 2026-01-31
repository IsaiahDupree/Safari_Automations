/**
 * Webhook Service
 * Manages webhook registrations and dispatches events to external services.
 */

import crypto from 'crypto';

export type WebhookEvent = 
  | 'contact.created'
  | 'contact.updated'
  | 'contact.score_changed'
  | 'message.sent'
  | 'message.received'
  | 'message.failed'
  | 'sync.completed'
  | 'outreach.queued'
  | 'outreach.sent'
  | 'outreach.failed'
  | 'mediaposter.video_posted'
  | 'mediaposter.schedule_updated';

export interface WebhookRegistration {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret?: string;
  active: boolean;
  createdAt: string;
  lastTriggered?: string;
  failureCount: number;
}

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

// In-memory webhook storage (could be backed by database)
const webhooks: Map<string, WebhookRegistration> = new Map();

// Event log for debugging
const eventLog: { event: WebhookEvent; timestamp: string; webhookId?: string; success?: boolean }[] = [];
const MAX_EVENT_LOG = 100;

/**
 * Register a new webhook.
 */
export function registerWebhook(
  url: string,
  events: WebhookEvent[],
  secret?: string
): WebhookRegistration {
  const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const webhook: WebhookRegistration = {
    id,
    url,
    events,
    secret,
    active: true,
    createdAt: new Date().toISOString(),
    failureCount: 0,
  };
  
  webhooks.set(id, webhook);
  console.log(`[Webhook] Registered: ${id} for events: ${events.join(', ')}`);
  
  return webhook;
}

/**
 * Unregister a webhook.
 */
export function unregisterWebhook(id: string): boolean {
  const deleted = webhooks.delete(id);
  if (deleted) {
    console.log(`[Webhook] Unregistered: ${id}`);
  }
  return deleted;
}

/**
 * Get all registered webhooks.
 */
export function getWebhooks(): WebhookRegistration[] {
  return Array.from(webhooks.values());
}

/**
 * Get a specific webhook.
 */
export function getWebhook(id: string): WebhookRegistration | undefined {
  return webhooks.get(id);
}

/**
 * Update webhook status.
 */
export function updateWebhook(id: string, updates: Partial<WebhookRegistration>): WebhookRegistration | null {
  const webhook = webhooks.get(id);
  if (!webhook) return null;
  
  const updated = { ...webhook, ...updates };
  webhooks.set(id, updated);
  return updated;
}

/**
 * Generate HMAC signature for payload.
 */
function signPayload(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

/**
 * Dispatch event to all subscribed webhooks.
 */
export async function dispatchEvent(
  event: WebhookEvent,
  data: Record<string, unknown>
): Promise<{ sent: number; failed: number }> {
  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };
  
  const payloadString = JSON.stringify(payload);
  
  // Find webhooks subscribed to this event
  const subscribedWebhooks = Array.from(webhooks.values())
    .filter(wh => wh.active && wh.events.includes(event));
  
  let sent = 0;
  let failed = 0;
  
  for (const webhook of subscribedWebhooks) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Webhook-Event': event,
        'X-Webhook-Timestamp': payload.timestamp,
      };
      
      // Add signature if secret is configured
      if (webhook.secret) {
        headers['X-Webhook-Signature'] = signPayload(payloadString, webhook.secret);
      }
      
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: AbortSignal.timeout(10000), // 10s timeout
      });
      
      if (response.ok) {
        sent++;
        webhook.lastTriggered = payload.timestamp;
        webhook.failureCount = 0;
        
        logEvent(event, webhook.id, true);
      } else {
        failed++;
        webhook.failureCount++;
        
        logEvent(event, webhook.id, false);
        console.warn(`[Webhook] ${webhook.id} returned ${response.status}`);
      }
      
      // Disable webhook after too many failures
      if (webhook.failureCount >= 5) {
        webhook.active = false;
        console.warn(`[Webhook] ${webhook.id} disabled after 5 failures`);
      }
      
    } catch (error) {
      failed++;
      webhook.failureCount++;
      
      logEvent(event, webhook.id, false);
      console.error(`[Webhook] ${webhook.id} error:`, error);
    }
  }
  
  return { sent, failed };
}

/**
 * Log event for debugging.
 */
function logEvent(event: WebhookEvent, webhookId?: string, success?: boolean): void {
  eventLog.unshift({
    event,
    timestamp: new Date().toISOString(),
    webhookId,
    success,
  });
  
  // Trim log
  if (eventLog.length > MAX_EVENT_LOG) {
    eventLog.length = MAX_EVENT_LOG;
  }
}

/**
 * Get recent event log.
 */
export function getEventLog(limit: number = 50): typeof eventLog {
  return eventLog.slice(0, limit);
}

// ===== CONVENIENCE FUNCTIONS FOR COMMON EVENTS =====

export async function emitContactCreated(contact: Record<string, unknown>): Promise<void> {
  await dispatchEvent('contact.created', { contact });
}

export async function emitContactUpdated(contact: Record<string, unknown>, changes: string[]): Promise<void> {
  await dispatchEvent('contact.updated', { contact, changes });
}

export async function emitScoreChanged(
  username: string,
  oldScore: number,
  newScore: number,
  breakdown: Record<string, number>
): Promise<void> {
  await dispatchEvent('contact.score_changed', {
    username,
    oldScore,
    newScore,
    change: newScore - oldScore,
    breakdown,
  });
}

export async function emitMessageSent(
  username: string,
  text: string,
  automated: boolean
): Promise<void> {
  await dispatchEvent('message.sent', { username, text, automated });
}

export async function emitMessageReceived(
  username: string,
  text: string
): Promise<void> {
  await dispatchEvent('message.received', { username, text });
}

export async function emitSyncCompleted(result: Record<string, unknown>): Promise<void> {
  await dispatchEvent('sync.completed', result);
}

export async function emitMediaPosterVideoPosted(video: Record<string, unknown>): Promise<void> {
  await dispatchEvent('mediaposter.video_posted', { video });
}
