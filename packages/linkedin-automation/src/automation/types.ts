/**
 * LinkedIn Safari Automation Types
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
  actionDelay: 2000,
  verbose: false,
};

// ─── Profile Types ───────────────────────────────────────────

export interface LinkedInProfile {
  profileUrl: string;
  name: string;
  headline: string;
  location: string;
  about?: string;
  currentPosition?: {
    title: string;
    company: string;
    duration: string;
  };
  connectionDegree: '1st' | '2nd' | '3rd' | 'out_of_network';
  mutualConnections: number;
  isOpenToWork: boolean;
  isHiring: boolean;
  skills: string[];
  scrapedAt: string;
}

// ─── Connection Types ────────────────────────────────────────

export interface ConnectionRequest {
  profileUrl: string;
  note?: string;
  skipIfConnected: boolean;
  skipIfPending: boolean;
}

export interface ConnectionResult {
  success: boolean;
  status: 'sent' | 'already_connected' | 'pending' | 'cannot_connect' | 'error';
  reason?: string;
}

export interface ConnectionStatus {
  profileUrl: string;
  status: 'connected' | 'pending_sent' | 'pending_received' | 'not_connected' | 'following';
  canMessage: boolean;
  canConnect: boolean;
}

export interface PendingRequest {
  profileUrl: string;
  name: string;
  headline: string;
  mutualConnections: number;
  type: 'sent' | 'received';
}

// ─── Message Types ───────────────────────────────────────────

export interface LinkedInConversation {
  conversationId: string;
  participantName: string;
  participantHeadline?: string;
  lastMessage: string;
  lastMessageAt: string;
  unread: boolean;
  isGroup: boolean;
}

export interface LinkedInMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
  isOutbound: boolean;
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

// ─── Search Types ────────────────────────────────────────────

export interface PeopleSearchConfig {
  keywords: string[];
  title?: string;
  company?: string;
  location?: string;
  connectionDegree?: '1st' | '2nd' | '3rd+';
  industry?: string;
}

export interface SearchResult {
  name: string;
  profileUrl: string;
  headline: string;
  location: string;
  connectionDegree: string;
  mutualConnections: number;
}

// ─── Lead Scoring ────────────────────────────────────────────

export interface LeadScore {
  profileUrl: string;
  totalScore: number;
  factors: {
    titleMatch: number;
    companyMatch: number;
    locationMatch: number;
    connectionProximity: number;
    activityLevel: number;
  };
  recommendation: 'high_priority' | 'medium' | 'low' | 'skip';
  reason: string;
}

// ─── Rate Limits ─────────────────────────────────────────────

export interface RateLimitConfig {
  connectionRequestsPerDay: number;
  connectionRequestsPerWeek: number;
  messagesPerHour: number;
  messagesPerDay: number;
  profileViewsPerHour: number;
  searchesPerHour: number;
  minDelayMs: number;
  maxDelayMs: number;
  activeHoursStart: number;
  activeHoursEnd: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  connectionRequestsPerDay: 20,
  connectionRequestsPerWeek: 80,
  messagesPerHour: 10,
  messagesPerDay: 50,
  profileViewsPerHour: 30,
  searchesPerHour: 15,
  minDelayMs: 30000,
  maxDelayMs: 120000,
  activeHoursStart: 8,
  activeHoursEnd: 18,
};

// ─── Selectors ───────────────────────────────────────────────

export const LINKEDIN_SELECTORS = {
  // Login detection
  loggedIn: '.global-nav__me, [data-test-id="feed-container"], .feed-identity-module',
  loginForm: '.login__form, input#username',

  // Navigation
  messagingNav: 'a[href*="/messaging/"]',
  networkNav: 'a[href*="/mynetwork/"]',
  homeNav: 'a[href*="/feed/"]',

  // Profile page
  profileName: 'h1.text-heading-xlarge, h1[class*="break-words"]',
  profileHeadline: '.text-body-medium[data-generated-suggestion-target], div.text-body-medium',
  profileLocation: 'span.text-body-small[class*="inline"]',
  profileAbout: '#about ~ div .inline-show-more-text',
  profileExperience: '#experience ~ div .pvs-list__paged-list-item',

  // Connection buttons
  connectButton: 'button[aria-label*="Connect"], button[aria-label*="Invite"]',
  pendingButton: 'button[aria-label*="Pending"]',
  messageButton: 'button[aria-label*="Message"]',
  followButton: 'button[aria-label*="Follow"]',
  connectionNote: 'textarea#custom-message, textarea[name="message"]',
  sendInviteButton: 'button[aria-label="Send invitation"], button[aria-label="Send"]',
  addNoteButton: 'button[aria-label="Add a note"]',

  // Messaging
  conversationList: '.msg-conversations-container__conversations-list, ul.msg-conversations-container__conversations-list',
  conversationItem: '.msg-conversation-listitem, li.msg-conversation-listitem',
  messageInput: '.msg-form__contenteditable, [role="textbox"][contenteditable="true"]',
  sendButton: '.msg-form__send-button, button[type="submit"].msg-form__send-button',
  newMessageButton: '.msg-overlay-bubble-header__button, a[href*="/messaging/new"]',

  // Search
  searchInput: 'input[aria-label="Search"], input.search-global-typeahead__input',
  searchResultPerson: '.entity-result, .reusable-search__result-container',

  // My Network
  invitationCard: '.invitation-card, .mn-invitation-list li',
  acceptButton: 'button[aria-label*="Accept"]',
  ignoreButton: 'button[aria-label*="Ignore"]',
};
