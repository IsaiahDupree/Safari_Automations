import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const target of [
  "packages/upwork-automation/src/index.ts",
  "packages/upwork-automation/src/automation/safari-driver.ts",
  "packages/upwork-automation/src/api/server.ts",
  "packages/upwork-automation/src/api/mcp-server.ts",
  "packages/upwork-hunter/src/api/server.ts",
  "packages/upwork-hunter/src/api/job-scraper.ts",
  "packages/upwork-hunter/src/api/telegram-gate.ts",
  "packages/upwork-hunter/src/lib/supabase.ts",
]) {
  test(`legacy entry point rejects before provider access: ${target}`, () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "-e",
      `import(${JSON.stringify("./" + target)}).then(() => process.exit(8)).catch(e => { process.stderr.write(e.message); process.exit(9) })`], {
      encoding: "utf8", timeout: 10000,
      env: { PATH: process.env.PATH, ENABLE_UPWORK_AUTOMATION: "true", UPWORK_PORT: "3107" },
    });
    assert.equal(result.status, 9);
    assert.match(result.stderr, /Legacy Upwork automation is retired/);
  });
}
test("watchdog never restarts the retired Upwork browser service", () => {
  const source = readFileSync("watchdog-safari.sh", "utf8");
  assert.doesNotMatch(source, /SERVICES\[3107\]|packages\/upwork-/);
  assert.match(source, /SERVICES\[3108\]=.*medium-automation/);
});
