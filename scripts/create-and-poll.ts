/**
 * Create Video and Poll Drafts
 * 
 * Clicks "Create video" button and polls library for new video.
 * Run with: npx tsx scripts/create-and-poll.ts
 */

import { SafariExecutor } from '../packages/services/src/safari/safari-executor';
import { SORA_SELECTORS, JS_GET_DRAFTS_INFO } from '../packages/services/src/sora/sora-selectors';

const safari = new SafariExecutor({ timeout: 30000 });

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createAndPoll(): Promise<void> {
  console.log('=== Create Video and Poll Drafts ===\n');

  // Step 1: Click "Create video" button
  console.log('Step 1: Clicking "Create video" button...');
  
  const clickResult = await safari.executeJS(`
    (function() {
      const buttons = document.querySelectorAll('button');
      const createBtn = Array.from(buttons).find(b => 
        b.textContent.includes('Create video')
      );
      
      if (!createBtn) {
        return JSON.stringify({ 
          clicked: false, 
          error: 'Create video button not found',
          buttonCount: buttons.length,
          buttonTexts: Array.from(buttons).slice(0, 10).map(b => b.textContent?.trim().slice(0, 30))
        });
      }
      
      // Check if button is disabled
      if (createBtn.disabled) {
        return JSON.stringify({ clicked: false, error: 'Button is disabled' });
      }
      
      createBtn.click();
      return JSON.stringify({ clicked: true, text: createBtn.textContent.trim() });
    })();
  `);

  if (clickResult.success && clickResult.result) {
    const parsed = JSON.parse(clickResult.result);
    if (parsed.clicked) {
      console.log('✅ Clicked "Create video" button');
    } else {
      console.log('❌ Failed to click:', parsed.error);
      if (parsed.buttonTexts) {
        console.log('   Available buttons:', parsed.buttonTexts);
      }
      return;
    }
  } else {
    console.log('❌ JS execution failed:', clickResult.error);
    return;
  }

  // Wait for generation to start
  console.log('\nWaiting 5 seconds for generation to start...');
  await wait(5000);

  // Take screenshot after clicking
  await safari.takeScreenshot('/Users/isaiahdupree/Downloads/sora-after-create.png');
  console.log('Screenshot saved: /Users/isaiahdupree/Downloads/sora-after-create.png');

  // Step 2: Navigate to library and get initial draft count
  console.log('\nStep 2: Navigating to library...');
  
  const navResult = await safari.navigateWithVerification(
    SORA_SELECTORS.LIBRARY_URL,
    'sora.chatgpt.com',
    3
  );

  if (!navResult.success) {
    console.log('❌ Failed to navigate to library:', navResult.error);
    return;
  }

  await wait(3000);

  // Get initial draft count
  const initialResult = await safari.executeJS(JS_GET_DRAFTS_INFO);
  let initialCount = 0;
  
  if (initialResult.success && initialResult.result) {
    const parsed = JSON.parse(initialResult.result);
    initialCount = parsed.totalDrafts;
    console.log(`✅ Library loaded - Initial drafts: ${initialCount}`);
    console.log(`   Ready videos: ${parsed.readyCount}`);
  }

  // Step 3: Poll for new drafts
  console.log('\nStep 3: Polling for new video...');
  console.log('(Polling every 30 seconds, max 10 attempts)\n');

  const maxAttempts = 10;
  const pollInterval = 30000; // 30 seconds

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`Poll attempt ${attempt}/${maxAttempts}...`);
    
    // Refresh the page
    await safari.refresh();
    await wait(3000);

    const pollResult = await safari.executeJS(JS_GET_DRAFTS_INFO);
    
    if (pollResult.success && pollResult.result) {
      const parsed = JSON.parse(pollResult.result);
      const currentCount = parsed.totalDrafts;
      const readyCount = parsed.readyCount;
      
      console.log(`   Total drafts: ${currentCount}, Ready: ${readyCount}`);
      
      // Check if we have a new draft
      if (currentCount > initialCount) {
        console.log(`\n✅ NEW VIDEO DETECTED! (+${currentCount - initialCount})`);
        
        // Get the latest draft info
        if (parsed.drafts && parsed.drafts.length > 0) {
          const latest = parsed.drafts[0];
          console.log(`   Latest draft ID: ${latest.id}`);
          console.log(`   Status: ${latest.status}`);
          console.log(`   Has video src: ${latest.hasSrc}`);
          
          if (latest.hasSrc) {
            console.log(`\n🎉 VIDEO READY FOR DOWNLOAD!`);
            console.log(`   Video source available`);
            
            // Take final screenshot
            await safari.takeScreenshot('/Users/isaiahdupree/Downloads/sora-video-ready.png');
            console.log('Screenshot saved: /Users/isaiahdupree/Downloads/sora-video-ready.png');
            return;
          }
        }
      }
      
      // Check if any video is still generating (has progress)
      const progressCheck = await safari.executeJS(`
        (function() {
          const progress = document.querySelector('[role="progressbar"]');
          const progressClass = document.querySelector('[class*="progress"]');
          const generating = document.body.textContent.includes('Generating') || 
                            document.body.textContent.includes('Creating');
          return JSON.stringify({ 
            hasProgress: !!(progress || progressClass),
            isGenerating: generating
          });
        })();
      `);
      
      if (progressCheck.success && progressCheck.result) {
        const status = JSON.parse(progressCheck.result);
        if (status.hasProgress || status.isGenerating) {
          console.log('   ⏳ Video still generating...');
        }
      }
    }

    if (attempt < maxAttempts) {
      console.log(`   Waiting ${pollInterval / 1000} seconds before next poll...\n`);
      await wait(pollInterval);
    }
  }

  console.log('\n⚠️ Max poll attempts reached. Video may still be generating.');
  console.log('Check https://sora.chatgpt.com/library manually.');
  
  // Final screenshot
  await safari.takeScreenshot('/Users/isaiahdupree/Downloads/sora-final-state.png');
  console.log('Final screenshot saved: /Users/isaiahdupree/Downloads/sora-final-state.png');
}

// Run
createAndPoll().catch(console.error);
