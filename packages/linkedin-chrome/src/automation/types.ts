export interface LinkedInProfile {
  name: string;
  headline?: string;
  location?: string;
  about?: string;
  connections?: string;
  followers?: string;
  profileUrl: string;
  profileId?: string;
  experience?: Array<{ title: string; company: string; duration?: string }>;
  education?: Array<{ school: string; degree?: string; years?: string }>;
  skills?: string[];
  verified?: boolean;
}

export interface LinkedInConversation {
  name: string;
  lastMessage?: string;
  timestamp?: string;
  unread: boolean;
  profileUrl?: string;
  conversationUrl?: string;
}

export interface LinkedInPost {
  author: string;
  authorUrl?: string;
  text: string;
  likes?: number;
  comments?: number;
  reposts?: number;
  postUrl?: string;
  timestamp?: string;
}

export interface LinkedInComment {
  author: string;
  authorUrl?: string;
  text: string;
  likes?: number;
  timestamp?: string;
}

export interface LinkedInSearchResult {
  name: string;
  headline?: string;
  location?: string;
  profileUrl: string;
  connectionDegree?: string;
}

export interface ConnectionRequest {
  profileUrl: string;
  note?: string;
  skipIfConnected?: boolean;
}

export interface IcpCriteria {
  targetTitle?: string;
  targetCompany?: string;
  targetIndustry?: string;
  targetLocation?: string;
}

export interface ScoreResult {
  totalScore: number;
  reason: string;
  breakdown: Record<string, number>;
}

export interface NetworkRequest {
  url: string;
  method: string;
  status?: number;
  resourceType?: string;
  responseSize?: number;
  timing?: number;
}
