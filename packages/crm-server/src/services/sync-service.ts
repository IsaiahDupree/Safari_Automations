/**
 * Sync Service
 * Syncs data between Instagram (via Safari) and CRM database.
 */

import { getSafariClient } from '../clients/safari-client.js';
import { 
  getCRMDatabase, 
  upsertContact, 
  getContactByUsername,
  type Contact 
} from '../clients/database-client.js';

export interface SyncResult {
  contactsFound: number;
  contactsCreated: number;
  contactsUpdated: number;
  errors: string[];
}

export async function syncConversations(): Promise<SyncResult> {
  const safari = getSafariClient();
  const result: SyncResult = {
    contactsFound: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
    errors: [],
  };
  
  try {
    // Navigate to inbox
    await safari.navigateToInbox();
    
    // Get all conversations
    const { conversations, totalCount } = await safari.getAllConversations();
    result.contactsFound = totalCount;
    
    // Process each tab
    for (const [tab, convos] of Object.entries(conversations)) {
      for (const convo of convos) {
        try {
          const existing = await getContactByUsername(convo.username);
          
          if (existing) {
            // Update existing contact
            await getCRMDatabase()
              .from('instagram_contacts')
              .update({
                updated_at: new Date().toISOString(),
              })
              .eq('id', existing.id);
            result.contactsUpdated++;
          } else {
            // Create new contact
            await upsertContact({
              instagram_username: convo.username,
              relationship_score: 50,
              pipeline_stage: 'first_touch',
              fit_signals: [],
            });
            result.contactsCreated++;
          }
        } catch (error) {
          result.errors.push(`Failed to sync ${convo.username}: ${error}`);
        }
      }
    }
  } catch (error) {
    result.errors.push(`Sync failed: ${error}`);
  }
  
  return result;
}

export async function syncMessages(username: string): Promise<{
  success: boolean;
  messagesFound: number;
  messagesSaved: number;
  error?: string;
}> {
  const safari = getSafariClient();
  
  try {
    // Open conversation
    const opened = await safari.openConversation(username);
    if (!opened.success) {
      return { success: false, messagesFound: 0, messagesSaved: 0, error: 'Could not open conversation' };
    }
    
    // Wait for conversation to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Read messages
    const { messages, count } = await safari.readMessages(50);
    
    // Get or create contact
    let contact = await getContactByUsername(username);
    if (!contact) {
      contact = await upsertContact({
        instagram_username: username,
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
    
    // Save messages (avoid duplicates by checking text and approximate time)
    let saved = 0;
    for (const msg of messages) {
      try {
        // Simple duplicate check
        const { data: existing } = await getCRMDatabase()
          .from('instagram_messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('message_text', msg.text)
          .limit(1);
        
        if (!existing || existing.length === 0) {
          await getCRMDatabase()
            .from('instagram_messages')
            .insert({
              conversation_id: conversationId,
              contact_id: contact.id,
              message_text: msg.text,
              message_type: msg.messageType || 'text',
              is_outbound: msg.isOutbound,
              sent_by_automation: false,
              sent_at: new Date().toISOString(), // Approximate
            });
          saved++;
        }
      } catch (error) {
        // Skip duplicates or errors
      }
    }
    
    // Update last message time
    if (messages.length > 0) {
      await getCRMDatabase()
        .from('instagram_contacts')
        .update({ 
          last_message_at: new Date().toISOString(),
          total_messages_received: (contact as any).total_messages_received + 
            messages.filter(m => !m.isOutbound).length,
        })
        .eq('id', contact.id);
    }
    
    return { success: true, messagesFound: count, messagesSaved: saved };
  } catch (error) {
    return { success: false, messagesFound: 0, messagesSaved: 0, error: String(error) };
  }
}

export async function fullSync(): Promise<{
  conversations: SyncResult;
  messages: { username: string; result: any }[];
}> {
  // First sync all conversations
  const convResult = await syncConversations();
  
  // Then sync messages for top contacts
  const { data: contacts } = await getCRMDatabase()
    .from('instagram_contacts')
    .select('instagram_username')
    .order('relationship_score', { ascending: false })
    .limit(10);
  
  const messageResults = [];
  for (const contact of contacts || []) {
    const result = await syncMessages(contact.instagram_username);
    messageResults.push({ username: contact.instagram_username, result });
    
    // Delay between syncs
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  return { conversations: convResult, messages: messageResults };
}
