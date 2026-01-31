/**
 * Database Clients
 * Manages connections to CRM and MediaPoster Supabase databases.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface DatabaseConfig {
  url: string;
  key: string;
}

// ===== CRM Database =====

let crmClient: SupabaseClient | null = null;

export function initCRMDatabase(config: DatabaseConfig): SupabaseClient {
  crmClient = createClient(config.url, config.key);
  return crmClient;
}

export function getCRMDatabase(): SupabaseClient {
  if (!crmClient) {
    throw new Error('CRM database not initialized. Call initCRMDatabase first.');
  }
  return crmClient;
}

// ===== MediaPoster Database =====

let mediaPosterClient: SupabaseClient | null = null;

export function initMediaPosterDatabase(config: DatabaseConfig): SupabaseClient {
  mediaPosterClient = createClient(config.url, config.key);
  return mediaPosterClient;
}

export function getMediaPosterDatabase(): SupabaseClient {
  if (!mediaPosterClient) {
    throw new Error('MediaPoster database not initialized. Call initMediaPosterDatabase first.');
  }
  return mediaPosterClient;
}

export function isMediaPosterConfigured(): boolean {
  return mediaPosterClient !== null;
}

// ===== CRM Database Operations =====

export interface Contact {
  id: string;
  instagram_username: string;
  display_name?: string;
  relationship_score: number;
  pipeline_stage: string;
  what_theyre_building?: string;
  current_friction?: string;
  fit_signals: string[];
  last_message_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  contact_id: string;
  message_text: string;
  message_type: string;
  is_outbound: boolean;
  sent_by_automation: boolean;
  sent_at: string;
}

export async function getContacts(limit: number = 50): Promise<Contact[]> {
  const { data, error } = await getCRMDatabase()
    .from('instagram_contacts')
    .select('*')
    .order('relationship_score', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function getContactByUsername(username: string): Promise<Contact | null> {
  const { data, error } = await getCRMDatabase()
    .from('instagram_contacts')
    .select('*')
    .eq('instagram_username', username)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function upsertContact(contact: Partial<Contact> & { instagram_username: string }): Promise<Contact> {
  const { data, error } = await getCRMDatabase()
    .from('instagram_contacts')
    .upsert(contact, { onConflict: 'instagram_username' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateContactScore(id: string, score: number): Promise<void> {
  const { error } = await getCRMDatabase()
    .from('instagram_contacts')
    .update({ relationship_score: score, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

export async function getMessages(contactId: string, limit: number = 50): Promise<Message[]> {
  const { data, error } = await getCRMDatabase()
    .from('instagram_messages')
    .select('*')
    .eq('contact_id', contactId)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function insertMessage(message: Omit<Message, 'id'>): Promise<Message> {
  const { data, error } = await getCRMDatabase()
    .from('instagram_messages')
    .insert(message)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ===== MediaPoster Database Operations =====

export interface Video {
  id: string;
  title: string;
  description?: string;
  file_path: string;
  platform: string;
  status: string;
  scheduled_at?: string;
  posted_at?: string;
  created_at: string;
}

export interface ScheduledPost {
  id: string;
  video_id: string;
  platform: string;
  scheduled_time: string;
  status: string;
  caption?: string;
}

export async function getVideos(limit: number = 20): Promise<Video[]> {
  if (!isMediaPosterConfigured()) return [];

  const { data, error } = await getMediaPosterDatabase()
    .from('videos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[MediaPoster] Failed to fetch videos:', error.message);
    return [];
  }
  return data || [];
}

export async function getScheduledPosts(fromDate?: Date): Promise<ScheduledPost[]> {
  if (!isMediaPosterConfigured()) return [];

  let query = getMediaPosterDatabase()
    .from('scheduled_posts')
    .select('*')
    .eq('status', 'pending')
    .order('scheduled_time', { ascending: true });

  if (fromDate) {
    query = query.gte('scheduled_time', fromDate.toISOString());
  }

  const { data, error } = await query.limit(50);

  if (error) {
    console.warn('[MediaPoster] Failed to fetch schedule:', error.message);
    return [];
  }
  return data || [];
}

export async function getRecentlyPosted(hours: number = 24): Promise<Video[]> {
  if (!isMediaPosterConfigured()) return [];

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data, error } = await getMediaPosterDatabase()
    .from('videos')
    .select('*')
    .eq('status', 'posted')
    .gte('posted_at', since)
    .order('posted_at', { ascending: false });

  if (error) {
    console.warn('[MediaPoster] Failed to fetch recent posts:', error.message);
    return [];
  }
  return data || [];
}
