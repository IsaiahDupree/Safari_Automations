/**
 * Sora Selectors
 * 
 * Verified working selectors for sora.chatgpt.com
 * Last verified: 2026-01-30
 */

export const SORA_SELECTORS = {
  // URLs
  BASE_URL: 'https://sora.chatgpt.com',
  DRAFTS_URL: 'https://sora.chatgpt.com/drafts',
  LIBRARY_URL: 'https://sora.chatgpt.com/library', // deprecated, use DRAFTS_URL
  
  // Prompt
  PROMPT_INPUT: 'textarea',
  
  // Settings
  SETTINGS_BUTTON: 'button[aria-label="Settings"]',
  
  // Menus (Radix UI)
  MENU_ITEM: '[role=menuitem]',
  MENU_ITEM_RADIO: '[role=menuitemradio]',
  RADIX_ITEM: '[data-radix-collection-item]',
  DIALOG: '[role=dialog]',
  
  // Actions
  CREATE_BUTTON_TEXT: 'Create video',
  
  // Video
  VIDEO: 'video',
  VIDEO_WITH_SRC: 'video[src]',
  PROGRESS: '[role="progressbar"]',
  PROGRESS_CLASS: '[class*="progress"]',
  
  // Character
  CHARACTER_PREFIX: '@isaiahdupree',
};

/**
 * JavaScript to set React textarea value properly
 */
export const JS_SET_TEXTAREA_VALUE = (value: string) => `
(function() {
  const textarea = document.querySelector('textarea');
  if (!textarea) return JSON.stringify({ success: false, error: 'Textarea not found' });
  
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  ).set;
  nativeInputValueSetter.call(textarea, ${JSON.stringify(value)});
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  
  return JSON.stringify({ 
    success: true, 
    value: textarea.value,
    startsWithPrefix: textarea.value.startsWith('${SORA_SELECTORS.CHARACTER_PREFIX}')
  });
})();
`;

/**
 * JavaScript to click Radix UI elements (requires full mouse event sequence)
 */
export const JS_CLICK_RADIX_ELEMENT = (selector: string) => `
(function() {
  const element = document.querySelector('${selector}');
  if (!element) return JSON.stringify({ success: false, error: 'Element not found' });
  
  const events = [
    new PointerEvent('pointerdown', { bubbles: true }),
    new MouseEvent('mousedown', { bubbles: true }),
    new PointerEvent('pointerup', { bubbles: true }),
    new MouseEvent('mouseup', { bubbles: true }),
    new MouseEvent('click', { bubbles: true })
  ];
  events.forEach(e => element.dispatchEvent(e));
  
  return JSON.stringify({ success: true, selector: '${selector}' });
})();
`;

/**
 * JavaScript to find and click button by text content
 */
export const JS_CLICK_BUTTON_BY_TEXT = (text: string) => `
(function() {
  const buttons = document.querySelectorAll('button');
  const btn = Array.from(buttons).find(b => b.textContent.includes('${text}'));
  
  if (!btn) return JSON.stringify({ success: false, error: 'Button not found: ${text}' });
  
  btn.click();
  return JSON.stringify({ success: true, text: btn.textContent.trim().slice(0, 50) });
})();
`;

/**
 * JavaScript to select duration option
 */
export const JS_SELECT_DURATION = (duration: string) => `
(function() {
  const options = document.querySelectorAll('[role=menuitemradio]');
  let found = null;
  
  options.forEach(opt => {
    if (opt.textContent.includes('${duration}')) {
      found = opt;
      const events = [
        new PointerEvent('pointerdown', { bubbles: true }),
        new MouseEvent('mousedown', { bubbles: true }),
        new PointerEvent('pointerup', { bubbles: true }),
        new MouseEvent('mouseup', { bubbles: true }),
        new MouseEvent('click', { bubbles: true })
      ];
      events.forEach(e => opt.dispatchEvent(e));
    }
  });
  
  if (!found) return JSON.stringify({ success: false, error: 'Duration not found: ${duration}' });
  return JSON.stringify({ success: true, duration: '${duration}' });
})();
`;

/**
 * JavaScript to select aspect ratio
 */
export const JS_SELECT_ASPECT_RATIO = (ratio: string) => `
(function() {
  const options = document.querySelectorAll('[data-radix-collection-item]');
  let found = null;
  
  options.forEach(opt => {
    if (opt.textContent.includes('${ratio}')) {
      found = opt;
      const events = [
        new PointerEvent('pointerdown', { bubbles: true }),
        new MouseEvent('mousedown', { bubbles: true }),
        new PointerEvent('pointerup', { bubbles: true }),
        new MouseEvent('mouseup', { bubbles: true }),
        new MouseEvent('click', { bubbles: true })
      ];
      events.forEach(e => opt.dispatchEvent(e));
    }
  });
  
  if (!found) return JSON.stringify({ success: false, error: 'Aspect ratio not found: ${ratio}' });
  return JSON.stringify({ success: true, ratio: '${ratio}' });
})();
`;

/**
 * JavaScript to get video status from library
 */
export const JS_GET_VIDEO_STATUS = `
(function() {
  const videos = document.querySelectorAll('video[src]');
  const progress = document.querySelector('[role="progressbar"]');
  const progressClass = document.querySelector('[class*="progress"]');
  
  return JSON.stringify({
    videoCount: videos.length,
    hasReadyVideo: videos.length > 0,
    hasProgress: !!(progress || progressClass),
    videos: Array.from(videos).map((v, i) => ({
      index: i,
      src: v.src,
      hasSource: !!v.src
    }))
  });
})();
`;

/**
 * JavaScript to scroll and load more drafts
 */
export const JS_LOAD_MORE_DRAFTS = `
(function() {
  const beforeCount = document.querySelectorAll('video').length;
  window.scrollTo(0, document.body.scrollHeight);
  return JSON.stringify({ scrolled: true, videoCountBefore: beforeCount });
})();
`;

/**
 * JavaScript to get all drafts info from library page
 */
export const JS_GET_DRAFTS_INFO = `
(function() {
  const drafts = [];
  const videoElements = document.querySelectorAll('video');
  
  videoElements.forEach((video, index) => {
    const parent = video.closest('a, div, article');
    const href = parent?.getAttribute('href') || '';
    
    drafts.push({
      id: 'draft_' + index + '_' + Date.now(),
      index,
      hasSrc: !!video.src,
      src: video.src || null,
      href,
      status: video.src ? 'ready' : 'unknown'
    });
  });
  
  return JSON.stringify({
    totalDrafts: drafts.length,
    readyCount: drafts.filter(d => d.hasSrc).length,
    drafts
  });
})();
`;
