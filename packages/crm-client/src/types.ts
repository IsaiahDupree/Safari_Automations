/**
 * CRM Client Types
 * 
 * These types define the interface for CRM operations.
 * When CRM is offloaded to its own repo, this client will
 * communicate with the CRM API instead of directly with the database.
 */

export type Platform =
  | 'instagram' | 'tiktok' | 'twitter' | 'youtube'
  | 'linkedin' | 'threads' | 'facebook' | 'pinterest'
  | 'bluesky' | 'upwork' | 'email' | 'phone' | 'other';

export interface PlatformAccount {
  id: string;
  contact_id: string;
  platform: Platform;
  platform_user_id?: string;
  username: string;
  display_name?: string;
  profile_url?: string;
  avatar_url?: string;
  follower_count?: number;
  following_count?: number;
  is_verified: boolean;
  is_primary: boolean;
}

export interface Contact {
  id: string;
  display_name?: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  bio?: string;
  relationship_score: number;
  pipeline_stage: string;
  preferred_cadence: string;
  tags: string[];
  notes?: string;
  revcat_app_user_id?: string;
  revcat_subscriber_status: string;
  revcat_total_revenue: number;
  total_messages_sent: number;
  total_messages_received: number;
  total_interactions: number;
  first_touch_at?: string;
  last_message_at?: string;
  last_interaction_at?: string;
  created_at: string;
  updated_at: string;
  // Joined
  platform_accounts?: PlatformAccount[];
  // Legacy compat
  platform?: Platform;
  username?: string;
  displayName?: string;
  followerCount?: number;
  followingCount?: number;
  profileUrl?: string;
  avatarUrl?: string;
  relationshipScore?: number;
  lastInteraction?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Interaction {
  id: string;
  contact_id: string;
  type: string;
  platform?: string;
  summary?: string;
  outcome?: string;
  sentiment?: 'positive' | 'negative' | 'neutral' | 'curious';
  value_delivered: boolean;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
  // Legacy compat
  contactId?: string;
  content?: string;
  timestamp?: Date;
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  type: string;
  status: string;
  target_criteria: Record<string, unknown>;
  message_templates: Record<string, unknown>[];
  platforms: string[];
  stats: { sent: number; replied: number; converted: number; failed: number };
  scheduled_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CRMConfig {
  apiUrl: string;
  timeout: number;
}

export const DEFAULT_CRM_CONFIG: CRMConfig = {
  apiUrl: 'http://localhost:3020',
  timeout: 30000,
};
