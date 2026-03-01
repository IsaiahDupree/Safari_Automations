/**
 * Threads Comments API
 *
 * Safari automation for posting comments on Threads.
 */

export { ThreadsDriver, JS_TEMPLATES, SELECTORS, DEFAULT_CONFIG } from './automation/threads-driver.js';
export type { ThreadsConfig, CommentResult, ThreadsStatus } from './automation/threads-driver.js';
export { ThreadsAutoCommenter } from './automation/threads-auto-commenter.js';
export type { PostContext, EngagementResult, AutoCommenterConfig } from './automation/threads-auto-commenter.js';
export { ThreadsAICommentGenerator, isInappropriateContent } from './automation/ai-comment-generator.js';
export type { AICommentConfig, PostAnalysis, GeneratedComment } from './automation/ai-comment-generator.js';
export { ThreadsResearcher, DEFAULT_THREADS_RESEARCH_CONFIG } from './automation/threads-researcher.js';
export type { ThreadsPost, ThreadsCreator, ThreadsNicheResult, ThreadsResearchConfig } from './automation/threads-researcher.js';
export { CommentLogger } from './db/comment-logger.js';
export { startServer, app, SERVICE_VERSION, AUTH_TOKEN } from './api/server.js';
export { startMCPServer } from './api/mcp-server.js';
