/**
 * Input Mars Prompt with @isaiahdupree Character
 * 
 * Run with: npx tsx scripts/input-mars-prompt.ts
 */

import { SafariExecutor } from '../packages/services/src/safari/safari-executor';
import { SORA_SELECTORS, JS_SET_TEXTAREA_VALUE } from '../packages/services/src/sora/sora-selectors';

const safari = new SafariExecutor({ timeout: 30000 });

const MARS_PROMPT = `@isaiahdupree The epic journey of humanity's first mission to Mars, showing astronauts preparing for launch, the spacecraft traveling through space, and the historic first steps on the red planet`;

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function inputMarsPrompt(): Promise<void> {
  console.log('=== Input Mars Prompt Test ===\n');
  console.log(`Character: ${SORA_SELECTORS.CHARACTER_PREFIX}`);
  console.log(`Prompt: "${MARS_PROMPT.slice(0, 60)}..."\n`);

  // Step 1: Navigate to Sora
  console.log('Step 1: Navigating to Sora...');
  const navResult = await safari.navigateWithVerification(
    SORA_SELECTORS.BASE_URL,
    'sora.chatgpt.com',
    3
  );

  if (!navResult.success) {
    console.error('❌ FAILED to navigate:', navResult.error);
    return;
  }
  console.log('✅ Navigated to:', navResult.url);

  await wait(3000);

  // Step 2: Find and focus the textarea
  console.log('\nStep 2: Finding prompt textarea...');
  const focusResult = await safari.executeJS(`
    (function() {
      const textarea = document.querySelector('textarea');
      if (!textarea) return JSON.stringify({ found: false });
      textarea.focus();
      textarea.click();
      return JSON.stringify({ found: true, placeholder: textarea.placeholder });
    })();
  `);

  if (focusResult.success && focusResult.result) {
    const parsed = JSON.parse(focusResult.result);
    if (parsed.found) {
      console.log('✅ Found textarea, placeholder:', parsed.placeholder);
    } else {
      console.error('❌ Textarea not found');
      return;
    }
  }

  await wait(500);

  // Step 3: Set the prompt value
  console.log('\nStep 3: Entering Mars prompt with @isaiahdupree...');
  const setResult = await safari.executeJS(JS_SET_TEXTAREA_VALUE(MARS_PROMPT));

  if (setResult.success && setResult.result) {
    const parsed = JSON.parse(setResult.result);
    if (parsed.success) {
      console.log('✅ Prompt entered successfully');
      console.log(`   Value: "${parsed.value.slice(0, 70)}..."`);
      console.log(`   Starts with @isaiahdupree: ${parsed.startsWithPrefix}`);
    } else {
      console.error('❌ Failed to set value:', parsed.error);
      return;
    }
  }

  await wait(500);

  // Step 4: Verify the prompt
  console.log('\nStep 4: Verifying prompt...');
  const verifyResult = await safari.executeJS(`
    (function() {
      const textarea = document.querySelector('textarea');
      if (!textarea) return JSON.stringify({ verified: false, error: 'Textarea not found' });
      
      const value = textarea.value;
      const startsWithChar = value.startsWith('@isaiahdupree');
      const containsMars = value.toLowerCase().includes('mars');
      const containsAstronauts = value.toLowerCase().includes('astronauts');
      
      return JSON.stringify({
        verified: startsWithChar && containsMars,
        value: value,
        checks: {
          startsWithCharacter: startsWithChar,
          containsMars: containsMars,
          containsAstronauts: containsAstronauts,
          length: value.length
        }
      });
    })();
  `);

  if (verifyResult.success && verifyResult.result) {
    const parsed = JSON.parse(verifyResult.result);
    console.log('\n=== VERIFICATION RESULTS ===');
    console.log(`Starts with @isaiahdupree: ${parsed.checks.startsWithCharacter ? '✅' : '❌'}`);
    console.log(`Contains "Mars": ${parsed.checks.containsMars ? '✅' : '❌'}`);
    console.log(`Contains "astronauts": ${parsed.checks.containsAstronauts ? '✅' : '❌'}`);
    console.log(`Prompt length: ${parsed.checks.length} characters`);
    
    if (parsed.verified) {
      console.log('\n✅ SUCCESS - Mars prompt with @isaiahdupree entered correctly!');
    } else {
      console.log('\n❌ FAILED - Verification did not pass');
    }
  }

  // Take screenshot as proof
  const screenshotPath = '/Users/isaiahdupree/Downloads/sora-mars-prompt.png';
  await safari.takeScreenshot(screenshotPath);
  console.log(`\nScreenshot saved: ${screenshotPath}`);
}

// Run
inputMarsPrompt().catch(console.error);
