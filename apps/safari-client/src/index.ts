/**
 * Safari Client - TypeScript Safari Automation
 * 
 * Copied from Riona project with battle-tested Safari automation via AppleScript.
 * 
 * Note: These files require dependencies to be installed. Run:
 *   npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth playwright
 */

// Core Safari controller
export { SafariController } from './SafariController';
export type { PageState, ConversationInfo, MessageInfo, NoteInfo } from './SafariController';

// Browser adapter types
export type { BrowserType, BrowserConfig, UnifiedPage, UnifiedBrowser } from './BrowserAdapter';

// Re-export modules (check individual files for exact exports)
export * from './SafariAutoComment';
export * from './SafariDMExtractor';
export * from './SafariProfileDM';
export * from './SafariRequestsProcessor';
export * from './SafariDMStatusTracker';
export * from './SafariSelectorTest';
export * from './InstagramDMSafari';
