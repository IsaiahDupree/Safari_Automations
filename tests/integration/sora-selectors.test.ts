/**
 * Sora Selectors Integration Test
 * 
 * Tests verified selectors against real Safari/Sora.
 * NO MOCKS - All interactions happen with actual browser.
 * 
 * Prerequisites:
 * - Safari must be running
 * - Must be logged into sora.chatgpt.com
 * 
 * Run with: npx tsx tests/integration/sora-selectors.test.ts
 */

import { SafariExecutor } from '../../packages/services/src/safari/safari-executor';
import {
  SORA_SELECTORS,
  JS_SET_TEXTAREA_VALUE,
  JS_CLICK_BUTTON_BY_TEXT,
  JS_SELECT_DURATION,
  JS_GET_VIDEO_STATUS,
  JS_GET_DRAFTS_INFO,
} from '../../packages/services/src/sora/sora-selectors';

const safari = new SafariExecutor({ timeout: 30000 });

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests(): Promise<void> {
  console.log('=== Sora Selectors Integration Test ===\n');
  console.log(`Base URL: ${SORA_SELECTORS.BASE_URL}`);
  console.log(`Character Prefix: ${SORA_SELECTORS.CHARACTER_PREFIX}\n`);

  const results: { test: string; passed: boolean; details?: string }[] = [];

  // =========================================================================
  // TEST 1: Navigate to Sora
  // =========================================================================
  console.log('TEST 1: Navigate to sora.chatgpt.com');
  try {
    const navResult = await safari.navigateWithVerification(
      SORA_SELECTORS.BASE_URL,
      'sora.chatgpt.com',
      3
    );
    
    if (navResult.success) {
      console.log('  ✅ PASSED - Navigated to:', navResult.url);
      results.push({ test: 'Navigate to Sora', passed: true });
    } else {
      console.log('  ❌ FAILED -', navResult.error);
      results.push({ test: 'Navigate to Sora', passed: false, details: navResult.error });
    }
  } catch (e) {
    console.log('  ❌ FAILED -', e);
    results.push({ test: 'Navigate to Sora', passed: false, details: String(e) });
  }

  await wait(3000);

  // =========================================================================
  // TEST 2: Find Prompt Textarea
  // =========================================================================
  console.log('\nTEST 2: Find prompt textarea');
  try {
    const findResult = await safari.executeJS(`
      (function() {
        const textarea = document.querySelector('${SORA_SELECTORS.PROMPT_INPUT}');
        if (!textarea) return JSON.stringify({ found: false });
        return JSON.stringify({
          found: true,
          tagName: textarea.tagName,
          placeholder: textarea.placeholder || 'none'
        });
      })();
    `);

    if (findResult.success && findResult.result) {
      const parsed = JSON.parse(findResult.result);
      if (parsed.found) {
        console.log('  ✅ PASSED - Found textarea');
        console.log(`     Placeholder: "${parsed.placeholder}"`);
        results.push({ test: 'Find prompt textarea', passed: true });
      } else {
        console.log('  ❌ FAILED - Textarea not found');
        results.push({ test: 'Find prompt textarea', passed: false });
      }
    }
  } catch (e) {
    console.log('  ❌ FAILED -', e);
    results.push({ test: 'Find prompt textarea', passed: false, details: String(e) });
  }

  // =========================================================================
  // TEST 3: Set Textarea Value with @isaiahdupree prefix
  // =========================================================================
  console.log('\nTEST 3: Set textarea value with @isaiahdupree prefix');
  const testPrompt = '@isaiahdupree A test prompt for Mars exploration';
  try {
    const setResult = await safari.executeJS(JS_SET_TEXTAREA_VALUE(testPrompt));

    if (setResult.success && setResult.result) {
      const parsed = JSON.parse(setResult.result);
      if (parsed.success && parsed.startsWithPrefix) {
        console.log('  ✅ PASSED - Value set with prefix');
        console.log(`     Value: "${parsed.value.slice(0, 50)}..."`);
        console.log(`     Starts with @isaiahdupree: ${parsed.startsWithPrefix}`);
        results.push({ test: 'Set textarea with prefix', passed: true });
      } else {
        console.log('  ❌ FAILED - Prefix not at start');
        console.log(`     Value: "${parsed.value}"`);
        results.push({ test: 'Set textarea with prefix', passed: false });
      }
    }
  } catch (e) {
    console.log('  ❌ FAILED -', e);
    results.push({ test: 'Set textarea with prefix', passed: false, details: String(e) });
  }

  // =========================================================================
  // TEST 4: Find Settings Button
  // =========================================================================
  console.log('\nTEST 4: Find settings button');
  try {
    const findResult = await safari.executeJS(`
      (function() {
        const btn = document.querySelector('${SORA_SELECTORS.SETTINGS_BUTTON}');
        if (!btn) return JSON.stringify({ found: false });
        return JSON.stringify({
          found: true,
          ariaLabel: btn.getAttribute('aria-label'),
          text: btn.textContent?.trim().slice(0, 30)
        });
      })();
    `);

    if (findResult.success && findResult.result) {
      const parsed = JSON.parse(findResult.result);
      if (parsed.found) {
        console.log('  ✅ PASSED - Found settings button');
        console.log(`     Aria-label: "${parsed.ariaLabel}"`);
        results.push({ test: 'Find settings button', passed: true });
      } else {
        console.log('  ❌ FAILED - Settings button not found');
        results.push({ test: 'Find settings button', passed: false });
      }
    }
  } catch (e) {
    console.log('  ❌ FAILED -', e);
    results.push({ test: 'Find settings button', passed: false, details: String(e) });
  }

  // =========================================================================
  // TEST 5: Find Create Video Button
  // =========================================================================
  console.log('\nTEST 5: Find "Create video" button');
  try {
    const findResult = await safari.executeJS(`
      (function() {
        const buttons = document.querySelectorAll('button');
        const btn = Array.from(buttons).find(b => 
          b.textContent.includes('${SORA_SELECTORS.CREATE_BUTTON_TEXT}')
        );
        if (!btn) return JSON.stringify({ found: false, buttonCount: buttons.length });
        return JSON.stringify({
          found: true,
          text: btn.textContent.trim()
        });
      })();
    `);

    if (findResult.success && findResult.result) {
      const parsed = JSON.parse(findResult.result);
      if (parsed.found) {
        console.log('  ✅ PASSED - Found create button');
        console.log(`     Text: "${parsed.text}"`);
        results.push({ test: 'Find create button', passed: true });
      } else {
        console.log('  ❌ FAILED - Create button not found');
        console.log(`     Total buttons on page: ${parsed.buttonCount}`);
        results.push({ test: 'Find create button', passed: false });
      }
    }
  } catch (e) {
    console.log('  ❌ FAILED -', e);
    results.push({ test: 'Find create button', passed: false, details: String(e) });
  }

  // =========================================================================
  // TEST 6: Navigate to Library and Check Drafts
  // =========================================================================
  console.log('\nTEST 6: Navigate to library and check drafts');
  try {
    const navResult = await safari.navigateWithVerification(
      SORA_SELECTORS.LIBRARY_URL,
      'sora.chatgpt.com',
      3
    );

    if (!navResult.success) {
      console.log('  ❌ FAILED - Could not navigate to library');
      results.push({ test: 'Navigate to library', passed: false });
    } else {
      await wait(3000);

      const draftsResult = await safari.executeJS(JS_GET_DRAFTS_INFO);
      
      if (draftsResult.success && draftsResult.result) {
        const parsed = JSON.parse(draftsResult.result);
        console.log('  ✅ PASSED - Library page loaded');
        console.log(`     Total drafts: ${parsed.totalDrafts}`);
        console.log(`     Ready videos: ${parsed.readyCount}`);
        results.push({ test: 'Navigate to library', passed: true });
      }
    }
  } catch (e) {
    console.log('  ❌ FAILED -', e);
    results.push({ test: 'Navigate to library', passed: false, details: String(e) });
  }

  // =========================================================================
  // TEST 7: Get Video Status
  // =========================================================================
  console.log('\nTEST 7: Get video status from page');
  try {
    const statusResult = await safari.executeJS(JS_GET_VIDEO_STATUS);

    if (statusResult.success && statusResult.result) {
      const parsed = JSON.parse(statusResult.result);
      console.log('  ✅ PASSED - Got video status');
      console.log(`     Video count: ${parsed.videoCount}`);
      console.log(`     Has ready video: ${parsed.hasReadyVideo}`);
      console.log(`     Has progress indicator: ${parsed.hasProgress}`);
      results.push({ test: 'Get video status', passed: true });
    }
  } catch (e) {
    console.log('  ❌ FAILED -', e);
    results.push({ test: 'Get video status', passed: false, details: String(e) });
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n=== TEST SUMMARY ===\n');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  results.forEach(r => {
    console.log(`${r.passed ? '✅' : '❌'} ${r.test}`);
    if (r.details) console.log(`   └─ ${r.details}`);
  });

  console.log(`\nTotal: ${passed} passed, ${failed} failed out of ${results.length} tests`);
  console.log(`Pass rate: ${Math.round((passed / results.length) * 100)}%`);

  // Take screenshot
  const screenshotPath = '/Users/isaiahdupree/Downloads/sora-test-screenshot.png';
  await safari.takeScreenshot(screenshotPath);
  console.log(`\nScreenshot saved: ${screenshotPath}`);
}

// Run tests
runTests().catch(console.error);
