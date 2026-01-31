/**
 * Sora Usage Test
 * 
 * Tests the getUsage() method to check video generations remaining.
 * 
 * Run with: npx tsx scripts/sora-usage-test.ts
 */

import { SoraFullAutomation } from '../packages/services/src/sora/sora-full-automation';

async function testUsage() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   SORA USAGE TEST                      ║');
  console.log('╚════════════════════════════════════════╝\n');

  const sora = new SoraFullAutomation();

  const usage = await sora.getUsage();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   RESULTS                              ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log(`Success: ${usage.success ? '✅' : '❌'}`);
  console.log(`Video gens left: ${usage.videoGensLeft}`);
  console.log(`Free: ${usage.freeCount}`);
  console.log(`Paid: ${usage.paidCount}`);
  console.log(`Next available: ${usage.nextAvailableDate || 'N/A'}`);
  
  if (usage.error) {
    console.log(`Error: ${usage.error}`);
  }

  // Check if we can generate
  if (usage.videoGensLeft !== null && usage.videoGensLeft > 0) {
    console.log(`\n✅ You can generate ${usage.videoGensLeft} more videos!`);
  } else if (usage.videoGensLeft === 0) {
    console.log(`\n⚠️ No generations left. More available on ${usage.nextAvailableDate}`);
  }
}

testUsage().catch(console.error);
