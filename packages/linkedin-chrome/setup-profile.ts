#!/usr/bin/env npx tsx
/**
 * setup-profile.ts — Chrome profile picker for linkedin-chrome MCP
 *
 * Usage:
 *   npx tsx setup-profile.ts          # interactive: pick profile to copy
 *   npx tsx setup-profile.ts --list   # list profiles only
 *   npx tsx setup-profile.ts --cdp    # print CDP launch instructions
 */
import { existsSync, readFileSync, cpSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import * as readline from 'readline';

const CHROME_DIR = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
const DEST_DIR   = join(homedir(), '.linkedin-chrome-profile');
const G = '\x1b[32m', R = '\x1b[31m', C = '\x1b[36m', B = '\x1b[1m', D = '\x1b[2m', X = '\x1b[0m';

interface Profile { id: string; name: string; email: string; hasLinkedIn: boolean; dir: string; }

function listProfiles(): Profile[] {
  const lsPath = join(CHROME_DIR, 'Local State');
  if (!existsSync(lsPath)) {
    console.error(`${R}Chrome not found at: ${CHROME_DIR}${X}`);
    process.exit(1);
  }
  const ls = JSON.parse(readFileSync(lsPath, 'utf8')) as {
    profile?: { info_cache?: Record<string, Record<string, unknown>> };
  };
  const cache = ls?.profile?.info_cache ?? {};
  const results: Profile[] = [];
  for (const [id, info] of Object.entries(cache)) {
    const dir = join(CHROME_DIR, id);
    if (!existsSync(dir)) continue;
    const cookiesPath = join(dir, 'Cookies');
    let hasLinkedIn = false;
    if (existsSync(cookiesPath)) {
      try {
        const buf = readFileSync(cookiesPath);
        hasLinkedIn = buf.includes('linkedin.com') && buf.includes('li_at');
      } catch {
        hasLinkedIn = true; // locked by running Chrome — assume possibly signed in
      }
    }
    results.push({
      id,
      name:  String(info['name'] ?? id),
      email: String(info['user_name'] ?? ''),
      hasLinkedIn,
      dir,
    });
  }
  return results;
}

function printProfiles(profiles: Profile[]) {
  console.log(`\n${B}${C}Chrome Profiles on this Mac:${X}\n`);
  profiles.forEach((p, i) => {
    const li = p.hasLinkedIn ? `${G}● LinkedIn detected${X}` : `${D}○ not detected${X}`;
    console.log(`  ${B}[${i + 1}]${X} ${p.name.padEnd(26)} ${D}${p.email.padEnd(30)}${X}  ${li}`);
    console.log(`       ${D}profile id: ${p.id}${X}`);
  });
  console.log();
}

async function copyProfile(profile: Profile) {
  const dest = join(DEST_DIR, 'Default');
  console.log(`\nCopying "${profile.name}" (${profile.id}) → ${dest}`);
  console.log(`${D}Tip: close Chrome first to avoid a locked Cookies file${X}\n`);
  mkdirSync(dest, { recursive: true });

  const items = ['Cookies', 'Preferences', 'Local Storage', 'Session Storage', 'IndexedDB', 'Web Data'];
  let ok = 0;
  for (const item of items) {
    const src = join(profile.dir, item);
    if (!existsSync(src)) { console.log(`  ${D}skip  ${item}${X}`); continue; }
    try {
      cpSync(src, join(dest, item), { recursive: true, force: true });
      console.log(`  ${G}✓${X}     ${item}`);
      ok++;
    } catch (e) {
      console.log(`  ${R}✗${X}     ${item}: ${(e as Error).message}`);
    }
  }

  console.log(`\n${G}${B}Done — ${ok}/${items.length} items copied.${X}`);
  console.log(`\nThe MCP server (~/.linkedin-chrome-profile) now has your LinkedIn session.`);
  console.log(`\nAlternatives (no copy needed):`);
  console.log(`  ${B}Direct profile${X} — Chrome must be closed first:`);
  console.log(`  ${C}CHROME_USER_DATA_DIR="${CHROME_DIR}" CHROME_PROFILE="${profile.id}"${X}`);
  console.log(`\n  ${B}CDP mode${X} — connect to a running Chrome:`);
  console.log(`  ${C}CHROME_CDP_URL=http://localhost:9222${X}`);
  console.log(`  Run: npx tsx setup-profile.ts --cdp  for full CDP instructions\n`);
}

function printCdpHelp(profiles: Profile[]) {
  const defaultPick = profiles.find(p => p.hasLinkedIn) ?? profiles[0];
  const profileArg  = defaultPick ? `--profile-directory="${defaultPick.id}"` : '--profile-directory="Default"';

  console.log(`\n${B}${C}CDP Connection Mode${X}`);
  console.log(`Connect the MCP server to your already-signed-in Chrome window.\n`);
  console.log(`${B}Step 1${X}  Quit Chrome, then re-launch with remote debugging:`);
  console.log(`  ${C}"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\`);
  console.log(`    --remote-debugging-port=9222 \\`);
  console.log(`    ${profileArg}${X}\n`);
  console.log(`${B}Step 2${X}  Set the env var when running the MCP server:`);
  console.log(`  ${C}CHROME_CDP_URL=http://localhost:9222 npx tsx src/api/mcp-server.ts${X}\n`);
  console.log(`${B}Step 3${X}  Add to claude_desktop_config.json → mcpServers → linkedin-chrome → env:`);
  console.log(`  ${C}"CHROME_CDP_URL": "http://localhost:9222"${X}\n`);
  if (defaultPick) {
    console.log(`${B}Recommended profile:${X} ${defaultPick.name} (${defaultPick.id})${defaultPick.hasLinkedIn ? ` ${G}— LinkedIn detected${X}` : ''}`);
  }
  console.log();
}

async function main() {
  const args = process.argv.slice(2);
  const profiles = listProfiles();

  if (profiles.length === 0) {
    console.error(`${R}No Chrome profiles found in ${CHROME_DIR}${X}`);
    process.exit(1);
  }

  printProfiles(profiles);

  if (args.includes('--list')) return;
  if (args.includes('--cdp')) { printCdpHelp(profiles); return; }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const pick = await new Promise<string>(res => rl.question(`Pick a profile to copy [1-${profiles.length}] (q = quit): `, res));
  rl.close();

  if (pick.toLowerCase() === 'q') return;
  const idx = parseInt(pick, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= profiles.length) {
    console.error(`${R}Invalid choice${X}`); process.exit(1);
  }

  await copyProfile(profiles[idx]);
}

main().catch(e => { console.error(e); process.exit(1); });
