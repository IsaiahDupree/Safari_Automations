#!/usr/bin/env npx tsx
/**
 * generate-replies.ts — STEP 4: Generate reply suggestions for HOT and WARM leads
 *
 * Writes reply suggestions to /tmp/reply-suggestions.json for Supabase sync.
 *
 * Usage: npx tsx scripts/linkedin-intelligence/generate-replies.ts
 */

import { getProspects } from
  "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/linkedin-automation/dist/automation/outreach-engine.js";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const leads = getProspects().filter((p: any) =>
  p.tags.includes("hot-lead") || p.tags.includes("warm-lead")
);

if (!leads.length) {
  console.log("No HOT/WARM leads found. Run score-prospects.ts first.");
  fs.writeFileSync("/tmp/reply-suggestions.json", "[]");
  process.exit(0);
}

console.log(`Generating reply suggestions for ${leads.length} HOT/WARM leads...`);

const out: any[] = [];

for (const p of leads) {
  const lastSent = p.messagesSent.at(-1)?.text ?? "none";
  const lastReply = p.messagesReceived.at(-1)?.text ?? "no reply yet";

  const res = await ai.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [{ role: "user", content:
      `Write 2 LinkedIn reply options for Sarah Ashley (Portal Copy Co, copywriter).
Prospect: ${p.name} (${p.headline}, ${p.location})
Last Sarah sent: ${lastSent}
Their reply: ${lastReply}
Option A: move toward a discovery call (warm, curious, zero pressure, max 3 sentences)
Option B: send a value asset (offer free brand voice checklist, max 2 sentences)
Return JSON only: {"option_a":"string","option_b":"string","recommended":"option_a|option_b"}` }]
  });

  const raw = res.content[0].type === "text" ? res.content[0].text : "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  const r = JSON.parse(match?.[0] ?? "{}");

  out.push({ id: p.id, name: p.name, stage: p.stage, heat: p.tags.join(","), ...r });

  const heatEmoji = p.tags.includes("hot-lead") ? "🔥" : "🌤";
  console.log(`\n${heatEmoji} ${p.name} (${p.tags.join(",")})`);
  console.log(`  A: ${r.option_a}`);
  console.log(`  B: ${r.option_b}`);
  console.log(`  Recommended: ${r.recommended}`);
}

fs.writeFileSync("/tmp/reply-suggestions.json", JSON.stringify(out, null, 2));
console.log(`\n✅ Saved ${out.length} reply suggestions to /tmp/reply-suggestions.json`);
