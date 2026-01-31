/**
 * Safari Service Types
 */

export interface SafariConfig {
  timeout: number;
  retryAttempts: number;
  retryDelayMs: number;
  screenshotOnError: boolean;
  screenshotDir: string;
}

export interface ExecutionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
  screenshot?: string;
}

export interface NavigationResult {
  success: boolean;
  url: string;
  title?: string;
  error?: string;
  loadTime: number;
}

export interface JSExecutionResult {
  success: boolean;
  result: string | null;
  error?: string;
}

export interface PageState {
  url: string;
  title: string;
  isLoaded: boolean;
  hasErrors: boolean;
}

export interface ElementInfo {
  found: boolean;
  visible: boolean;
  enabled: boolean;
  text?: string;
  value?: string;
}

export const DEFAULT_CONFIG: SafariConfig = {
  timeout: 30000,
  retryAttempts: 3,
  retryDelayMs: 2000,
  screenshotOnError: true,
  screenshotDir: './screenshots',
};
