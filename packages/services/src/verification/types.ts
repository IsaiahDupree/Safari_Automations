/**
 * Verification & Audit Types
 * 
 * Defines success criteria and proof requirements for all actions.
 */

export type ActionType = 
  | 'comment'
  | 'like'
  | 'follow'
  | 'dm'
  | 'navigate'
  | 'login_check'
  | 'sora_generate';

export type VerificationStatus = 
  | 'pending'
  | 'verified'
  | 'failed'
  | 'timeout'
  | 'manual_review';

export type ProofType = 
  | 'screenshot_before'
  | 'screenshot_after'
  | 'dom_snapshot'
  | 'element_found'
  | 'text_match'
  | 'url_match'
  | 'api_response'
  | 'timestamp';

/**
 * Success criteria for each action type
 */
export interface SuccessCriteria {
  actionType: ActionType;
  required: CriteriaItem[];
  optional: CriteriaItem[];
  timeoutMs: number;
  retryAttempts: number;
}

export interface CriteriaItem {
  type: ProofType;
  description: string;
  validator: string; // Name of validator function
  weight: number;    // 0-100, sum of required must = 100
}

/**
 * Proof artifact captured during action
 */
export interface ProofArtifact {
  type: ProofType;
  timestamp: Date;
  data: ProofData;
  valid: boolean;
  validationError?: string;
}

export type ProofData = 
  | ScreenshotProof
  | DOMSnapshotProof
  | ElementProof
  | TextMatchProof
  | URLMatchProof
  | APIResponseProof
  | TimestampProof;

export interface ScreenshotProof {
  type: 'screenshot';
  filepath: string;
  hash: string;      // SHA256 for integrity
  dimensions: { width: number; height: number };
  fileSize: number;
}

export interface DOMSnapshotProof {
  type: 'dom_snapshot';
  html: string;
  selector: string;
  elementCount: number;
}

export interface ElementProof {
  type: 'element';
  selector: string;
  found: boolean;
  visible: boolean;
  enabled: boolean;
  text?: string;
  attributes?: Record<string, string>;
}

export interface TextMatchProof {
  type: 'text_match';
  expected: string;
  actual: string;
  contains: boolean;
  exact: boolean;
}

export interface URLMatchProof {
  type: 'url_match';
  expected: string;
  actual: string;
  matches: boolean;
}

export interface APIResponseProof {
  type: 'api_response';
  endpoint: string;
  statusCode: number;
  body: string;
}

export interface TimestampProof {
  type: 'timestamp';
  action: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
}

/**
 * Complete action record with all proofs
 */
export interface ActionRecord {
  id: string;
  actionType: ActionType;
  platform: string;
  target: ActionTarget;
  status: VerificationStatus;
  
  // Timing
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  verifiedAt: Date | null;
  
  // Input
  input: Record<string, unknown>;
  
  // Proofs
  proofs: ProofArtifact[];
  
  // Results
  result: ActionResult | null;
  
  // Verification
  verificationScore: number;  // 0-100
  verificationNotes: string[];
  
  // Error tracking
  errors: ActionError[];
  retryCount: number;
}

export interface ActionTarget {
  url: string;
  postId?: string;
  userId?: string;
  username?: string;
}

export interface ActionResult {
  success: boolean;
  resultId?: string;  // e.g., comment ID
  resultUrl?: string; // e.g., link to comment
  data?: Record<string, unknown>;
}

export interface ActionError {
  timestamp: Date;
  phase: 'pre' | 'execute' | 'verify' | 'post';
  message: string;
  code?: string;
  screenshot?: string;
}

/**
 * Success criteria definitions for each action type
 */
export const SUCCESS_CRITERIA: Record<ActionType, SuccessCriteria> = {
  comment: {
    actionType: 'comment',
    required: [
      { type: 'screenshot_before', description: 'Screenshot before posting', validator: 'validateScreenshot', weight: 15 },
      { type: 'element_found', description: 'Comment input found', validator: 'validateElement', weight: 20 },
      { type: 'screenshot_after', description: 'Screenshot after posting', validator: 'validateScreenshot', weight: 15 },
      { type: 'text_match', description: 'Comment text visible on page', validator: 'validateTextMatch', weight: 35 },
      { type: 'timestamp', description: 'Action completed within timeout', validator: 'validateTimestamp', weight: 15 },
    ],
    optional: [
      { type: 'dom_snapshot', description: 'DOM state captured', validator: 'validateDOM', weight: 0 },
      { type: 'url_match', description: 'URL unchanged during action', validator: 'validateURL', weight: 0 },
    ],
    timeoutMs: 30000,
    retryAttempts: 2,
  },
  
  like: {
    actionType: 'like',
    required: [
      { type: 'screenshot_before', description: 'Screenshot before liking', validator: 'validateScreenshot', weight: 20 },
      { type: 'element_found', description: 'Like button found', validator: 'validateElement', weight: 30 },
      { type: 'screenshot_after', description: 'Screenshot after liking', validator: 'validateScreenshot', weight: 20 },
      { type: 'element_found', description: 'Unlike button visible (liked state)', validator: 'validateLikedState', weight: 30 },
    ],
    optional: [],
    timeoutMs: 15000,
    retryAttempts: 1,
  },
  
  follow: {
    actionType: 'follow',
    required: [
      { type: 'screenshot_before', description: 'Screenshot before following', validator: 'validateScreenshot', weight: 20 },
      { type: 'element_found', description: 'Follow button found', validator: 'validateElement', weight: 25 },
      { type: 'screenshot_after', description: 'Screenshot after following', validator: 'validateScreenshot', weight: 20 },
      { type: 'element_found', description: 'Following/Unfollow button visible', validator: 'validateFollowedState', weight: 35 },
    ],
    optional: [],
    timeoutMs: 15000,
    retryAttempts: 1,
  },
  
  dm: {
    actionType: 'dm',
    required: [
      { type: 'screenshot_before', description: 'Screenshot of DM thread before', validator: 'validateScreenshot', weight: 15 },
      { type: 'element_found', description: 'Message input found', validator: 'validateElement', weight: 20 },
      { type: 'screenshot_after', description: 'Screenshot after sending', validator: 'validateScreenshot', weight: 15 },
      { type: 'text_match', description: 'Message visible in thread', validator: 'validateTextMatch', weight: 35 },
      { type: 'timestamp', description: 'Action completed within timeout', validator: 'validateTimestamp', weight: 15 },
    ],
    optional: [
      { type: 'element_found', description: 'Sent indicator visible', validator: 'validateSentIndicator', weight: 0 },
    ],
    timeoutMs: 30000,
    retryAttempts: 2,
  },
  
  navigate: {
    actionType: 'navigate',
    required: [
      { type: 'url_match', description: 'URL matches expected', validator: 'validateURL', weight: 50 },
      { type: 'screenshot_after', description: 'Page loaded screenshot', validator: 'validateScreenshot', weight: 30 },
      { type: 'timestamp', description: 'Navigation within timeout', validator: 'validateTimestamp', weight: 20 },
    ],
    optional: [
      { type: 'element_found', description: 'Expected element present', validator: 'validateElement', weight: 0 },
    ],
    timeoutMs: 15000,
    retryAttempts: 3,
  },
  
  login_check: {
    actionType: 'login_check',
    required: [
      { type: 'element_found', description: 'Logged-in indicator found', validator: 'validateLoginIndicator', weight: 60 },
      { type: 'screenshot_after', description: 'Current state screenshot', validator: 'validateScreenshot', weight: 25 },
      { type: 'url_match', description: 'Not on login page', validator: 'validateNotLoginPage', weight: 15 },
    ],
    optional: [],
    timeoutMs: 10000,
    retryAttempts: 1,
  },
  
  sora_generate: {
    actionType: 'sora_generate',
    required: [
      { type: 'screenshot_before', description: 'Sora interface before', validator: 'validateScreenshot', weight: 15 },
      { type: 'element_found', description: 'Generation started indicator', validator: 'validateElement', weight: 20 },
      { type: 'screenshot_after', description: 'Generation complete/progress', validator: 'validateScreenshot', weight: 15 },
      { type: 'api_response', description: 'API confirmation', validator: 'validateAPIResponse', weight: 35 },
      { type: 'timestamp', description: 'Within expected duration', validator: 'validateTimestamp', weight: 15 },
    ],
    optional: [],
    timeoutMs: 300000, // 5 minutes for video generation
    retryAttempts: 1,
  },
};

/**
 * Minimum verification score to consider action successful
 */
export const MIN_VERIFICATION_SCORE = 80;

/**
 * Directory structure for proof storage
 */
export const PROOF_STORAGE = {
  baseDir: './data/proofs',
  screenshots: 'screenshots',
  dom: 'dom_snapshots',
  logs: 'action_logs',
};
