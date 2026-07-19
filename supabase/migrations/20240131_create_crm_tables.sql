-- CRM Tables Migration

-- Contacts table
CREATE TABLE IF NOT EXISTS instagram_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  profile_pic_url TEXT,
  bio TEXT,
  relationship_score INTEGER DEFAULT 50,
  pipeline_stage TEXT DEFAULT 'first_touch',
  what_theyre_building TEXT,
  current_friction TEXT,
  their_definition_of_win TEXT,
  asks_opinion BOOLEAN DEFAULT FALSE,
  shares_updates BOOLEAN DEFAULT FALSE,
  has_referred_others BOOLEAN DEFAULT FALSE,
  fit_signals TEXT[] DEFAULT '{}',
  total_messages_sent INTEGER DEFAULT 0,
  total_messages_received INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations table
CREATE TABLE IF NOT EXISTS instagram_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES instagram_contacts(id) ON DELETE CASCADE,
  thread_id TEXT,
  last_message_preview TEXT,
  unread_count INTEGER DEFAULT 0,
  is_group BOOLEAN DEFAULT FALSE,
  participant_count INTEGER DEFAULT 2,
  dm_tab TEXT DEFAULT 'primary',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS instagram_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES instagram_conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES instagram_contacts(id) ON DELETE CASCADE,
  message_text TEXT,
  message_type TEXT DEFAULT 'text',
  media_url TEXT,
  is_outbound BOOLEAN DEFAULT FALSE,
  sent_by_automation BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Outreach queue
CREATE TABLE IF NOT EXISTS outreach_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES instagram_contacts(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  message_text TEXT NOT NULL,
  priority INTEGER DEFAULT 50,
  status TEXT DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook events
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  payload JSONB,
  source TEXT,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contacts_username ON instagram_contacts(instagram_username);
CREATE INDEX IF NOT EXISTS idx_contacts_score ON instagram_contacts(relationship_score);
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON instagram_conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON instagram_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON instagram_messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON instagram_messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach_queue(status);
