#!/usr/bin/env npx tsx
/**
 * orchestrate.ts — End-to-end LinkedIn DM Intelligence Orchestrator
 *
 * Runs all steps in sequence:
 *   1. Health-check LinkedIn server (port 3105)
 *   2. Read all prospect DM conversations
 *   3. Score each conversation with Claude Haiku (HOT/WARM/COLD)
 *   4. Generate reply suggestions for HOT/WARM leads
 *   5. Sync everything to Supabase CRM
 *
 * Usage:
 *   npx tsx scripts/linkedin-intelligence/orchestrate.ts [--dry-run] [--skip-sync]
 *
 * Flags:
 *   --dry-run     Score and generate replies, but do NOT write to Supabase
 *   --skip-sync   Skip Supabase sync (steps 1-4 only)
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SKIP_SYNC = args.includes("--skip-sync") || DRY_RUN;
const SCRIPTS_DIR = path.dirname(new URL(import.meta.url).pathname);
const LINKEDIN_PORT = 3105;

function run(label: string, script: string): boolean {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`▶ ${label}`);
  console.log("=".repeat(60));
  try {
    execSync(`npx tsx "${SCRIPTS_DIR}/${script}"`, {
      stdio: "inherit",
      env: { ...process.env },
    });
    console.log(`✅ ${label} — done`);
    return true;
  } catch (e: any) {
    console.error(`❌ ${label} — FAILED (exit ${e.status})`);
    return false;
  }
}

// ─── STEP 1: Health-check LinkedIn server ────────────────────────────────────
console.log("\n🔍 STEP 1: Checking LinkedIn server (port 3105)...");
try {
  const health = execSync(`curl -sf http://localhost:${LINKEDIN_PORT}/health`, {
    encoding: "utf8",
    timeout: 5000,
  });
  console.log(`✅ LinkedIn server is UP: ${health.trim()}`);
} catch {
  console.error(`❌ LinkedIn server not responding on :${LINKEDIN_PORT}`);
  console.error("Start it with:");
  console.error('  cd "/Users/isaiahdupree/Documents/Software/Safari Automation"');
  console.error("  PORT=3105 npx tsx packages/linkedin-automation/src/api/server.ts &");
  console.error("\nAttempting to continue anyway...");
}

// Validate required env vars
const missing: string[] = [];
if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
if (!SKIP_SYNC && !process.env.SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
if (missing.length) {
  console.error(`\n❌ Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

if (DRY_RUN) console.log("\n⚠️  DRY RUN — Supabase sync will be skipped");

// ─── STEP 2: Read prospects ───────────────────────────────────────────────────
const step2 = run("STEP 2: Read prospect conversations", "read-prospects.ts");
if (!step2) process.exit(1);

// ─── STEP 3: Score with Claude Haiku ─────────────────────────────────────────
const step3 = run("STEP 3: Score with Claude Haiku", "score-prospects.ts");
if (!step3) process.exit(1);

// ─── STEP 4: Generate reply suggestions ──────────────────────────────────────
run("STEP 4: Generate reply suggestions", "generate-replies.ts");

// ─── STEP 5: Sync to Supabase ────────────────────────────────────────────────
if (!SKIP_SYNC) {
  const step5 = run("STEP 5: Sync to Supabase CRM", "sync-to-supabase.ts");
  if (!step5) {
    console.error("\n⚠️  Supabase sync failed. Prospects scored but not persisted to CRM.");
    process.exit(1);
  }
} else {
  console.log("\n⏩ Skipping Supabase sync (--skip-sync or --dry-run)");
}

console.log("\n" + "=".repeat(60));
console.log("🎉 LinkedIn DM Intelligence pipeline complete!");
console.log("=".repeat(60));
console.log("\nNext steps:");
console.log("  - Review HOT/WARM leads: cat /tmp/reply-suggestions.json");
console.log("  - Verify CRM sync: psql -f scripts/linkedin-intelligence/verify-sync.sql");
console.log("  - Approve queued messages in CRM dashboard");
