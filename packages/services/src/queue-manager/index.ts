/**
 * Browser Queue Manager
 * 
 * Based on PRD: PRD_Safari_Automation_Management.md (SAFARI-001)
 * 
 * Central queue that serializes all Safari browser operations.
 * 
 * Queue Priority (highest first):
 * 1. Active Sora generation polling (check every 30s when generating)
 * 2. Twitter posting (time-sensitive, every 2 hours)
 * 3. Commenting (30/hour = 1 every 2 minutes)
 * 4. Stats polling (passive, fill gaps)
 * 5. Trend discovery scraping (background)
 */

export { BrowserQueueManager } from './queue-manager';
export type { QueueTask, QueuePriority, TaskStatus, QueueConfig } from './types';
