/**
 * Outreach Service
 * Manages message queue and coordinates with Safari Automation for sending.
 */

import { getSafariClient } from '../clients/safari-client.js';
import { 
  getCRMDatabase, 
  getContactByUsername, 
  insertMessage,
  upsertContact 
} from '../clients/database-client.js';

export interface OutreachMessage {
  id?: string;
  username: string;
  text: string;
  priority: number;
  scheduled_at?: string;
  status: 'pending' | 'sent' | 'failed' | 'rate_limited';
  created_at?: string;
  sent_at?: string;
  error?: string;
}

// In-memory queue (could be backed by database)
let messageQueue: OutreachMessage[] = [];

export function getQueue(): OutreachMessage[] {
  return [...messageQueue];
}

export function queueMessage(msg: Omit<OutreachMessage, 'id' | 'status' | 'created_at'>): OutreachMessage {
  const message: OutreachMessage = {
    ...msg,
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  
  messageQueue.push(message);
  
  // Sort by priority (higher first) then by scheduled time
  messageQueue.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.scheduled_at && b.scheduled_at) {
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    }
    return 0;
  });
  
  return message;
}

export function removeFromQueue(id: string): boolean {
  const index = messageQueue.findIndex(m => m.id === id);
  if (index >= 0) {
    messageQueue.splice(index, 1);
    return true;
  }
  return false;
}

export function clearQueue(): number {
  const count = messageQueue.length;
  messageQueue = [];
  return count;
}

export async function processNextMessage(): Promise<{
  success: boolean;
  message?: OutreachMessage;
  error?: string;
}> {
  // Get next pending message that's ready to send
  const now = new Date();
  const message = messageQueue.find(m => 
    m.status === 'pending' && 
    (!m.scheduled_at || new Date(m.scheduled_at) <= now)
  );
  
  if (!message) {
    return { success: false, error: 'No messages ready to send' };
  }
  
  const safari = getSafariClient();
  
  // Check rate limits first
  try {
    const limits = await safari.getRateLimits();
    if (!limits.activeHours.isActive) {
      message.status = 'rate_limited';
      message.error = 'Outside active hours';
      return { success: false, message, error: 'Outside active hours' };
    }
    
    if (limits.messagesSentThisHour >= limits.limits.messagesPerHour) {
      message.status = 'rate_limited';
      message.error = 'Hourly limit reached';
      return { success: false, message, error: 'Hourly rate limit' };
    }
    
    if (limits.messagesSentToday >= limits.limits.messagesPerDay) {
      message.status = 'rate_limited';
      message.error = 'Daily limit reached';
      return { success: false, message, error: 'Daily rate limit' };
    }
  } catch (error) {
    message.status = 'failed';
    message.error = 'Safari server unavailable';
    return { success: false, message, error: 'Safari server unavailable' };
  }
  
  // Send the message
  try {
    const result = await safari.sendMessageTo(message.username, message.text);
    
    if (result.success) {
      message.status = 'sent';
      message.sent_at = new Date().toISOString();
      
      // Log to database
      await logSentMessage(message);
      
      // Remove from queue
      removeFromQueue(message.id!);
      
      return { success: true, message };
    } else {
      message.status = 'failed';
      message.error = result.error || 'Unknown error';
      return { success: false, message, error: result.error };
    }
  } catch (error) {
    message.status = 'failed';
    message.error = String(error);
    return { success: false, message, error: String(error) };
  }
}

async function logSentMessage(msg: OutreachMessage): Promise<void> {
  try {
    // Ensure contact exists
    let contact = await getContactByUsername(msg.username);
    if (!contact) {
      contact = await upsertContact({
        instagram_username: msg.username,
        relationship_score: 50,
        pipeline_stage: 'first_touch',
        fit_signals: [],
      });
    }
    
    // Get or create conversation
    const { data: convos } = await getCRMDatabase()
      .from('instagram_conversations')
      .select('id')
      .eq('contact_id', contact.id)
      .limit(1);
    
    let conversationId: string;
    if (convos && convos.length > 0) {
      conversationId = convos[0].id;
    } else {
      const { data: newConvo } = await getCRMDatabase()
        .from('instagram_conversations')
        .insert({ contact_id: contact.id })
        .select('id')
        .single();
      conversationId = newConvo?.id || '';
    }
    
    // Insert message
    await insertMessage({
      conversation_id: conversationId,
      contact_id: contact.id,
      message_text: msg.text,
      message_type: 'text',
      is_outbound: true,
      sent_by_automation: true,
      sent_at: msg.sent_at || new Date().toISOString(),
    });
    
    // Update contact last message time
    await getCRMDatabase()
      .from('instagram_contacts')
      .update({ 
        last_message_at: msg.sent_at,
        total_messages_sent: (contact as any).total_messages_sent + 1 || 1,
      })
      .eq('id', contact.id);
      
  } catch (error) {
    console.error('[Outreach] Failed to log message:', error);
  }
}

export async function processAllPending(): Promise<{
  sent: number;
  failed: number;
  rateLimited: number;
}> {
  let sent = 0;
  let failed = 0;
  let rateLimited = 0;
  
  while (true) {
    const result = await processNextMessage();
    
    if (!result.message) break; // No more messages
    
    if (result.success) {
      sent++;
    } else if (result.message.status === 'rate_limited') {
      rateLimited++;
      break; // Stop if rate limited
    } else {
      failed++;
    }
    
    // Add delay between messages
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  return { sent, failed, rateLimited };
}
