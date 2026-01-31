/**
 * Session Manager Types
 * Based on PRD: PRD_SAFARI_SESSION_MANAGER.md
 */

export type Platform = 
  | 'twitter'
  | 'tiktok'
  | 'instagram'
  | 'threads'
  | 'youtube'
  | 'reddit'
  | 'sora';

export type SessionStatus = 
  | 'active'    // Logged in, recently refreshed
  | 'stale'     // Logged in, needs refresh
  | 'expired'   // Session lost, needs re-login
  | 'paused'    // Manually paused
  | 'checking'; // Currently verifying

export interface PlatformConfig {
  name: string;
  homeUrl: string;
  loginUrl: string;
  loggedInIndicators: string[];
  loggedOutIndicators: string[];
  refreshIntervalMinutes: number;
  sessionTimeoutMinutes: number;
}

export interface SessionState {
  platform: Platform;
  status: SessionStatus;
  username: string | null;
  lastCheck: Date | null;
  lastRefresh: Date | null;
  lastLogin: Date | null;
  error: string | null;
}

export interface AccountInfo {
  id: string;
  platform: Platform;
  username: string;
  displayName: string | null;
  isActive: boolean;
  isLoggedIn: boolean;
  lastLogin: Date | null;
  lastCheck: Date | null;
  lastRefresh: Date | null;
  refreshIntervalMinutes: number;
  autoRefresh: boolean;
  priority: number;
}

export interface SessionEvent {
  id: string;
  accountId: string;
  eventType: 'login' | 'logout' | 'refresh' | 'check' | 'expire' | 'error';
  status: SessionStatus;
  details: Record<string, unknown>;
  errorMessage: string | null;
  timestamp: Date;
}

export interface SessionMetrics {
  platform: Platform;
  uptimePercent: number;
  refreshCount: number;
  failureCount: number;
  avgSessionLengthMinutes: number;
  recoveryTimeMinutes: number;
}

export const PLATFORM_CONFIGS: Record<Platform, PlatformConfig> = {
  twitter: {
    name: 'Twitter/X',
    homeUrl: 'https://x.com/home',
    loginUrl: 'https://x.com/login',
    loggedInIndicators: [
      '[data-testid="AppTabBar_Profile_Link"]',
      '[data-testid="SideNav_NewTweet_Button"]',
      'a[href="/compose/post"]',
    ],
    loggedOutIndicators: [
      'a[href="/login"]',
      '[data-testid="loginButton"]',
    ],
    refreshIntervalMinutes: 25,
    sessionTimeoutMinutes: 60,
  },
  tiktok: {
    name: 'TikTok',
    homeUrl: 'https://www.tiktok.com/foryou',
    loginUrl: 'https://www.tiktok.com/login',
    loggedInIndicators: [
      '[data-e2e="profile-icon"]',
      '[data-e2e="upload-icon"]',
    ],
    loggedOutIndicators: [
      '[data-e2e="top-login-button"]',
      'button[data-e2e="login-button"]',
    ],
    refreshIntervalMinutes: 20,
    sessionTimeoutMinutes: 45,
  },
  instagram: {
    name: 'Instagram',
    homeUrl: 'https://www.instagram.com/',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    loggedInIndicators: [
      'a[href*="/direct/inbox/"]',
      '[aria-label="New post"]',
      'svg[aria-label="Home"]',
    ],
    loggedOutIndicators: [
      'input[name="username"]',
      'a[href="/accounts/login/"]',
    ],
    refreshIntervalMinutes: 25,
    sessionTimeoutMinutes: 60,
  },
  threads: {
    name: 'Threads',
    homeUrl: 'https://www.threads.net/',
    loginUrl: 'https://www.threads.net/login',
    loggedInIndicators: [
      'a[href*="/activity"]',
      '[aria-label="Create"]',
      'svg[aria-label="Home"]',
    ],
    loggedOutIndicators: [
      'a[href*="/login"]',
    ],
    refreshIntervalMinutes: 25,
    sessionTimeoutMinutes: 60,
  },
  youtube: {
    name: 'YouTube',
    homeUrl: 'https://www.youtube.com/',
    loginUrl: 'https://accounts.google.com/',
    loggedInIndicators: [
      '#avatar-btn',
      'button[aria-label*="Account"]',
    ],
    loggedOutIndicators: [
      'a[href*="accounts.google.com"]',
    ],
    refreshIntervalMinutes: 45,
    sessionTimeoutMinutes: 180,
  },
  reddit: {
    name: 'Reddit',
    homeUrl: 'https://www.reddit.com/',
    loginUrl: 'https://www.reddit.com/login',
    loggedInIndicators: [
      '[data-testid="user-dropdown"]',
    ],
    loggedOutIndicators: [
      'a[href*="/login"]',
    ],
    refreshIntervalMinutes: 30,
    sessionTimeoutMinutes: 120,
  },
  sora: {
    name: 'Sora (OpenAI)',
    homeUrl: 'https://sora.com/',
    loginUrl: 'https://sora.com/login',
    loggedInIndicators: [
      '[data-testid="profile-button"]',
      '[class*="avatar"]',
    ],
    loggedOutIndicators: [
      'button[data-testid="login-button"]',
    ],
    refreshIntervalMinutes: 30,
    sessionTimeoutMinutes: 120,
  },
};
