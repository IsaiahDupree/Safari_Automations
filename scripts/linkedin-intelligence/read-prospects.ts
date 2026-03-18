#!/usr/bin/env npx tsx
/**
 * read-prospects.ts — STEP 2: Read all prospect DM conversations from LinkedIn
 *
 * Usage: npx tsx scripts/linkedin-intelligence/read-prospects.ts
 */

import { getProspects, getStats } from
  "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/linkedin-automation/dist/automation/outreach-engine.js";

const active = getProspects({ stage: ["connected","first_dm_sent","replied","follow_up_1","follow_up_2","engaged"] });
const pending = getProspects({ stage: ["connection_sent"] });
const stats = getStats();

console.log("STATS:", JSON.stringify(stats, null, 2));
console.log(`\nACTIVE PROSPECTS (${active.length}):`);
console.log(JSON.stringify(active, null, 2));
console.log(`\nPENDING CONNECTIONS (${pending.length})`);
