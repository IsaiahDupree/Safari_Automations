/**
 * Adobe Firefly Safari Automation Driver
 * Automates https://firefly.adobe.com to generate AI images and content.
 *
 * Capabilities:
 *  - Text-to-image generation
 *  - Style / aspect-ratio selection
 *  - Extracting generated image URLs from the page
 *  - Downloading images to local disk
 *  - Uploading results to Supabase Storage for the ACTP pipeline
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

const execAsync = promisify(exec);

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type AspectRatio = 'square' | 'landscape' | 'portrait' | 'widescreen';
export type ContentType = 'photo' | 'art' | 'graphic';
export type StylePreset =
  | 'none'
  | 'cinematic'
  | 'vintage'
  | 'minimalist'
  | 'abstract'
  | 'neon'
  | 'watercolor'
  | 'sketch'
  | 'oil_painting'
  | 'digital_art';

export interface GenerateOptions {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: AspectRatio;
  contentType?: ContentType;
  style?: StylePreset;
  count?: number; // 1-4
}

export interface GeneratedImage {
  url: string;
  index: number;
  prompt: string;
  timestamp: string;
}

export interface FireflyStatus {
  isOnFirefly: boolean;
  isLoggedIn: boolean;
  currentUrl: string;
  page: string;
}

export interface FireflyConfig {
  timeout: number;
  generateWaitMs: number;
  maxGenerateWaitMs: number;
  downloadsDir: string;
}

export const DEFAULT_CONFIG: FireflyConfig = {
  timeout: 60000,
  generateWaitMs: 3000,
  maxGenerateWaitMs: 90000,
  downloadsDir: path.join(os.homedir(), 'Downloads', 'firefly-generated'),
};

// ──────────────────────────────────────────────
// Firefly URL constants
// ──────────────────────────────────────────────

const FIREFLY_BASE = 'https://firefly.adobe.com';
const FIREFLY_GENERATE_URL = `${FIREFLY_BASE}/inspire/image-generator`;

// Selectors (best-effort — Firefly is a React SPA; some may drift)
const SELECTORS = {
  PROMPT_INPUT: 'textarea[placeholder*="Describe"], textarea[aria-label*="prompt"], textarea[data-testid*="prompt"], .prompt-input textarea, textarea',
  GENERATE_BUTTON: 'button[data-testid*="generate"], button[aria-label*="Generate"], button.generate-button, button[type="submit"]',
  RESULT_IMAGE: '.result-image img, [data-testid*="result"] img, .output-panel img, .generated-image img, canvas',
  LOADING_INDICATOR: '[aria-label*="Loading"], .loading, [data-testid*="loading"]',
  STYLE_SELECTOR: '[data-testid*="style"], .style-selector button',
  ASPECT_RATIO_SELECTOR: '[data-testid*="aspect-ratio"], .aspect-ratio button',
  CONTENT_TYPE_SELECTOR: '[data-testid*="content-type"], .content-type button',
  DOWNLOAD_BUTTON: 'button[aria-label*="Download"], button[data-testid*="download"]',
  LOGIN_BUTTON: 'button[data-testid*="login"], a[href*="sign-in"], button[aria-label*="Sign in"]',
};

// ──────────────────────────────────────────────
// Driver class
// ──────────────────────────────────────────────

export class FireflyDriver {
  private config: FireflyConfig;
  private trackedWindow: number | null = null;
  private trackedTab: number | null = null;

  constructor(config: Partial<FireflyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Low-level Safari helpers ─────────────────

  private async executeJS(js: string): Promise<string> {
    const cleanJS = js.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const tempFile = path.join(os.tmpdir(), `ff-js-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.js`);
    await fs.writeFile(tempFile, cleanJS);

    const tabSpec = (this.trackedWindow && this.trackedTab)
      ? `tab ${this.trackedTab} of window ${this.trackedWindow}`
      : 'current tab of front window';

    const script = `
      set jsCode to read POSIX file "${tempFile}" as «class utf8»
      tell application "Safari" to do JavaScript jsCode in ${tabSpec}
    `;
    try {
      const { stdout } = await execAsync(
        `osascript -e '${script.replace(/'/g, "'\"'\"'")}'`,
        { timeout: this.config.timeout }
      );
      await fs.unlink(tempFile).catch(() => {});
      return stdout.trim();
    } catch (err) {
      await fs.unlink(tempFile).catch(() => {});
      throw err;
    }
  }

  private async navigate(url: string): Promise<boolean> {
    try {
      const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      if (this.trackedWindow && this.trackedTab) {
        await execAsync(
          `osascript -e 'tell application "Safari" to set URL of tab ${this.trackedTab} of window ${this.trackedWindow} to "${safeUrl}"'`,
          { timeout: this.config.timeout }
        );
      } else {
        await execAsync(
          `osascript -e 'tell application "Safari" to set URL of current tab of front window to "${safeUrl}"'`,
          { timeout: this.config.timeout }
        );
      }
      await this.wait(3000);
      return true;
    } catch { return false; }
  }

  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async waitForElement(selector: string, maxWaitMs = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const found = await this.executeJS(
          `document.querySelector('${selector.replace(/'/g, "\\'")}') ? 'found' : 'not_found'`
        );
        if (found === 'found') return true;
      } catch { /* ignore */ }
      await this.wait(500);
    }
    return false;
  }

  private async waitForGenerationComplete(maxWaitMs = 90000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        // Generation is complete when loading indicators disappear and images appear
        const status = await this.executeJS(`
          (function() {
            var loading = document.querySelector('[aria-label*="Loading"], .loading, [data-testid*="loading"], [class*="loading"], [class*="spinner"]');
            var hasImages = document.querySelectorAll('img[src*="firefly"], img[src*="adobe"], [class*="result"] img, [class*="output"] img, [class*="generated"] img').length > 0;
            if (!loading && hasImages) return 'complete';
            if (loading) return 'loading';
            return 'waiting';
          })()
        `);
        if (status === 'complete') return true;
      } catch { /* ignore */ }
      await this.wait(1500);
    }
    return false;
  }

  private async ensureFireflyTab(): Promise<boolean> {
    // Try to find an existing Firefly tab
    try {
      const script = `
tell application "Safari"
  repeat with w from 1 to count of windows
    repeat with t from 1 to count of tabs of window w
      set tabURL to URL of tab t of window w
      if tabURL contains "firefly.adobe.com" then
        return (w as text) & ":" & (t as text)
      end if
    end repeat
  end repeat
  return "not_found"
end tell`;
      const { stdout } = await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`);
      const result = stdout.trim();
      if (result !== 'not_found') {
        const [w, t] = result.split(':').map(Number);
        this.trackedWindow = w;
        this.trackedTab = t;
        // Bring tab to front
        const activateScript = `
tell application "Safari"
  activate
  set index of window ${w} to 1
  set current tab of window ${w} to tab ${t} of window ${w}
end tell`;
        await execAsync(`osascript << 'APPLESCRIPT'\n${activateScript}\nAPPLESCRIPT`);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  // ── Public API ───────────────────────────────

  async getStatus(): Promise<FireflyStatus> {
    try {
      const tabSpec = (this.trackedWindow && this.trackedTab)
        ? `tab ${this.trackedTab} of window ${this.trackedWindow}`
        : 'current tab of front window';
      const { stdout } = await execAsync(
        `osascript -e 'tell application "Safari" to get URL of ${tabSpec}'`
      );
      const currentUrl = stdout.trim();
      const isOnFirefly = currentUrl.includes('firefly.adobe.com');

      let isLoggedIn = false;
      let page = 'unknown';

      if (isOnFirefly) {
        const loginCheck = await this.executeJS(`
          (function() {
            var loginBtn = document.querySelector('button[class*="login"], a[href*="sign-in"], [data-testid*="login"]');
            var userMenu = document.querySelector('[data-testid*="user-menu"], [aria-label*="Account"], [class*="user-avatar"]');
            if (userMenu) return 'logged_in';
            if (loginBtn) return 'not_logged_in';
            return 'unknown';
          })()
        `);
        isLoggedIn = loginCheck === 'logged_in' || loginCheck === 'unknown';
        page = currentUrl.includes('image-generator') ? 'text-to-image'
          : currentUrl.includes('generative-fill') ? 'generative-fill'
          : currentUrl.includes('text-effects') ? 'text-effects'
          : 'home';
      }

      return { isOnFirefly, isLoggedIn, currentUrl, page };
    } catch {
      return { isOnFirefly: false, isLoggedIn: false, currentUrl: '', page: 'unknown' };
    }
  }

  async navigateToGenerator(): Promise<boolean> {
    console.log('[Firefly] Navigating to image generator...');
    const found = await this.ensureFireflyTab();
    if (!found) {
      // Open in front window
      await this.navigate(FIREFLY_GENERATE_URL);
    } else {
      const currentUrl = (await this.getStatus()).currentUrl;
      if (!currentUrl.includes('image-generator')) {
        await this.navigate(FIREFLY_GENERATE_URL);
      }
    }
    await this.wait(4000);
    return true;
  }

  async setAspectRatio(ratio: AspectRatio): Promise<boolean> {
    const ratioMap: Record<AspectRatio, string> = {
      square: '1:1',
      landscape: '4:3',
      portrait: '3:4',
      widescreen: '16:9',
    };
    const label = ratioMap[ratio];
    console.log(`[Firefly] Setting aspect ratio: ${label}`);
    const clicked = await this.executeJS(`
      (function() {
        var buttons = Array.from(document.querySelectorAll('button, [role="button"], [role="radio"]'));
        var btn = buttons.find(b => b.textContent.includes('${label}') || b.getAttribute('aria-label')?.includes('${label}') || b.getAttribute('data-value') === '${label}');
        if (btn) { btn.click(); return 'clicked'; }
        return 'not_found';
      })()
    `);
    return clicked === 'clicked';
  }

  async setStyle(style: StylePreset): Promise<boolean> {
    if (style === 'none') return true;
    const styleLabel = style.replace(/_/g, ' ');
    console.log(`[Firefly] Setting style: ${styleLabel}`);
    const clicked = await this.executeJS(`
      (function() {
        var buttons = Array.from(document.querySelectorAll('button, [role="button"], [role="radio"], [role="option"]'));
        var btn = buttons.find(b => b.textContent.trim().toLowerCase() === '${styleLabel.toLowerCase()}' || b.getAttribute('aria-label')?.toLowerCase().includes('${styleLabel.toLowerCase()}'));
        if (btn) { btn.click(); return 'clicked'; }
        return 'not_found';
      })()
    `);
    return clicked === 'clicked';
  }

  async enterPrompt(prompt: string, negativePrompt?: string): Promise<boolean> {
    console.log(`[Firefly] Entering prompt: "${prompt.substring(0, 60)}..."`);

    // Find and focus the prompt textarea
    const focused = await this.executeJS(`
      (function() {
        var selectors = [
          'textarea[placeholder*="Describe"]',
          'textarea[aria-label*="prompt"]',
          'textarea[data-testid*="prompt"]',
          '.prompt-input textarea',
          'textarea'
        ];
        for (var sel of selectors) {
          var el = document.querySelector(sel);
          if (el) {
            el.focus();
            el.select();
            return 'focused:' + sel;
          }
        }
        return 'not_found';
      })()
    `);

    if (focused === 'not_found') {
      console.warn('[Firefly] Prompt input not found — make sure Firefly is open and loaded');
      return false;
    }

    // Clear existing text and type new prompt via clipboard (handles React state)
    await this.executeJS(`
      (function() {
        var selectors = ['textarea[placeholder*="Describe"]','textarea[aria-label*="prompt"]','textarea[data-testid*="prompt"]','.prompt-input textarea','textarea'];
        for (var sel of selectors) {
          var el = document.querySelector(sel);
          if (el) {
            var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if (nativeInputValueSetter) {
              nativeInputValueSetter.call(el, '${prompt.replace(/'/g, "\\'").replace(/\n/g, ' ')}');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return 'set';
          }
        }
        return 'not_found';
      })()
    `);

    // Fallback: use clipboard + paste
    const escapedPrompt = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    await execAsync(`osascript -e 'set the clipboard to "${escapedPrompt}"'`);
    await this.wait(200);
    await execAsync(`osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "a" using command down'`);
    await this.wait(100);
    await execAsync(`osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "v" using command down'`);
    await this.wait(500);

    return true;
  }

  async clickGenerate(): Promise<boolean> {
    console.log('[Firefly] Clicking Generate...');
    // Try JS click on various selectors
    const clicked = await this.executeJS(`
      (function() {
        var selectors = [
          'button[data-testid*="generate"]',
          'button[aria-label*="Generate"]',
          'button.generate-button',
          'button[class*="generate"]',
          'button[class*="Generate"]',
          'button[type="submit"]'
        ];
        for (var sel of selectors) {
          var btns = Array.from(document.querySelectorAll(sel));
          var btn = btns.find(b => !b.disabled && (b.textContent.toLowerCase().includes('generate') || b.getAttribute('aria-label')?.toLowerCase().includes('generate')));
          if (!btn) btn = btns[0];
          if (btn && !btn.disabled) { btn.click(); return 'clicked:' + sel; }
        }
        // Last resort: find any button with "Generate" text
        var allBtns = Array.from(document.querySelectorAll('button'));
        var genBtn = allBtns.find(b => b.textContent.trim().toLowerCase() === 'generate' && !b.disabled);
        if (genBtn) { genBtn.click(); return 'clicked:text-match'; }
        return 'not_found';
      })()
    `);

    if (clicked === 'not_found') {
      // Fallback: press Enter in the prompt field
      await execAsync(`osascript -e 'tell application "System Events" to tell process "Safari" to key code 36'`);
      return true;
    }

    console.log(`[Firefly] Generate triggered via: ${clicked}`);
    return true;
  }

  async waitForImages(maxWaitMs = 90000): Promise<boolean> {
    console.log('[Firefly] Waiting for generation to complete...');
    return this.waitForGenerationComplete(maxWaitMs);
  }

  async getGeneratedImageUrls(): Promise<string[]> {
    const result = await this.executeJS(`
      (function() {
        var candidates = [];
        // Strategy 1: Images in result/output panels
        var resultImgs = document.querySelectorAll('[class*="result"] img, [class*="output"] img, [class*="generated"] img, [class*="Preview"] img');
        resultImgs.forEach(function(img) { if (img.src && img.src.startsWith('http')) candidates.push(img.src); });
        // Strategy 2: Any large img with blob: or https: from Adobe CDN
        var allImgs = document.querySelectorAll('img');
        allImgs.forEach(function(img) {
          if (img.src && (img.src.startsWith('blob:') || img.src.includes('adobe') || img.src.includes('firefly')) && !candidates.includes(img.src)) {
            var w = img.naturalWidth || img.width;
            var h = img.naturalHeight || img.height;
            if (w > 256 && h > 256) candidates.push(img.src);
          }
        });
        // Strategy 3: Canvas elements (Firefly sometimes uses canvas)
        var canvases = document.querySelectorAll('[class*="result"] canvas, [class*="output"] canvas, [class*="generated"] canvas');
        canvases.forEach(function(c) {
          try { var dataUrl = c.toDataURL('image/png'); if (dataUrl !== 'data:,') candidates.push(dataUrl); } catch(e) {}
        });
        return JSON.stringify([...new Set(candidates)]);
      })()
    `);

    try {
      const urls = JSON.parse(result);
      console.log(`[Firefly] Found ${urls.length} generated image(s)`);
      return urls;
    } catch {
      return [];
    }
  }

  async downloadImageFromUrl(url: string, outputPath: string): Promise<boolean> {
    try {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      if (url.startsWith('data:')) {
        // Data URL (canvas capture)
        const base64Data = url.split(',')[1];
        await fs.writeFile(outputPath, Buffer.from(base64Data, 'base64'));
        return true;
      }

      if (url.startsWith('blob:')) {
        // Blob URL — must convert in-page to data URL first
        const dataUrl = await this.executeJS(`
          (function() {
            return new Promise(function(resolve) {
              fetch('${url}')
                .then(function(r) { return r.blob(); })
                .then(function(blob) {
                  var reader = new FileReader();
                  reader.onloadend = function() { resolve(reader.result); };
                  reader.readAsDataURL(blob);
                });
            });
          })()
        `);
        if (dataUrl && dataUrl.startsWith('data:')) {
          const base64Data = dataUrl.split(',')[1];
          await fs.writeFile(outputPath, Buffer.from(base64Data, 'base64'));
          return true;
        }
        return false;
      }

      // Regular HTTPS URL
      return new Promise((resolve) => {
        const fileStream = fsSync.createWriteStream(outputPath);
        const protocol = url.startsWith('https:') ? https : http;
        protocol.get(url, (response) => {
          response.pipe(fileStream);
          fileStream.on('finish', () => { fileStream.close(); resolve(true); });
        }).on('error', (err) => {
          console.error('[Firefly] Download error:', err);
          fsSync.unlink(outputPath, () => {});
          resolve(false);
        });
      });
    } catch (err) {
      console.error('[Firefly] downloadImageFromUrl error:', err);
      return false;
    }
  }

  async downloadGeneratedImages(prompt: string): Promise<string[]> {
    const urls = await this.getGeneratedImageUrls();
    if (urls.length === 0) return [];

    await fs.mkdir(this.config.downloadsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = prompt.slice(0, 40).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const saved: string[] = [];

    for (let i = 0; i < urls.length; i++) {
      const ext = urls[i].startsWith('data:image/png') ? 'png' : 'jpg';
      const filename = `firefly-${slug}-${timestamp}-${i + 1}.${ext}`;
      const outputPath = path.join(this.config.downloadsDir, filename);
      const ok = await this.downloadImageFromUrl(urls[i], outputPath);
      if (ok) {
        saved.push(outputPath);
        console.log(`[Firefly] Saved: ${outputPath}`);
      }
    }
    return saved;
  }

  async generate(options: GenerateOptions): Promise<{
    success: boolean;
    imageUrls: string[];
    savedPaths: string[];
    prompt: string;
    error?: string;
  }> {
    const { prompt, negativePrompt, aspectRatio, style, count } = options;

    try {
      await this.navigateToGenerator();
      await this.wait(2000);

      // Set options (best-effort; selectors may vary with Firefly version)
      if (aspectRatio) await this.setAspectRatio(aspectRatio);
      if (style) await this.setStyle(style);

      // Enter prompt
      const prompted = await this.enterPrompt(prompt, negativePrompt);
      if (!prompted) {
        return { success: false, imageUrls: [], savedPaths: [], prompt, error: 'Could not find prompt input' };
      }

      await this.wait(500);
      await this.clickGenerate();
      await this.wait(this.config.generateWaitMs);

      const complete = await this.waitForImages(this.config.maxGenerateWaitMs);
      if (!complete) {
        console.warn('[Firefly] Generation timeout — attempting to extract partial results');
      }

      await this.wait(2000);
      const imageUrls = await this.getGeneratedImageUrls();
      const savedPaths = await this.downloadGeneratedImages(prompt);

      return { success: imageUrls.length > 0 || savedPaths.length > 0, imageUrls, savedPaths, prompt };
    } catch (err) {
      return { success: false, imageUrls: [], savedPaths: [], prompt, error: String(err) };
    }
  }

  getConfig(): FireflyConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<FireflyConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
