/**
 * Safari Automation Service
 * 
 * Unified Safari browser control using AppleScript.
 * Connects to all platform adapters.
 */

export { SafariService } from './safari-service';
export { SafariExecutor } from './safari-executor';
export type { 
  SafariConfig, 
  ExecutionResult, 
  NavigationResult,
  JSExecutionResult 
} from './types';
