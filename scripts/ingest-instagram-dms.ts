/**
 * Ingest Instagram DM Data
 * Pulls all conversations from Instagram via Safari Automation and saves to database
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.CRM_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.CRM_SUPABASE_KEY || '';
const safariUrl = process.env.SAFARI_API_URL || 'http://localhost:3100';

const supabase = createClient(supabaseUrl, supabaseKey);

interface DMConversation {
  username: string;
  lastMessage?: string;
}

interface DMMessage {
  text: string;
  isOutbound: boolean;
  messageType: string;
}

async function safariRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${safariUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json() as Promise<T>;
}

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ingestAllDMs() {
  console.log('\n🔄 Starting Instagram DM Ingestion...\n');
  console.log(`Safari API: ${safariUrl}`);
  console.log(`Supabase: ${supabaseUrl}\n`);

  // Check Safari server
  try {
    const health = await safariRequest<{ status: string }>('/health');
    console.log(`✅ Safari server: ${health.status}\n`);
  } catch (error) {
    console.error('❌ Safari server not available. Make sure it is running.');
    process.exit(1);
  }

  // Navigate to inbox
  console.log('📬 Navigating to Instagram inbox...');
  await safariRequest('/api/inbox/navigate', 'POST');
  await wait(3000);

  // Get all conversations from all tabs
  console.log('📋 Fetching conversations from all tabs...\n');
  
  const tabs = ['primary', 'general', 'requests'];
  const allConversations: { tab: string; username: string; lastMessage?: string }[] = [];

  for (const tab of tabs) {
    console.log(`  Switching to ${tab}...`);
    await safariRequest('/api/inbox/tab', 'POST', { tab });
    await wait(2000);

    const result = await safariRequest<{ conversations: DMConversation[]; count: number }>('/api/conversations');
    console.log(`  Found ${result.count} conversations in ${tab}`);

    for (const conv of result.conversations) {
      if (conv.username && conv.username.length > 1) {
        allConversations.push({ tab, ...conv });
      }
    }
  }

  console.log(`\n📊 Total unique conversations: ${allConversations.length}\n`);

  // Process each conversation
  let contactsCreated = 0;
  let contactsUpdated = 0;
  let messagesIngested = 0;
  let errors: string[] = [];

  for (let i = 0; i < allConversations.length; i++) {
    const conv = allConversations[i];
    console.log(`[${i + 1}/${allConversations.length}] Processing @${conv.username}...`);

    try {
      // Upsert contact
      const { data: existingContact } = await supabase
        .from('instagram_contacts')
        .select('id, total_messages_received, total_messages_sent')
        .eq('instagram_username', conv.username)
        .single();

      let contactId: string;

      if (existingContact) {
        contactId = existingContact.id;
        contactsUpdated++;
      } else {
        const { data: newContact, error } = await supabase
          .from('instagram_contacts')
          .insert({
            instagram_username: conv.username,
            relationship_score: 50,
            pipeline_stage: 'first_touch',
            fit_signals: [],
            tags: [conv.tab],
          })
          .select('id')
          .single();

        if (error) throw error;
        contactId = newContact!.id;
        contactsCreated++;
      }

      // Get or create conversation
      const { data: existingConv } = await supabase
        .from('instagram_conversations')
        .select('id')
        .eq('contact_id', contactId)
        .single();

      let conversationId: string;

      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        const { data: newConv, error } = await supabase
          .from('instagram_conversations')
          .insert({
            contact_id: contactId,
            dm_tab: conv.tab,
            last_message_preview: conv.lastMessage?.substring(0, 100),
          })
          .select('id')
          .single();

        if (error) throw error;
        conversationId = newConv!.id;
      }

      // Open conversation and read messages
      await safariRequest('/api/conversations/open', 'POST', { username: conv.username });
      await wait(2000);

      const msgResult = await safariRequest<{ messages: DMMessage[]; count: number }>('/api/messages?limit=30');
      
      if (msgResult.messages.length > 0) {
        // Insert messages (check for duplicates)
        let newMessages = 0;
        
        for (const msg of msgResult.messages) {
          if (!msg.text || msg.text.length < 1) continue;

          // Check if message already exists
          const { data: existing } = await supabase
            .from('instagram_messages')
            .select('id')
            .eq('conversation_id', conversationId)
            .eq('message_text', msg.text.substring(0, 500))
            .limit(1);

          if (!existing || existing.length === 0) {
            await supabase.from('instagram_messages').insert({
              conversation_id: conversationId,
              contact_id: contactId,
              message_text: msg.text.substring(0, 2000),
              message_type: msg.messageType || 'text',
              is_outbound: msg.isOutbound,
              sent_by_automation: false,
            });
            newMessages++;
            messagesIngested++;
          }
        }

        console.log(`  ✅ ${newMessages} new messages saved`);

        // Update contact message counts
        const inbound = msgResult.messages.filter(m => !m.isOutbound).length;
        const outbound = msgResult.messages.filter(m => m.isOutbound).length;

        await supabase
          .from('instagram_contacts')
          .update({
            last_message_at: new Date().toISOString(),
            total_messages_received: (existingContact?.total_messages_received || 0) + inbound,
            total_messages_sent: (existingContact?.total_messages_sent || 0) + outbound,
            updated_at: new Date().toISOString(),
          })
          .eq('id', contactId);
      } else {
        console.log(`  ⚠️  No messages found`);
      }

      // Small delay to avoid rate limiting
      await wait(1500);

    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
      errors.push(`${conv.username}: ${error}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 INGESTION SUMMARY');
  console.log('='.repeat(50));
  console.log(`  Contacts created:  ${contactsCreated}`);
  console.log(`  Contacts updated:  ${contactsUpdated}`);
  console.log(`  Messages ingested: ${messagesIngested}`);
  console.log(`  Errors:            ${errors.length}`);
  
  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.slice(0, 5).forEach(e => console.log(`  - ${e}`));
    if (errors.length > 5) console.log(`  ... and ${errors.length - 5} more`);
  }

  // Verify final counts
  const { count: contactCount } = await supabase.from('instagram_contacts').select('*', { count: 'exact', head: true });
  const { count: msgCount } = await supabase.from('instagram_messages').select('*', { count: 'exact', head: true });

  console.log('\n📋 Database Totals:');
  console.log(`  Total contacts: ${contactCount}`);
  console.log(`  Total messages: ${msgCount}`);
  console.log('\n✨ Ingestion complete!\n');
}

ingestAllDMs().catch(console.error);
