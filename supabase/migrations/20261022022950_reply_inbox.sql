-- Durable inbox evidence and sync freshness for the reply review module.
BEGIN;

CREATE TABLE IF NOT EXISTS public.acq_inbound_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL DEFAULT 'imap',
    source_uid text,
    message_id text NOT NULL,
    contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
    from_email text NOT NULL,
    subject text NOT NULL DEFAULT '',
    body_text text NOT NULL DEFAULT '',
    in_reply_to text,
    references_ids text[] NOT NULL DEFAULT '{}',
    occurred_at timestamptz NOT NULL,
    link_status text NOT NULL CHECK (link_status IN ('human_reply','needs_review','unmatched')),
    link_reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, message_id)
);
CREATE INDEX IF NOT EXISTS idx_acq_inbound_contact_occurred
    ON public.acq_inbound_messages(contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_acq_inbound_link_status
    ON public.acq_inbound_messages(link_status, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.acq_inbox_sync_state (
    source text PRIMARY KEY,
    last_attempt_at timestamptz NOT NULL,
    last_success_at timestamptz,
    last_error text,
    messages_seen integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.acq_inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acq_inbox_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.acq_inbound_messages FROM anon, authenticated;
REVOKE ALL ON public.acq_inbox_sync_state FROM anon, authenticated;
GRANT ALL ON public.acq_inbound_messages TO service_role;
GRANT ALL ON public.acq_inbox_sync_state TO service_role;
COMMIT;
