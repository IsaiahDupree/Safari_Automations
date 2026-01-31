/**
 * Sora Selector Discovery Script
 * 
 * Navigates to sora.com and discovers all interactive elements
 * for prompt input, settings, and controls.
 * 
 * Run with: npx tsx scripts/discover-sora-selectors.ts
 */

import { SafariExecutor } from '../packages/services/src/safari/safari-executor';
import * as fs from 'fs';

const safari = new SafariExecutor({ timeout: 30000 });

interface DiscoveredElement {
  selector: string;
  tagName: string;
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  dataTestId?: string;
  className?: string;
  id?: string;
  role?: string;
  textContent?: string;
  isVisible: boolean;
  rect?: { x: number; y: number; width: number; height: number };
}

interface DiscoveryResult {
  url: string;
  timestamp: string;
  promptInputs: DiscoveredElement[];
  buttons: DiscoveredElement[];
  selects: DiscoveredElement[];
  sliders: DiscoveredElement[];
  radioButtons: DiscoveredElement[];
  checkboxes: DiscoveredElement[];
  textAreas: DiscoveredElement[];
  contentEditables: DiscoveredElement[];
  allInteractive: DiscoveredElement[];
}

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function discoverSelectors(): Promise<void> {
  console.log('=== Sora Selector Discovery ===\n');

  // Step 1: Navigate to Sora
  console.log('Step 1: Navigating to sora.chatgpt.com...');
  const navResult = await safari.navigateWithVerification('https://sora.chatgpt.com', 'sora.chatgpt.com', 3);
  
  if (!navResult.success) {
    console.error('Failed to navigate to sora.com:', navResult.error);
    return;
  }
  
  console.log('Successfully navigated to:', navResult.url);
  await wait(5000); // Wait for page to fully load

  // Step 2: Discover all interactive elements
  console.log('\nStep 2: Discovering interactive elements...\n');

  const discoveryJS = `
(function() {
  const result = {
    url: window.location.href,
    timestamp: new Date().toISOString(),
    promptInputs: [],
    buttons: [],
    selects: [],
    sliders: [],
    radioButtons: [],
    checkboxes: [],
    textAreas: [],
    contentEditables: [],
    allInteractive: []
  };

  function getElementInfo(el) {
    const rect = el.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(el);
    const isVisible = rect.width > 0 && rect.height > 0 && 
                      computedStyle.display !== 'none' && 
                      computedStyle.visibility !== 'hidden';
    
    return {
      tagName: el.tagName.toLowerCase(),
      type: el.type || null,
      placeholder: el.placeholder || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      dataTestId: el.getAttribute('data-testid') || null,
      className: el.className || null,
      id: el.id || null,
      role: el.getAttribute('role') || null,
      name: el.name || null,
      textContent: (el.textContent || '').trim().slice(0, 100),
      isVisible,
      rect: isVisible ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
    };
  }

  function generateSelector(el) {
    if (el.id) return '#' + el.id;
    if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
    if (el.getAttribute('aria-label')) return '[aria-label="' + el.getAttribute('aria-label') + '"]';
    if (el.name) return '[name="' + el.name + '"]';
    if (el.placeholder) return '[placeholder="' + el.placeholder + '"]';
    
    let selector = el.tagName.toLowerCase();
    if (el.type) selector += '[type="' + el.type + '"]';
    if (el.className && typeof el.className === 'string') {
      const firstClass = el.className.split(' ')[0];
      if (firstClass && !firstClass.includes('_')) {
        selector += '.' + firstClass;
      }
    }
    return selector;
  }

  // Find textareas (likely prompt input)
  document.querySelectorAll('textarea').forEach(el => {
    const info = getElementInfo(el);
    info.selector = generateSelector(el);
    result.textAreas.push(info);
    if (info.isVisible) result.promptInputs.push(info);
  });

  // Find contenteditable elements
  document.querySelectorAll('[contenteditable="true"]').forEach(el => {
    const info = getElementInfo(el);
    info.selector = generateSelector(el);
    result.contentEditables.push(info);
    if (info.isVisible) result.promptInputs.push(info);
  });

  // Find inputs
  document.querySelectorAll('input').forEach(el => {
    const info = getElementInfo(el);
    info.selector = generateSelector(el);
    
    if (el.type === 'range') {
      result.sliders.push(info);
    } else if (el.type === 'radio') {
      result.radioButtons.push(info);
    } else if (el.type === 'checkbox') {
      result.checkboxes.push(info);
    } else if (el.type === 'text' || el.type === 'search') {
      if (info.isVisible) result.promptInputs.push(info);
    }
    
    result.allInteractive.push(info);
  });

  // Find buttons
  document.querySelectorAll('button, [role="button"]').forEach(el => {
    const info = getElementInfo(el);
    info.selector = generateSelector(el);
    result.buttons.push(info);
    result.allInteractive.push(info);
  });

  // Find selects/dropdowns
  document.querySelectorAll('select, [role="listbox"], [role="combobox"]').forEach(el => {
    const info = getElementInfo(el);
    info.selector = generateSelector(el);
    result.selects.push(info);
    result.allInteractive.push(info);
  });

  // Find clickable elements with specific text
  const interestingTexts = ['create', 'generate', 'aspect', 'ratio', 'duration', 'style', 'character', 'submit', '16:9', '9:16', '1:1', '5s', '10s', '15s', '20s'];
  
  document.querySelectorAll('*').forEach(el => {
    const text = (el.textContent || '').toLowerCase();
    if (interestingTexts.some(t => text.includes(t))) {
      if (el.onclick || el.getAttribute('role') === 'button' || 
          window.getComputedStyle(el).cursor === 'pointer') {
        const info = getElementInfo(el);
        info.selector = generateSelector(el);
        info.matchedText = text.slice(0, 50);
        if (!result.allInteractive.find(i => i.selector === info.selector)) {
          result.allInteractive.push(info);
        }
      }
    }
  });

  return JSON.stringify(result, null, 2);
})();
`;

  const jsResult = await safari.executeJS(discoveryJS);
  
  if (!jsResult.success) {
    console.error('Failed to execute discovery script:', jsResult.error);
    return;
  }

  let discovery: DiscoveryResult;
  try {
    discovery = JSON.parse(jsResult.result || '{}');
  } catch (e) {
    console.error('Failed to parse discovery result');
    console.log('Raw result:', jsResult.result);
    return;
  }

  // Print results
  console.log('=== DISCOVERY RESULTS ===\n');
  console.log(`URL: ${discovery.url}`);
  console.log(`Timestamp: ${discovery.timestamp}\n`);

  console.log('--- PROMPT INPUTS ---');
  if (discovery.promptInputs.length === 0) {
    console.log('  No prompt inputs found');
  } else {
    discovery.promptInputs.forEach((el, i) => {
      console.log(`  [${i + 1}] ${el.selector}`);
      console.log(`      Tag: ${el.tagName}, Placeholder: ${el.placeholder || 'none'}`);
      console.log(`      Aria-label: ${el.ariaLabel || 'none'}`);
      console.log(`      Data-testid: ${el.dataTestId || 'none'}`);
      console.log(`      Visible: ${el.isVisible}`);
      console.log('');
    });
  }

  console.log('--- BUTTONS ---');
  const visibleButtons = discovery.buttons.filter(b => b.isVisible);
  if (visibleButtons.length === 0) {
    console.log('  No visible buttons found');
  } else {
    visibleButtons.forEach((el, i) => {
      console.log(`  [${i + 1}] ${el.selector}`);
      console.log(`      Text: "${el.textContent?.slice(0, 50) || 'none'}"`);
      console.log(`      Aria-label: ${el.ariaLabel || 'none'}`);
      console.log(`      Data-testid: ${el.dataTestId || 'none'}`);
      console.log('');
    });
  }

  console.log('--- SELECTS/DROPDOWNS ---');
  if (discovery.selects.length === 0) {
    console.log('  No selects found');
  } else {
    discovery.selects.forEach((el, i) => {
      console.log(`  [${i + 1}] ${el.selector}`);
      console.log(`      Tag: ${el.tagName}, Role: ${el.role || 'none'}`);
      console.log(`      Aria-label: ${el.ariaLabel || 'none'}`);
      console.log('');
    });
  }

  console.log('--- SLIDERS ---');
  if (discovery.sliders.length === 0) {
    console.log('  No sliders found');
  } else {
    discovery.sliders.forEach((el, i) => {
      console.log(`  [${i + 1}] ${el.selector}`);
      console.log(`      Aria-label: ${el.ariaLabel || 'none'}`);
      console.log('');
    });
  }

  console.log('--- RADIO BUTTONS ---');
  if (discovery.radioButtons.length === 0) {
    console.log('  No radio buttons found');
  } else {
    discovery.radioButtons.forEach((el, i) => {
      console.log(`  [${i + 1}] ${el.selector}`);
      console.log(`      Name: ${(el as any).name || 'none'}, Aria-label: ${el.ariaLabel || 'none'}`);
      console.log('');
    });
  }

  console.log('--- CHECKBOXES ---');
  if (discovery.checkboxes.length === 0) {
    console.log('  No checkboxes found');
  } else {
    discovery.checkboxes.forEach((el, i) => {
      console.log(`  [${i + 1}] ${el.selector}`);
      console.log(`      Aria-label: ${el.ariaLabel || 'none'}`);
      console.log('');
    });
  }

  console.log('--- ALL TEXTAREAS ---');
  discovery.textAreas.forEach((el, i) => {
    console.log(`  [${i + 1}] ${el.selector}`);
    console.log(`      Placeholder: ${el.placeholder || 'none'}`);
    console.log(`      Visible: ${el.isVisible}`);
    console.log('');
  });

  console.log('--- CONTENT EDITABLES ---');
  discovery.contentEditables.forEach((el, i) => {
    console.log(`  [${i + 1}] ${el.selector}`);
    console.log(`      Visible: ${el.isVisible}`);
    console.log('');
  });

  // Save full results to file
  const outputPath = '/Users/isaiahdupree/Documents/Software/Safari Automation/docs/sora-selectors-discovery.json';
  fs.writeFileSync(outputPath, JSON.stringify(discovery, null, 2));
  console.log(`\nFull results saved to: ${outputPath}`);

  // Take screenshot
  const screenshotPath = '/Users/isaiahdupree/Documents/Software/Safari Automation/docs/sora-page-screenshot.png';
  await safari.takeScreenshot(screenshotPath);
  console.log(`Screenshot saved to: ${screenshotPath}`);
}

// Run discovery
discoverSelectors().catch(console.error);
