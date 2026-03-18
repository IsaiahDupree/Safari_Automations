-- verify-sync.sql — STEP 6: Verify Supabase sync for LinkedIn prospects
-- Run via: supabase db execute < verify-sync.sql
-- Or paste into Supabase SQL editor at https://ivhfuhxorppptyuofbgq.supabase.co

SELECT
  c.name,
  c.pipeline_stage AS stage,
  c.relationship_score AS lead_score,
  c.tags,
  cv.last_message_sent,
  cv.last_message_received AS last_reply_received,
  mq.send_at,
  mq.status,
  mq.recommended_option,
  mq.message_text
FROM crm_contacts c
LEFT JOIN crm_conversations cv
  ON cv.contact_id = c.id AND cv.platform = 'linkedin'
LEFT JOIN crm_message_queue mq
  ON mq.contact_id = c.id AND mq.status = 'pending'
WHERE c.platform = 'linkedin'
ORDER BY c.relationship_score DESC NULLS LAST, mq.send_at ASC;
