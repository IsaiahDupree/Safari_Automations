/**
 * Safari Session Manager Service
 * 
 * Based on PRD: PRD_SAFARI_SESSION_MANAGER.md
 * 
 * Manages login sessions across all Safari-automated platforms with:
 * - Login state detection for each platform
 * - Automatic session refresh to prevent logout
 * - Session health monitoring
 * - Multi-account support
 */

export { SessionManager } from './session-manager';
export { SessionKeeper } from './session-keeper';
export type {
  Platform,
  PlatformConfig,
  SessionStatus,
  SessionState,
  AccountInfo,
} from './types';
