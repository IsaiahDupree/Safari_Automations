/**
 * Supabase Client for Safari Automation
 * Handles persistence of commands, videos, events, and sessions
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CommandEnvelope, CommandState, EventEnvelope } from './types';

// Database types
export interface DbCommand {
  id?: string;
  command_id: string;
  idempotency_key?: string;
  correlation_id?: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  requester_service?: string;
  requester_instance?: string;
  target_session_id?: string;
  target_account_id?: string;
  target_platform?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  completed_at?: string;
}

export interface DbVideo {
  id?: string;
  command_id?: string;
  prompt: string;
  character: string;
  raw_path?: string;
  raw_size?: number;
  cleaned_path?: string;
  cleaned_size?: number;
  duration_seconds?: number;
  generation_time_ms?: number;
  status: 'pending' | 'generating' | 'ready' | 'cleaning' | 'cleaned' | 'failed';
  metadata?: Record<string, unknown>;
  created_at?: string;
  cleaned_at?: string;
}

export interface DbWatermarkRemoval {
  id?: string;
  video_id?: string;
  command_id?: string;
  input_path: string;
  output_path?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  file_size?: number;
  processing_time_ms?: number;
  error?: string;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
}

export interface DbEvent {
  id?: string;
  event_id: string;
  command_id?: string;
  correlation_id?: string;
  cursor: string;
  type: string;
  severity: string;
  payload: Record<string, unknown>;
  target_session_id?: string;
  target_account_id?: string;
  target_platform?: string;
  emitted_at: string;
  created_at?: string;
}

export interface DbSession {
  id?: string;
  session_id: string;
  platform?: string;
  status: 'active' | 'idle' | 'closed' | 'error';
  account_id?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  last_active_at?: string;
  closed_at?: string;
}

export class SafariSupabaseClient {
  private client: SupabaseClient;

  constructor(supabaseUrl?: string, supabaseKey?: string) {
    const url = supabaseUrl || process.env.SUPABASE_URL;
    const key = supabaseKey || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error('Supabase URL and key are required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.');
    }

    this.client = createClient(url, key);
  }

  // ============================================================================
  // COMMANDS
  // ============================================================================

  async insertCommand(command: CommandEnvelope): Promise<DbCommand | null> {
    const dbCommand: DbCommand = {
      command_id: command.command_id,
      idempotency_key: command.idempotency_key,
      correlation_id: command.correlation_id,
      type: command.type,
      status: 'CREATED',
      payload: command.payload,
      requester_service: command.requester?.service,
      requester_instance: command.requester?.instance_id,
      target_session_id: command.target?.session_id,
      target_account_id: command.target?.account_id,
      target_platform: command.target?.platform,
    };

    const { data, error } = await this.client
      .from('safari_commands')
      .insert(dbCommand)
      .select()
      .single();

    if (error) {
      console.error('[Supabase] Error inserting command:', error);
      return null;
    }

    return data;
  }

  async updateCommandStatus(
    commandId: string,
    status: string,
    result?: Record<string, unknown>,
    error?: string
  ): Promise<DbCommand | null> {
    const updates: Partial<DbCommand> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'RUNNING') {
      updates.started_at = new Date().toISOString();
    }

    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status)) {
      updates.completed_at = new Date().toISOString();
    }

    if (result) updates.result = result;
    if (error) updates.error = error;

    const { data, error: dbError } = await this.client
      .from('safari_commands')
      .update(updates)
      .eq('command_id', commandId)
      .select()
      .single();

    if (dbError) {
      console.error('[Supabase] Error updating command:', dbError);
      return null;
    }

    return data;
  }

  async getCommand(commandId: string): Promise<DbCommand | null> {
    const { data, error } = await this.client
      .from('safari_commands')
      .select('*')
      .eq('command_id', commandId)
      .single();

    if (error) {
      console.error('[Supabase] Error getting command:', error);
      return null;
    }

    return data;
  }

  async getCommandByIdempotencyKey(key: string): Promise<DbCommand | null> {
    const { data, error } = await this.client
      .from('safari_commands')
      .select('*')
      .eq('idempotency_key', key)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('[Supabase] Error getting command by idempotency key:', error);
    }

    return data || null;
  }

  // ============================================================================
  // VIDEOS
  // ============================================================================

  async insertVideo(video: Omit<DbVideo, 'id'>): Promise<DbVideo | null> {
    const { data, error } = await this.client
      .from('safari_videos')
      .insert(video)
      .select()
      .single();

    if (error) {
      console.error('[Supabase] Error inserting video:', error);
      return null;
    }

    return data;
  }

  async updateVideo(id: string, updates: Partial<DbVideo>): Promise<DbVideo | null> {
    const { data, error } = await this.client
      .from('safari_videos')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[Supabase] Error updating video:', error);
      return null;
    }

    return data;
  }

  async markVideoCleaned(
    id: string,
    cleanedPath: string,
    cleanedSize: number
  ): Promise<DbVideo | null> {
    return this.updateVideo(id, {
      cleaned_path: cleanedPath,
      cleaned_size: cleanedSize,
      status: 'cleaned',
      cleaned_at: new Date().toISOString(),
    });
  }

  async getVideosByCharacter(character: string, limit = 50): Promise<DbVideo[]> {
    const { data, error } = await this.client
      .from('safari_videos')
      .select('*')
      .eq('character', character)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Supabase] Error getting videos:', error);
      return [];
    }

    return data || [];
  }

  async getWatermarkFreeVideos(limit = 50): Promise<DbVideo[]> {
    const { data, error } = await this.client
      .from('watermark_free_videos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Supabase] Error getting watermark-free videos:', error);
      return [];
    }

    return data || [];
  }

  // ============================================================================
  // WATERMARK REMOVALS
  // ============================================================================

  async insertWatermarkRemoval(removal: Omit<DbWatermarkRemoval, 'id'>): Promise<DbWatermarkRemoval | null> {
    const { data, error } = await this.client
      .from('watermark_removals')
      .insert(removal)
      .select()
      .single();

    if (error) {
      console.error('[Supabase] Error inserting watermark removal:', error);
      return null;
    }

    return data;
  }

  async completeWatermarkRemoval(
    id: string,
    outputPath: string,
    fileSize: number,
    processingTimeMs: number
  ): Promise<DbWatermarkRemoval | null> {
    const { data, error } = await this.client
      .from('watermark_removals')
      .update({
        output_path: outputPath,
        file_size: fileSize,
        processing_time_ms: processingTimeMs,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[Supabase] Error completing watermark removal:', error);
      return null;
    }

    return data;
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  async insertEvent(event: EventEnvelope): Promise<DbEvent | null> {
    const dbEvent: DbEvent = {
      event_id: event.event_id,
      command_id: event.command_id,
      correlation_id: event.correlation_id,
      cursor: event.cursor,
      type: event.type,
      severity: event.severity,
      payload: event.payload,
      target_session_id: event.target?.session_id,
      target_account_id: event.target?.account_id,
      target_platform: event.target?.platform,
      emitted_at: event.emitted_at,
    };

    const { data, error } = await this.client
      .from('safari_events')
      .insert(dbEvent)
      .select()
      .single();

    if (error) {
      console.error('[Supabase] Error inserting event:', error);
      return null;
    }

    return data;
  }

  async getEventsByCommand(commandId: string): Promise<DbEvent[]> {
    const { data, error } = await this.client
      .from('safari_events')
      .select('*')
      .eq('command_id', commandId)
      .order('cursor', { ascending: true });

    if (error) {
      console.error('[Supabase] Error getting events:', error);
      return [];
    }

    return data || [];
  }

  async getEventsAfterCursor(cursor: string, limit = 100): Promise<DbEvent[]> {
    const { data, error } = await this.client
      .from('safari_events')
      .select('*')
      .gt('cursor', cursor)
      .order('cursor', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('[Supabase] Error getting events after cursor:', error);
      return [];
    }

    return data || [];
  }

  // ============================================================================
  // SESSIONS
  // ============================================================================

  async insertSession(session: Omit<DbSession, 'id'>): Promise<DbSession | null> {
    const { data, error } = await this.client
      .from('safari_sessions')
      .insert(session)
      .select()
      .single();

    if (error) {
      console.error('[Supabase] Error inserting session:', error);
      return null;
    }

    return data;
  }

  async updateSessionStatus(sessionId: string, status: DbSession['status']): Promise<DbSession | null> {
    const updates: Partial<DbSession> = {
      status,
      last_active_at: new Date().toISOString(),
    };

    if (status === 'closed') {
      updates.closed_at = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('safari_sessions')
      .update(updates)
      .eq('session_id', sessionId)
      .select()
      .single();

    if (error) {
      console.error('[Supabase] Error updating session:', error);
      return null;
    }

    return data;
  }

  async getActiveSessions(): Promise<DbSession[]> {
    const { data, error } = await this.client
      .from('safari_sessions')
      .select('*')
      .eq('status', 'active')
      .order('last_active_at', { ascending: false });

    if (error) {
      console.error('[Supabase] Error getting active sessions:', error);
      return [];
    }

    return data || [];
  }

  // ============================================================================
  // ANALYTICS
  // ============================================================================

  async getCommandPerformance(): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client
      .from('safari_command_performance')
      .select('*');

    if (error) {
      console.error('[Supabase] Error getting command performance:', error);
      return [];
    }

    return data || [];
  }

  async getRecentVideoSummary(): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client
      .from('recent_video_summary')
      .select('*');

    if (error) {
      console.error('[Supabase] Error getting video summary:', error);
      return [];
    }

    return data || [];
  }

  // ============================================================================
  // UTILITY
  // ============================================================================

  async getCommandDetails(commandId: string): Promise<{
    command: DbCommand | null;
    videos: DbVideo[];
    events: DbEvent[];
  }> {
    const { data, error } = await this.client
      .rpc('get_command_details', { p_command_id: commandId });

    if (error || !data || data.length === 0) {
      console.error('[Supabase] Error getting command details:', error);
      return { command: null, videos: [], events: [] };
    }

    return {
      command: data[0].command,
      videos: data[0].videos || [],
      events: data[0].events || [],
    };
  }
}

// Singleton instance
let instance: SafariSupabaseClient | null = null;

export function getSupabaseClient(): SafariSupabaseClient {
  if (!instance) {
    instance = new SafariSupabaseClient();
  }
  return instance;
}

export function initSupabaseClient(url: string, key: string): SafariSupabaseClient {
  instance = new SafariSupabaseClient(url, key);
  return instance;
}
