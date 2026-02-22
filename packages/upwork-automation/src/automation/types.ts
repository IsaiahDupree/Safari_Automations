/**
 * Upwork Safari Automation Types
 */

export interface AutomationConfig {
  instanceType: 'local' | 'remote';
  remoteUrl?: string;
  timeout: number;
  actionDelay: number;
  verbose: boolean;
}

export const DEFAULT_CONFIG: AutomationConfig = {
  instanceType: 'local',
  timeout: 30000,
  actionDelay: 1500,
  verbose: false,
};

// ─── Job Types ───────────────────────────────────────────────

export interface UpworkJob {
  id: string;
  title: string;
  description: string;
  url: string;
  budget: {
    type: 'hourly' | 'fixed';
    min?: number;
    max?: number;
    amount?: number;
  };
  skills: string[];
  category: string;
  experienceLevel: string;
  postedAt: string;
  proposals: number;
  connectsCost: number;
  isInviteOnly: boolean;
  clientInfo: {
    location: string;
    paymentVerified: boolean;
    totalSpent: string;
    hireRate: string;
    jobsPosted: number;
    reviewScore?: number;
  };
  scrapedAt: string;
}

// ─── Job Tabs ────────────────────────────────────────────────

export type JobTab = 'best_matches' | 'most_recent' | 'us_only' | 'saved_jobs';

export const JOB_TAB_URLS: Record<JobTab, string> = {
  best_matches: 'https://www.upwork.com/nx/find-work/best-matches',
  most_recent: 'https://www.upwork.com/nx/find-work/most-recent',
  us_only: 'https://www.upwork.com/nx/find-work/domestic',
  saved_jobs: 'https://www.upwork.com/nx/search/jobs/saved/',
};

// ─── Search Config (ALL Upwork Filters) ──────────────────────

export interface JobSearchConfig {
  keywords: string[];

  // Category
  category?: string;

  // Experience level (can select multiple)
  experienceLevel: ('entry' | 'intermediate' | 'expert')[] | 'any';

  // Job type
  jobType: 'hourly' | 'fixed' | 'both';

  // Budget ranges
  hourlyRateMin?: number;
  hourlyRateMax?: number;
  fixedPriceRange?: 'less_100' | '100_500' | '500_1k' | '1k_5k' | '5k_plus';
  fixedPriceMin?: number;
  fixedPriceMax?: number;

  // Proposals / competition
  proposalRange?: 'less_5' | '5_10' | '10_15' | '15_20' | '20_50';

  // Client info
  paymentVerified?: boolean;
  previousClients?: boolean;

  // Client history
  clientHires?: 'no_hires' | '1_9' | '10_plus';

  // Client location
  clientLocation?: string;

  // Client time zones
  clientTimezone?: string;

  // Project length
  projectLength?: 'less_month' | '1_3_months' | '3_6_months' | '6_plus_months';

  // Hours per week (for hourly jobs)
  hoursPerWeek?: 'less_30' | 'more_30';

  // Contract-to-hire
  contractToHire?: boolean;

  // US only
  usOnly?: boolean;

  // Sort
  sortBy: 'relevance' | 'newest' | 'client_spending';

  // Posted within
  postedWithin?: '24h' | '3d' | '7d' | '14d' | '30d';

  // Exclude keywords
  excludeKeywords?: string[];
}

export const DEFAULT_SEARCH_CONFIG: JobSearchConfig = {
  keywords: [],
  jobType: 'both',
  experienceLevel: 'any',
  sortBy: 'newest',
};

// ─── Job Score + Connects Recommendation ─────────────────────

export interface JobScore {
  jobId: string;
  totalScore: number;
  factors: {
    budgetMatch: number;
    skillMatch: number;
    clientQuality: number;
    competition: number;
    freshness: number;
  };
  recommendation: 'apply' | 'maybe' | 'skip';
  reason: string;
  connectsRecommendation: {
    suggestedConnects: number;
    reasoning: string;
    competitionLevel: 'low' | 'medium' | 'high' | 'very_high';
  };
}

// ─── Job Detail (Full Page) ──────────────────────────────────

export interface UpworkJobDetail extends UpworkJob {
  fullDescription: string;
  attachments: string[];
  questionsForFreelancer: string[];
  connectsRequired: number;
  availableConnects?: number;
  hireDate?: string;
  projectType?: string;
  projectLength?: string;
  weeklyHours?: string;
  clientJoined?: string;
  clientJobsPosted?: number;
  clientHireRate?: string;
  clientOpenJobs?: number;
  clientTotalSpent?: string;
  clientAvgHourlyRate?: string;
  activityOnJob?: string;
  proposalsCount?: number;
  interviewing?: number;
  invitesSent?: number;
  unansweredInvites?: number;
}

// ─── Proposal Types ──────────────────────────────────────────

export interface ProposalTemplate {
  id: string;
  name: string;
  categories: string[];
  template: string;
  tone: 'professional' | 'friendly' | 'technical';
}

export interface GeneratedProposal {
  coverLetter: string;
  suggestedQuestions: string[];
  confidence: number;
}

// ─── Message Types ───────────────────────────────────────────

export interface UpworkMessage {
  id: string;
  from: string;
  content: string;
  timestamp: string;
  isOutbound: boolean;
  isRead: boolean;
  jobTitle?: string;
}

export interface UpworkConversation {
  id: string;
  clientName: string;
  jobTitle: string;
  lastMessage: string;
  lastMessageAt: string;
  unread: boolean;
}

export interface SendMessageResult {
  success: boolean;
  error?: string;
  verified?: boolean;
  verifiedRecipient?: string;
}

export interface NavigationResult {
  success: boolean;
  currentUrl?: string;
  error?: string;
}

// ─── Application Types ───────────────────────────────────────

export interface ApplicationStatus {
  jobId: string;
  jobTitle: string;
  appliedAt: string;
  connectsUsed: number;
  status: 'submitted' | 'viewed' | 'shortlisted' | 'interview' | 'hired' | 'declined' | 'withdrawn';
  clientViewed: boolean;
  lastActivity?: string;
}

// ─── Rate Limits ─────────────────────────────────────────────

export interface RateLimitConfig {
  searchesPerHour: number;
  applicationsPerDay: number;
  messagesPerHour: number;
  pageLoadsPerMinute: number;
  minDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  searchesPerHour: 20,
  applicationsPerDay: 30,
  messagesPerHour: 20,
  pageLoadsPerMinute: 8,
  minDelayMs: 3000,
  maxDelayMs: 8000,
};

// ─── Selectors ───────────────────────────────────────────────

export const UPWORK_SELECTORS = {
  // Login detection
  loggedIn: '[data-test="user-avatar"], .nav-avatar, [data-cy="nav-user-avatar"]',
  loginForm: 'input#login_username, input[name="login[username]"]',

  // Job search
  searchInput: 'input[placeholder*="Search"], input[aria-label*="Search"]',
  jobCard: '[data-test="job-tile"], .job-tile, [data-ev-label="search_results_impression"]',
  jobTitle: '[data-test="job-tile-title"], .job-tile-title a, h2.job-tile-title a',
  jobBudget: '[data-test="budget"], .js-budget, [data-test="is-fixed-price"]',
  jobSkills: '[data-test="token"], .air3-token, .up-skill-badge',
  jobProposals: '[data-test="proposals"], .js-proposals',
  jobDescription: '[data-test="description"], .job-description',
  jobClientInfo: '[data-test="client-info"], .client-info',

  // Job detail page
  applyButton: '[data-test="apply-button"], button[aria-label*="Apply"], .up-btn-primary',
  saveJobButton: '[data-test="save-job"], [aria-label*="Save"]',

  // Proposal submission
  proposalTextarea: '[data-test="cover-letter"], textarea[name="coverLetter"], .cover-letter-area textarea',
  rateInput: '[data-test="rate"], input[name="rate"]',
  submitProposalButton: '[data-test="submit-proposal"], button[type="submit"]',

  // Messages
  messageList: '.messages-thread, [data-test="message-list"]',
  messageInput: '[data-test="message-input"], .msg-composer textarea, [contenteditable="true"]',
  sendMessageButton: '[data-test="send-message"], button[aria-label*="Send"]',
  conversationItem: '.thread-list-item, [data-test="conversation"]',

  // Applications / My Jobs
  myJobsNav: 'a[href*="/nx/find-work/my-jobs"]',
  applicationRow: '.my-job-item, [data-test="application"]',
};
