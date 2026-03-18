#!/usr/bin/env npx tsx
/**
 * sync-to-supabase.ts — STEP 5: Upsert scored leads and replies into Supabase CRM
 *
 * Syncs to: crm_contacts, crm_conversations, crm_message_queue
 *
 * Usage: npx tsx scripts/linkedin-intelligence/sync-to-supabase.ts
 */

import { getProspects } from
  "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/linkedin-automation/dist/automation/outreach-engine.js";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const supabaseUrl = process.env.SUPABASE_URL ?? "https://ivhfuhxorppptyuofbgq.supabase.co";
const supabaseKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseKey) {
  console.error("SUPABASE_ANON_KEY not set");
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey);
const prospects = getProspects();

let replySuggestions: any[] = [];
if (fs.existsSync("/tmp/reply-suggestions.json")) {
  replySuggestions = JSON.parse(fs.readFileSync("/tmp/reply-suggestions.json", "utf8"));
}

console.log(`Syncing ${prospects.length} prospects to Supabase...`);

let synced = 0;
let errors = 0;

for (const p of prospects) {
  // 1. Upsert contact
  const { data: contact, error: contactErr } = await sb.from("crm_contacts").upsert({
    name: p.name,
    linkedin_url: p.profileUrl,
    title: p.headline,
    location: p.location,
    tags: p.tags,
    notes: p.notes,
    relationship_score: p.score ?? null,
    pipeline_stage: p.stage,
    platform: "linkedin",
    last_contacted_at: p.lastMessageSentAt ?? null,
    next_followup_at: p.nextFollowUpAt ?? null,
  }, { onConflict: "linkedin_url" }).select().single();

  if (contactErr || !contact) {
    console.error(`  ✗ Failed to upsert contact ${p.name}: ${contactErr?.message}`);
    errors++;
    continue;
  }

  // 2. Upsert conversation state
  await sb.from("crm_conversations").upsert({
    contact_id: contact.id,
    platform: "linkedin",
    stage: p.stage,
    last_message_sent: p.messagesSent.at(-1)?.text ?? null,
    last_message_sent_at: p.lastMessageSentAt ?? null,
    last_message_received: p.messagesReceived.at(-1)?.text ?? null,
    last_reply_at: p.lastReplyAt ?? null,
    follow_up_count: p.followUpCount ?? 0,
  }, { onConflict: "contact_id,platform" });

  // 3. Queue next follow-up with AI-generated reply pre-written
  if (p.nextFollowUpAt && new Date(p.nextFollowUpAt) > new Date()) {
    const r = replySuggestions.find((x: any) => x.id === p.id);
    await sb.from("crm_message_queue").upsert({
      contact_id: contact.id,
      platform: "linkedin",
      status: "pending",
      send_at: p.nextFollowUpAt,
      message_text: r?.option_a ?? null,
      message_text_b: r?.option_b ?? null,
      recommended_option: r?.recommended ?? "option_a",
      campaign: p.campaign ?? null,
    }, { onConflict: "contact_id,platform,send_at" });
  }

  synced++;
  const heatTag = p.tags.find((t: string) => t.includes("lead")) ?? "";
  console.log(`  ✓ ${p.name} | ${p.stage} ${heatTag ? `[${heatTag}]` : ""}`);
}

console.log(`\n✅ Synced ${synced}/${prospects.length} prospects. Errors: ${errors}`);
