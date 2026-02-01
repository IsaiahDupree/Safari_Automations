/**
 * CRM Client Types
 * 
 * These types define the interface for CRM operations.
 * When CRM is offloaded to its own repo, this client will
 * communicate with the CRM API instead of directly with the database.
 */

export interface Contact {
  id: string;
  platform: 'tiktok' | 'instagram' | 'twitter';
  username: string;
  displayName?: string;
  bio?: string;
  followerCount?: number;
  followingCount?: number;
  profileUrl?: string;
  avatarUrl?: string;
  tags: string[];
  notes?: string;
  relationshipScore?: number;
  lastInteraction?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Interaction {
  id: string;
  contactId: string;
  type: 'dm_sent' | 'dm_received' | 'comment' | 'like' | 'follow' | 'mention';
  platform: 'tiktok' | 'instagram' | 'twitter';
  content?: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  targetTags: string[];
  messageTemplate: string;
  platforms: ('tiktok' | 'instagram' | 'twitter')[];
  sentCount: number;
  responseCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CRMConfig {
  apiUrl: string;
  timeout: number;
}

export const DEFAULT_CRM_CONFIG: CRMConfig = {
  apiUrl: 'http://localhost:3020',
  timeout: 30000,
};
