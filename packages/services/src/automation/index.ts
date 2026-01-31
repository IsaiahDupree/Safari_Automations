/**
 * Automation Module
 * 
 * Exports core automation functionality for Safari browser control.
 */

// Core
export {
  AutomationCore,
  encryptValue,
  decryptValue,
} from './automation-core';

export type {
  Platform,
  AutomationResult,
  ProofArtifact,
  SessionData,
  EncryptedCookie,
  ClickResult,
  NavigationResult,
  TypeResult,
  WaitResult,
  HealthCheckResult,
  CommentResult,
} from './automation-core';

// Comment Automation
export {
  CommentAutomation,
  PLATFORM_COMMENT_CONFIGS,
} from './comment-automation';

export type {
  CommentConfig,
  CommentRequest,
  CommentRecord,
  CommentResult as CommentAutomationResult,
} from './comment-automation';

// DM Automation
export {
  DMAutomation,
  PLATFORM_DM_CONFIGS,
} from './dm-automation';

export type {
  DMConfig,
  DMRequest,
  DMRecord,
  DMResult,
} from './dm-automation';

// Discovery System
export {
  DiscoverySystem,
  PLATFORM_DISCOVERY_CONFIGS,
} from './discovery-system';

export type {
  DiscoveryConfig,
  DiscoveryQuery,
  DiscoveredPost,
  DiscoveryResult,
} from './discovery-system';

// Sora Automation
export {
  SoraAutomation,
  DEFAULT_SORA_CONFIG,
} from './sora-automation';

export type {
  SoraConfig,
  SoraPrompt,
  SoraDraft,
  SoraGenerationResult,
  SoraPollResult,
} from './sora-automation';
