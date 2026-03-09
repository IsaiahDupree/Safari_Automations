export type ProspectStage =
  | 'discovered'
  | 'connection_sent'
  | 'connected'
  | 'first_dm_sent'
  | 'replied'
  | 'converted'
  | 'opted_out';

export interface Prospect {
  id: string;
  profileUrl: string;
  name: string;
  headline: string;
  location: string;
  connectionDegree: string;
  stage: ProspectStage;
  score: number;
  scoreDetails?: {
    profileUrl: string;
    totalScore: number;
    factors: {
      titleMatch: number;
      companyMatch: number;
      locationMatch: number;
      connectionProximity: number;
      activityLevel: number;
    };
    recommendation: string;
    reason: string;
  };
  offer?: string;
  campaign?: string;
  discoveredAt: string;
  connectionSentAt: string | null;
  connectedAt: string | null;
  firstDmSentAt: string | null;
  lastMessageSentAt: string | null;
  lastReplyAt: string | null;
  nextFollowUpAt: string | null;
  lastCheckedAt: string | null;
  connectionNote: string | null;
  messagesSent: Array<{
    sentAt: string;
    messageType: string;
    content: string;
  }>;
  messagesReceived: Array<{
    receivedAt: string;
    content: string;
  }>;
  followUpCount: number;
  tags: string[];
  notes: string;
}

export interface Campaign {
  id: string;
  name: string;
  offer: string;
  search: {
    keywords: string;
    location: string;
    connectionDegree: string;
  };
  targetTitles: string[];
  targetLocations: string[];
  minScore: number;
  templates: {
    connectionNote: string;
    firstDm: string;
    followUp1: string;
    followUp2: string;
    followUp3: string;
  };
  timing: {
    afterConnectedHours: number;
    followUp1Hours: number;
    followUp2Hours: number;
    followUp3Hours: number;
    giveUpAfterHours: number;
  };
  maxProspectsPerRun: number;
  createdAt: string;
}

export interface Stats {
  totalProspects: number;
  byStage: Record<ProspectStage, number>;
  connectionRate: number;
  replyRate: number;
  conversionRate: number;
  averageScore: number;
  topLocations: Array<{ location: string; count: number }>;
}
