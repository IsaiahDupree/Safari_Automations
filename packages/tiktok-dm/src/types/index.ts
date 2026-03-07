/**
 * TikTok Automation Type Definitions
 */

export interface TikTokProfile {
  username: string;
  displayName: string;
  bio: string;
  followers: number;
  following: number;
  likes: number;
  verified: boolean;
  isPrivate: boolean;
}

export interface TikTokConversation {
  username: string;
  displayName: string;
  lastMessage: string;
  unread: boolean;
}

export interface TikTokMessage {
  sender: string;
  text: string;
  timestamp: string;
}

export interface ProspectCandidate {
  username: string;
  displayName: string;
  followers: number;
  videoViews?: number;
  score: number;
  qualifies: boolean;
  scoreBreakdown: ICPScoreBreakdown;
}

export interface ICPScoreBreakdown {
  bioKeywordScore: number;
  followerScore: number;
  engagementScore: number;
  verifiedPenalty: number;
  totalScore: number;
}

export interface ICPScore {
  score: number;
  qualifies: boolean;
  breakdown: ICPScoreBreakdown;
}

export interface DiscoverProspectsRequest {
  hashtags: string[];
  minFollowers?: number;
  maxFollowers?: number;
  maxCandidates?: number;
}

export interface SendDMRequest {
  username: string;
  text: string;
  dryRun?: boolean;
}

export interface AutomationConfig {
  instanceType: 'local' | 'remote';
  remoteUrl?: string;
  timeout?: number;
  actionDelay?: number;
  verbose?: boolean;
}
