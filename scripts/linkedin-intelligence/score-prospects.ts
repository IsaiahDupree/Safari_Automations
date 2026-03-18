#!/usr/bin/env npx tsx
/**
 * score-prospects.ts — STEP 3: Score each DM conversation with Claude Haiku
 *
 * Scoring rubric (1-10):
 *   Relevance(0-3) + Personalization(0-3) + CTA clarity(0-2) + Tone(0-2)
 *   8-10 = HOT: reply within 24h, move toward proposal
 *   5-7  = WARM: follow up in 3 days, send value asset
 *   1-4  = COLD: nurture only
 *
 * Usage: npx tsx scripts/linkedin-intelligence/score-prospects.ts
 */

import { getProspects, addProspectNote, tagProspect } from
  "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/linkedin-automation/dist/automation/outreach-engine.js";
import Anthropic from "@anthropic-ai/sdk";

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const prospects = getProspects({ stage: ["connected","first_dm_sent","replied","follow_up_1","follow_up_2","engaged"] });

if (!prospects.length) {
  console.log("No active prospects to score.");
  process.exit(0);
}

console.log(`Scoring ${prospects.length} prospects with Claude Haiku...`);

for (const p of prospects) {
  const sent = p.messagesSent.map((m: any) => `SENT(${m.stage}): ${m.text}`).join("\n");
  const recv = p.messagesReceived.map((m: any) => `REPLY: ${m.text}`).join("\n");

  const resp = await ai.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{ role: "user", content:
      `Score this LinkedIn outreach 1-10 for Portal Copy Co (copywriting services).
Prospect: ${p.name}, ${p.headline}, ${p.location}
Stage: ${p.stage}
Sent:
${sent || "none"}
Replies:
${recv || "none"}
Scoring: Relevance(0-3)+Personalization(0-3)+CTA(0-2)+Tone(0-2)
Return JSON only: {"score":int,"heat":"HOT|WARM|COLD","relevance":int,"personalization":int,"cta":int,"tone":int,"reply_sentiment":"string","next_action":"string"}` }]
  });

  const raw = resp.content[0].type === "text" ? resp.content[0].text : "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  const s = JSON.parse(match?.[0] ?? "{}");

  addProspectNote(p.id, `SCORE:${s.score}/10 HEAT:${s.heat} | ${s.next_action}`);
  if (s.heat === "HOT") tagProspect(p.id, "hot-lead");
  if (s.heat === "WARM") tagProspect(p.id, "warm-lead");

  const heatEmoji = s.heat === "HOT" ? "🔥" : s.heat === "WARM" ? "🌤" : "❄️";
  console.log(`${heatEmoji} ${p.name} -> ${s.heat} ${s.score}/10 | ${s.next_action}`);
}

console.log("\n✅ Scoring complete.");
