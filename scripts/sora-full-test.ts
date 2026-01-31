/**
 * Sora Full Automation Test
 * 
 * Runs the complete 2-step process:
 * 1. Submit prompt with @isaiahdupree
 * 2. Poll drafts until ready, then download
 * 
 * Run with: npx tsx scripts/sora-full-test.ts
 */

import { SoraFullAutomation } from '../packages/services/src/sora/sora-full-automation';

const MARS_PROMPT = 'An astronaut standing on the surface of Mars, looking back at Earth in the distant sky, with red dust swirling around their boots and a dome colony visible in the background';

async function runFullTest() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   SORA FULL AUTOMATION TEST            ║');
  console.log('╚════════════════════════════════════════╝\n');

  const sora = new SoraFullAutomation({
    pollIntervalMs: 15000,  // 15 seconds between polls
    maxPollAttempts: 40,    // Max 10 minutes
  });

  console.log('Config:', sora.getConfig());
  console.log('\nPrompt:', MARS_PROMPT);
  console.log('\n---\n');

  // Run full automation
  const result = await sora.fullRun(MARS_PROMPT);

  // Print results
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   RESULTS                              ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('STEP 1 - SUBMIT:');
  console.log(`  Success: ${result.submit.success ? '✅' : '❌'}`);
  console.log(`  Has @isaiahdupree prefix: ${result.submit.hasPrefix ? '✅' : '❌'}`);
  console.log(`  Create clicked: ${result.submit.createClicked ? '✅' : '❌'}`);
  if (result.submit.error) console.log(`  Error: ${result.submit.error}`);

  if (result.poll) {
    console.log('\nSTEP 2 - POLL:');
    console.log(`  Success: ${result.poll.success ? '✅' : '❌'}`);
    console.log(`  Poll count: ${result.poll.pollCount}`);
    console.log(`  Video ready: ${result.poll.isReady ? '✅' : '❌'}`);
    if (result.poll.draftHref) console.log(`  Draft: ${result.poll.draftHref}`);
    if (result.poll.error) console.log(`  Error: ${result.poll.error}`);
  }

  if (result.download) {
    console.log('\nSTEP 3 - DOWNLOAD:');
    console.log(`  Success: ${result.download.success ? '✅' : '❌'}`);
    if (result.download.filePath) console.log(`  File: ${result.download.filePath}`);
    if (result.download.fileSize) console.log(`  Size: ${Math.round(result.download.fileSize / 1024)}KB`);
    if (result.download.error) console.log(`  Error: ${result.download.error}`);
  }

  console.log(`\nTotal time: ${Math.round(result.totalTimeMs / 1000)}s`);

  // Final status
  const allSuccess = result.submit.success && result.poll?.success && result.download?.success;
  console.log('\n' + (allSuccess ? '🎉 FULL RUN SUCCESSFUL!' : '⚠️ RUN INCOMPLETE'));
}

runFullTest().catch(console.error);
