/**
 * Core CRM Types and Interfaces
 * These types are platform-agnostic and can be used with any database backend.
 */

// === CONTACT TYPES ===

export interface Contact {
  id: string;
  instagram_username: string;
  instagram_user_id?: string;
  display_name?: string;
  bio?: string;
  profile_pic_url?: string;
  follower_count?: number;
  following_count?: number;
  is_verified?: boolean;
  
  // Relationship fields
  relationship_score: number;
  pipeline_stage: PipelineStage;
  what_theyre_building?: string;
  current_friction?: string;
  their_definition_of_win?: string;
  preferred_cadence?: CadenceType;
  constraints?: string;
  do_not_do?: string;
  
  // Trust signals
  asks_opinion: boolean;
  shares_updates: boolean;
  has_referred_others: boolean;
  
  // Fit signals
  fit_signals: string[];
  
  // Activity tracking
  first_touch_at?: string;
  last_message_at?: string;
  total_messages_sent: number;
  total_messages_received: number;
  
  // Metadata
  created_at: string;
  updated_at: string;
}

export type PipelineStage = 
  | 'first_touch'
  | 'context_captured'
  | 'micro_win_delivered'
  | 'cadence_established'
  | 'trust_signals'
  | 'fit_repeats'
  | 'permissioned_offer'
  | 'post_win_expansion';

export type CadenceType = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'as_needed';

// === CONVERSATION TYPES ===

export interface Conversation {
  id: string;
  contact_id: string;
  thread_id?: string;
  tab_type: TabType;
  is_active: boolean;
  last_message_preview?: string;
  last_message_at?: string;
  unread_count: number;
  created_at: string;
  updated_at: string;
}

export type TabType = 'primary' | 'general' | 'requests' | 'hidden_requests';

export interface Message {
  id: string;
  conversation_id: string;
  contact_id: string;
  message_text?: string;
  message_type: MessageType;
  media_url?: string;
  is_outbound: boolean;
  sent_by_automation: boolean;
  sent_at: string;
  read_at?: string;
}

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'link' | 'story_reply';

// === SCORING TYPES ===

export interface RelationshipScore {
  overall: number;
  recency: number;
  resonance: number;
  needClarity: number;
  valueDelivered: number;
  reliability: number;
  consent: number;
}

export interface ScoreWeights {
  recency: number;
  resonance: number;
  needClarity: number;
  valueDelivered: number;
  reliability: number;
  consent: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  recency: 0.20,
  resonance: 0.20,
  needClarity: 0.15,
  valueDelivered: 0.20,
  reliability: 0.15,
  consent: 0.10,
};

// === COACHING TYPES ===

export interface CoachingResult {
  overallScore: number;
  curiosityScore: number;
  valueScore: number;
  permissionScore: number;
  personalizationScore: number;
  pacingScore: number;
  strengths: string[];
  improvements: string[];
  nextActionSuggestion: string;
}

export interface CoachingRule {
  id: string;
  category: CoachingCategory;
  name: string;
  positive_pattern?: string;
  negative_pattern?: string;
  weight: number;
  feedback_if_present?: string;
  feedback_if_missing?: string;
}

export type CoachingCategory = 'curiosity' | 'value' | 'permission' | 'personalization' | 'pacing';

// === ACTION TYPES ===

export type ActionLane = 'friendship' | 'service' | 'offer' | 'retention' | 'rewarm';

export interface ActionTemplate {
  id: string;
  lane: ActionLane;
  stage?: PipelineStage | 'any';
  template_text: string;
  description: string;
  priority: number;
}

export interface SuggestedAction {
  id: string;
  contact_id: string;
  template_id: string;
  priority: number;
  reason: string;
  status: ActionStatus;
  scheduled_for?: string;
  completed_at?: string;
}

export type ActionStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';

// === FIT SIGNAL TYPES ===

export interface FitSignalConfig {
  id: string;
  product: string;
  signal_keywords: string[];
  min_matches: number;
  offer_template: string;
}

// === ANALYTICS TYPES ===

export interface PipelineStats {
  totalContacts: number;
  byStage: Record<PipelineStage, number>;
  avgScore: number;
  highScorers: number;
  midScorers: number;
  lowScorers: number;
}

export interface ActivityMetrics {
  messagesSent: number;
  messagesReceived: number;
  automationMessages: number;
  valueDelivered: number;
  pendingActions: number;
}

// === REPLY SUGGESTION TYPES ===

export interface ReplySuggestion {
  type: ActionLane;
  template: string;
  personalized: string;
  reason: string;
  priority: number;
}

export interface ConversationContext {
  sentiment: 'positive' | 'negative' | 'neutral' | 'curious';
  topic: string;
  needsResponse: boolean;
  lastMessageDaysAgo: number;
}
