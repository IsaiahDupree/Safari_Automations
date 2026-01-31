/**
 * Platform Comment Adapters
 * 
 * Platform-specific implementations for posting comments via Safari.
 */

export { InstagramAdapter } from './instagram';
export { TwitterAdapter } from './twitter';
export { TikTokAdapter } from './tiktok';
export { ThreadsAdapter } from './threads';
export type { CommentAdapter, AdapterConfig } from './base';
