/**
 * Threads Comments API
 * 
 * Safari automation for posting comments on Threads.
 */

export { ThreadsDriver, JS_TEMPLATES, SELECTORS, DEFAULT_CONFIG } from './automation/threads-driver.js';
export { ThreadsAutoCommenter } from './automation/threads-auto-commenter.js';
export type { PostContext, EngagementResult, AutoCommenterConfig } from './automation/threads-auto-commenter.js';
export { startServer, app } from './api/server.js';
