/**
 * Unified DM Client
 * 
 * Single interface for TikTok, Instagram, and Twitter DMs
 */

export { UnifiedDMClient } from './client.js';
export * from './types.js';
export {
  initDMLogger,
  isLoggerEnabled,
  logDM,
  getOrCreateContact,
  startSession,
  endSession,
  getDMStats,
  type DMLogEntry,
  type DMSessionEntry,
  type DMPlatform,
} from './dm-logger.js';
