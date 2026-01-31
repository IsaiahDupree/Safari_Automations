/**
 * Sora Rate Limiter
 * 
 * Conservative rate limiting for Sora video generation.
 * Defaults to very infrequent generation to prevent overuse.
 */

export { SoraRateLimiter } from './sora-rate-limiter';
export type { 
  SoraRateLimitConfig, 
  SoraGenerationRequest, 
  SoraUsageStats,
  SoraGenerationStatus 
} from './types';
export { DEFAULT_SORA_CONFIG, MINIMAL_SORA_CONFIG } from './types';

// Real Safari automation for Sora (NO MOCKS)
export { SoraRealAutomation, DEFAULT_SORA_REAL_CONFIG } from './sora-real-automation';
export type {
  SoraRealConfig,
  PromptResult,
  Draft,
  PollResult,
  DownloadResult,
} from './sora-real-automation';

// Verified selectors for sora.chatgpt.com
export {
  SORA_SELECTORS,
  JS_SET_TEXTAREA_VALUE,
  JS_CLICK_RADIX_ELEMENT,
  JS_CLICK_BUTTON_BY_TEXT,
  JS_SELECT_DURATION,
  JS_SELECT_ASPECT_RATIO,
  JS_GET_VIDEO_STATUS,
  JS_LOAD_MORE_DRAFTS,
  JS_GET_DRAFTS_INFO,
} from './sora-selectors';

// Full automation (submit + poll + download + usage)
export { SoraFullAutomation, DEFAULT_FULL_CONFIG } from './sora-full-automation';
export type {
  SoraFullConfig,
  SubmitResult,
  PollResult as FullPollResult,
  DownloadResult as FullDownloadResult,
  FullRunResult,
  UsageInfo,
} from './sora-full-automation';
