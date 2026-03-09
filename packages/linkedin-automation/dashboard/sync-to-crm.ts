import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ivhfuhxorppptyuofbgq.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_ANON_KEY) {
  console.error('Error: SUPABASE_ANON_KEY environment variable is required');
  console.error('Get it from: https://supabase.com/dashboard/project/ivhfuhxorppptyuofbgq/settings/api');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

interface Prospect {
  id: string;
  name: string;
  profileUrl: string;
  headline: string;
  location: string;
  stage: string;
  score: number;
  connectedAt: string | null;
  firstDmSentAt: string | null;
  lastMessageSentAt: string | null;
  lastReplyAt: string | null;
  nextFollowUpAt: string | null;
  followUpCount: number;
  tags: string[];
  notes: string;
  messagesSent: any[];
  messagesReceived: any[];
}

async function syncProspectsToCRM() {
  console.log('Starting LinkedIn → Supabase CRM sync...');

  // Read prospects from file
  const prospectsPath = path.join(process.env.HOME || '', '.linkedin-outreach', 'prospects.json');
  const prospectsData = fs.readFileSync(prospectsPath, 'utf-8');
  const prospects: Prospect[] = JSON.parse(prospectsData);

  console.log(`Found ${prospects.length} prospects to sync`);

  let contactsUpserted = 0;
  let conversationsUpserted = 0;
  let messagesScheduled = 0;

  for (const prospect of prospects) {
    try {
      // 1. Upsert to crm_contacts
      const contactData = {
        display_name: prospect.name,
        linkedin_url: prospect.profileUrl,
        headline: prospect.headline,
        platform: 'linkedin',
        tags: prospect.tags,
        notes: prospect.notes,
        stage: mapProspectStageToCRMStage(prospect.stage),
        first_touch_at: prospect.firstDmSentAt || prospect.connectedAt,
        last_message_at: prospect.lastMessageSentAt || prospect.lastReplyAt,
        last_interaction_at: prospect.lastReplyAt || prospect.lastMessageSentAt,
        metadata: {
          score: prospect.score,
          location: prospect.location,
          followUpCount: prospect.followUpCount,
          prospectId: prospect.id
        },
        updated_at: new Date().toISOString()
      };

      // Check if contact exists
      const { data: existingContact } = await supabase
        .from('crm_contacts')
        .select('id')
        .eq('linkedin_url', prospect.profileUrl)
        .single();

      let contact;
      if (existingContact) {
        // Update existing contact
        const { data, error: updateError } = await supabase
          .from('crm_contacts')
          .update(contactData)
          .eq('id', existingContact.id)
          .select()
          .single();

        if (updateError) {
          console.error(`Error updating contact ${prospect.name}:`, updateError.message);
          continue;
        }
        contact = data;
      } else {
        // Insert new contact
        const { data, error: insertError } = await supabase
          .from('crm_contacts')
          .insert(contactData)
          .select()
          .single();

        if (insertError) {
          console.error(`Error inserting contact ${prospect.name}:`, insertError.message);
          continue;
        }
        contact = data;
      }

      const contactError = null;

      if (contactError) {
        console.error(`Error upserting contact ${prospect.name}:`, contactError.message);
        continue;
      }

      contactsUpserted++;

      // 2. Upsert to crm_conversations (if there's been communication)
      if (prospect.firstDmSentAt || prospect.lastReplyAt) {
        const conversationData = {
          contact_id: contact.id,
          platform: 'linkedin',
          last_message: getLastMessage(prospect),
          stage: mapProspectStageToCRMStage(prospect.stage),
          last_message_at: prospect.lastMessageSentAt || prospect.lastReplyAt,
          message_count: prospect.messagesSent.length + prospect.messagesReceived.length,
          updated_at: new Date().toISOString()
        };

        const { error: convError } = await supabase
          .from('crm_conversations')
          .upsert(conversationData, { onConflict: 'contact_id,platform' });

        if (convError) {
          console.error(`Error upserting conversation for ${prospect.name}:`, convError.message);
        } else {
          conversationsUpserted++;
        }
      }

      // 3. Schedule follow-ups in crm_message_queue
      if (prospect.nextFollowUpAt && new Date(prospect.nextFollowUpAt) > new Date()) {
        // Check if already scheduled
        const { data: existing } = await supabase
          .from('crm_message_queue')
          .select('id')
          .eq('contact_id', contact.id)
          .eq('platform', 'linkedin')
          .eq('status', 'pending')
          .single();

        if (!existing) {
          const messageData = {
            contact_id: contact.id,
            platform: 'linkedin',
            message_type: 'follow_up',
            message_body: generateFollowUpMessage(prospect),
            scheduled_for: prospect.nextFollowUpAt,
            status: 'pending',
            created_at: new Date().toISOString()
          };

          const { error: msgError } = await supabase
            .from('crm_message_queue')
            .insert(messageData);

          if (msgError) {
            console.error(`Error scheduling follow-up for ${prospect.name}:`, msgError.message);
          } else {
            messagesScheduled++;
          }
        }
      }

    } catch (error: any) {
      console.error(`Error processing prospect ${prospect.name}:`, error.message);
    }
  }

  console.log('\n=== SYNC SUMMARY ===');
  console.log(`Contacts upserted: ${contactsUpserted}`);
  console.log(`Conversations upserted: ${conversationsUpserted}`);
  console.log(`Follow-ups scheduled: ${messagesScheduled}`);
  console.log('\nSync complete! ✓');
}

function getLastMessage(prospect: Prospect): string {
  if (prospect.messagesReceived.length > 0) {
    return prospect.messagesReceived[prospect.messagesReceived.length - 1].content || '';
  }
  if (prospect.messagesSent.length > 0) {
    return prospect.messagesSent[prospect.messagesSent.length - 1].content || '';
  }
  return '';
}

function mapProspectStageToCRMStage(prospectStage: string): string {
  const stageMap: { [key: string]: string } = {
    'discovered': 'prospect',
    'connection_sent': 'prospect',
    'connected': 'first_touch',
    'first_dm_sent': 'first_touch',
    'replied': 'replied',
    'converted': 'converted'
  };
  return stageMap[prospectStage] || 'prospect';
}

function generateFollowUpMessage(prospect: Prospect): string {
  const firstName = prospect.name.split(' ')[0];
  const templates = [
    `Hi ${firstName}, just following up! Happy to share copy ideas for your brand if useful.`,
    `${firstName}, I give away a free brand voice checklist - want me to send it?`,
    `${firstName} - if you ever need a copywriter who gets the founder brand voice: portalcopyco.com. Take care!`
  ];

  const templateIndex = Math.min(prospect.followUpCount, templates.length - 1);
  return templates[templateIndex];
}

// Run the sync
syncProspectsToCRM().catch(console.error);
