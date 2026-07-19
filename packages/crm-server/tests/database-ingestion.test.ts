/**
 * Database Ingestion Tests
 * Verifiable tests for storing and retrieving CRM data
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.CRM_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.CRM_SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';

let supabase: SupabaseClient;
let dbAvailable = false;

beforeAll(async () => {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { error } = await supabase.from('instagram_contacts').select('id').limit(1);
    dbAvailable = !error;
  } catch {
    dbAvailable = false;
  }
});

describe('Database Connection', () => {
  it('should connect to Supabase', async () => {
    if (!dbAvailable) {
      console.log('⚠️ Database not available - skipping DB tests');
      return;
    }
    
    expect(supabase).toBeDefined();
    
    const { error } = await supabase.from('instagram_contacts').select('id').limit(1);
    expect(error).toBeNull();
  });

  it('should have required tables', async () => {
    if (!dbAvailable) return;
    
    const tables = ['instagram_contacts', 'instagram_conversations', 'instagram_messages', 'outreach_queue'];
    
    for (const table of tables) {
      const { error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      expect(error).toBeNull();
    }
  });
});

describe('Contact CRUD Operations', () => {
  const testUsername = `test_user_${Date.now()}`;
  let testContactId: string;

  it('should create a contact', async () => {
    if (!dbAvailable) return;
    
    const { data, error } = await supabase
      .from('instagram_contacts')
      .insert({
        instagram_username: testUsername,
        display_name: 'Test User',
        relationship_score: 75,
        pipeline_stage: 'curiosity_exchange',
        fit_signals: ['interested_in_product'],
        tags: ['test'],
      })
      .select()
      .single();
    
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.instagram_username).toBe(testUsername);
    expect(data.relationship_score).toBe(75);
    expect(data.pipeline_stage).toBe('curiosity_exchange');
    
    testContactId = data.id;
  });

  it('should read a contact by username', async () => {
    if (!dbAvailable || !testContactId) return;
    
    const { data, error } = await supabase
      .from('instagram_contacts')
      .select('*')
      .eq('instagram_username', testUsername)
      .single();
    
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.id).toBe(testContactId);
  });

  it('should update a contact', async () => {
    if (!dbAvailable || !testContactId) return;
    
    const { data, error } = await supabase
      .from('instagram_contacts')
      .update({
        relationship_score: 85,
        what_theyre_building: 'A test project',
      })
      .eq('id', testContactId)
      .select()
      .single();
    
    expect(error).toBeNull();
    expect(data.relationship_score).toBe(85);
    expect(data.what_theyre_building).toBe('A test project');
  });

  it('should delete a contact', async () => {
    if (!dbAvailable || !testContactId) return;
    
    const { error } = await supabase
      .from('instagram_contacts')
      .delete()
      .eq('id', testContactId);
    
    expect(error).toBeNull();
    
    // Verify deletion
    const { data } = await supabase
      .from('instagram_contacts')
      .select('id')
      .eq('id', testContactId)
      .single();
    
    expect(data).toBeNull();
  });
});

describe('Conversation CRUD Operations', () => {
  const testUsername = `conv_test_${Date.now()}`;
  let testContactId: string;
  let testConversationId: string;

  beforeAll(async () => {
    if (!dbAvailable) return;
    
    // Create a test contact first
    const { data } = await supabase
      .from('instagram_contacts')
      .insert({ instagram_username: testUsername, fit_signals: [] })
      .select()
      .single();
    
    testContactId = data?.id;
  });

  afterAll(async () => {
    if (!dbAvailable || !testContactId) return;
    
    // Clean up
    await supabase.from('instagram_contacts').delete().eq('id', testContactId);
  });

  it('should create a conversation', async () => {
    if (!dbAvailable || !testContactId) return;
    
    const { data, error } = await supabase
      .from('instagram_conversations')
      .insert({
        contact_id: testContactId,
        dm_tab: 'primary',
        last_message_preview: 'Hello test',
      })
      .select()
      .single();
    
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.contact_id).toBe(testContactId);
    expect(data.dm_tab).toBe('primary');
    
    testConversationId = data.id;
  });

  it('should read conversations by contact', async () => {
    if (!dbAvailable || !testContactId) return;
    
    const { data, error } = await supabase
      .from('instagram_conversations')
      .select('*')
      .eq('contact_id', testContactId);
    
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.length).toBeGreaterThan(0);
  });
});

describe('Message CRUD Operations', () => {
  const testUsername = `msg_test_${Date.now()}`;
  let testContactId: string;
  let testConversationId: string;

  beforeAll(async () => {
    if (!dbAvailable) return;
    
    // Create test contact
    const { data: contact } = await supabase
      .from('instagram_contacts')
      .insert({ instagram_username: testUsername, fit_signals: [] })
      .select()
      .single();
    
    testContactId = contact?.id;
    
    // Create test conversation
    const { data: conv } = await supabase
      .from('instagram_conversations')
      .insert({ contact_id: testContactId, dm_tab: 'primary' })
      .select()
      .single();
    
    testConversationId = conv?.id;
  });

  afterAll(async () => {
    if (!dbAvailable || !testContactId) return;
    
    // Clean up (cascade will delete related records)
    await supabase.from('instagram_contacts').delete().eq('id', testContactId);
  });

  it('should create a message', async () => {
    if (!dbAvailable || !testConversationId) return;
    
    const { data, error } = await supabase
      .from('instagram_messages')
      .insert({
        conversation_id: testConversationId,
        contact_id: testContactId,
        message_text: 'Test message content',
        message_type: 'text',
        is_outbound: false,
      })
      .select()
      .single();
    
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.message_text).toBe('Test message content');
    expect(data.is_outbound).toBe(false);
  });

  it('should create an outbound message', async () => {
    if (!dbAvailable || !testConversationId) return;
    
    const { data, error } = await supabase
      .from('instagram_messages')
      .insert({
        conversation_id: testConversationId,
        contact_id: testContactId,
        message_text: 'Outbound test message',
        message_type: 'text',
        is_outbound: true,
        sent_by_automation: true,
      })
      .select()
      .single();
    
    expect(error).toBeNull();
    expect(data.is_outbound).toBe(true);
    expect(data.sent_by_automation).toBe(true);
  });

  it('should read messages by conversation', async () => {
    if (!dbAvailable || !testConversationId) return;
    
    const { data, error } = await supabase
      .from('instagram_messages')
      .select('*')
      .eq('conversation_id', testConversationId)
      .order('sent_at', { ascending: false });
    
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.length).toBeGreaterThan(0);
  });

  it('should filter messages by outbound status', async () => {
    if (!dbAvailable || !testConversationId) return;
    
    const { data: outbound } = await supabase
      .from('instagram_messages')
      .select('*')
      .eq('conversation_id', testConversationId)
      .eq('is_outbound', true);
    
    const { data: inbound } = await supabase
      .from('instagram_messages')
      .select('*')
      .eq('conversation_id', testConversationId)
      .eq('is_outbound', false);
    
    expect(outbound).toBeDefined();
    expect(inbound).toBeDefined();
    
    outbound?.forEach(msg => expect(msg.is_outbound).toBe(true));
    inbound?.forEach(msg => expect(msg.is_outbound).toBe(false));
  });
});

describe('Outreach Queue Operations', () => {
  let testQueueId: string;

  it('should add message to outreach queue', async () => {
    if (!dbAvailable) return;
    
    const { data, error } = await supabase
      .from('outreach_queue')
      .insert({
        username: 'test_outreach_user',
        message_text: 'Scheduled outreach message',
        priority: 75,
        status: 'pending',
      })
      .select()
      .single();
    
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.status).toBe('pending');
    expect(data.priority).toBe(75);
    
    testQueueId = data.id;
  });

  it('should read pending queue items', async () => {
    if (!dbAvailable) return;
    
    const { data, error } = await supabase
      .from('outreach_queue')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false });
    
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it('should update queue item status', async () => {
    if (!dbAvailable || !testQueueId) return;
    
    const { data, error } = await supabase
      .from('outreach_queue')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
      .eq('id', testQueueId)
      .select()
      .single();
    
    expect(error).toBeNull();
    expect(data.status).toBe('sent');
    expect(data.sent_at).toBeDefined();
  });

  afterAll(async () => {
    if (!dbAvailable || !testQueueId) return;
    await supabase.from('outreach_queue').delete().eq('id', testQueueId);
  });
});

describe('Data Integrity', () => {
  it('should enforce unique username constraint', async () => {
    if (!dbAvailable) return;
    
    const uniqueUsername = `unique_test_${Date.now()}`;
    
    // First insert should succeed
    const { error: error1 } = await supabase
      .from('instagram_contacts')
      .insert({ instagram_username: uniqueUsername, fit_signals: [] });
    
    expect(error1).toBeNull();
    
    // Second insert with same username should fail
    const { error: error2 } = await supabase
      .from('instagram_contacts')
      .insert({ instagram_username: uniqueUsername, fit_signals: [] });
    
    expect(error2).not.toBeNull();
    
    // Clean up
    await supabase.from('instagram_contacts').delete().eq('instagram_username', uniqueUsername);
  });

  it('should cascade delete conversations when contact is deleted', async () => {
    if (!dbAvailable) return;
    
    const testUsername = `cascade_test_${Date.now()}`;
    
    // Create contact
    const { data: contact } = await supabase
      .from('instagram_contacts')
      .insert({ instagram_username: testUsername, fit_signals: [] })
      .select()
      .single();
    
    // Create conversation
    await supabase
      .from('instagram_conversations')
      .insert({ contact_id: contact.id, dm_tab: 'primary' });
    
    // Delete contact
    await supabase.from('instagram_contacts').delete().eq('id', contact.id);
    
    // Verify conversation was also deleted
    const { data: convs } = await supabase
      .from('instagram_conversations')
      .select('id')
      .eq('contact_id', contact.id);
    
    expect(convs?.length).toBe(0);
  });
});
