/**
 * Comment Logger - Database persistence for comment automation
 * 
 * Logs all comment activity to Supabase for analytics and tracking.
 */

export interface CommentLogEntry {
  platform: string;
  username: string;
  postUrl?: string;
  postContent?: string;
  commentText: string;
  success: boolean;
  error?: string;
  aiAnalysis?: {
    sentiment?: string;
    topics?: string[];
    tone?: string;
  };
  sessionId?: string;
  screenshotPath?: string;
}

export interface CommentLogResult {
  id: string;
  success: boolean;
  error?: string;
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gqjgxltroyysjoxswbmn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxamd4bHRyb3l5c2pveHN3Ym1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3OTg3OTAsImV4cCI6MjA4MDM3NDc5MH0.H4LfkcbGPrMDM3CCaI5hGE1JWm7OO-jEZOiNPdNzh_s';

export class CommentLogger {
  private supabaseUrl: string;
  private supabaseKey: string;
  private sessionId: string;

  constructor(options: { supabaseUrl?: string; supabaseKey?: string } = {}) {
    this.supabaseUrl = options.supabaseUrl || SUPABASE_URL;
    this.supabaseKey = options.supabaseKey || SUPABASE_KEY;
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Log a single comment to the database
   */
  async logComment(entry: CommentLogEntry): Promise<CommentLogResult> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/comment_logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          platform: entry.platform,
          username: entry.username,
          post_url: entry.postUrl,
          post_content: entry.postContent?.substring(0, 1000),
          comment_text: entry.commentText,
          success: entry.success,
          error: entry.error,
          ai_analysis: entry.aiAnalysis,
          session_id: entry.sessionId || this.sessionId,
          screenshot_path: entry.screenshotPath,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[DB] Failed to log comment:', errorText);
        return { id: '', success: false, error: errorText };
      }

      const data = await response.json() as { id: string }[];
      console.log(`[DB] ✅ Comment logged: ${data[0]?.id}`);
      return { id: data[0]?.id || '', success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[DB] Error logging comment:', errorMsg);
      return { id: '', success: false, error: errorMsg };
    }
  }

  /**
   * Log multiple comments from a multi-post session
   */
  async logSession(
    results: Array<{ success: boolean; username: string; comment: string; postUrl?: string; error?: string }>,
    platform: string = 'threads'
  ): Promise<{ logged: number; failed: number }> {
    let logged = 0;
    let failed = 0;

    for (const result of results) {
      const logResult = await this.logComment({
        platform,
        username: result.username,
        postUrl: result.postUrl,
        commentText: result.comment,
        success: result.success,
        error: result.error,
        sessionId: this.sessionId,
      });

      if (logResult.success) {
        logged++;
      } else {
        failed++;
      }
    }

    console.log(`[DB] Session logged: ${logged} success, ${failed} failed`);
    return { logged, failed };
  }

  /**
   * Get comment history from database
   */
  async getHistory(options: {
    platform?: string;
    limit?: number;
    sessionId?: string;
  } = {}): Promise<CommentLogEntry[]> {
    try {
      const { platform, limit = 50, sessionId } = options;
      
      let url = `${this.supabaseUrl}/rest/v1/comment_logs?order=created_at.desc&limit=${limit}`;
      if (platform) {
        url += `&platform=eq.${platform}`;
      }
      if (sessionId) {
        url += `&session_id=eq.${sessionId}`;
      }

      const response = await fetch(url, {
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
        },
      });

      if (!response.ok) {
        console.error('[DB] Failed to get history');
        return [];
      }

      const data = await response.json() as Array<{
        platform: string;
        username: string;
        post_url: string;
        post_content: string;
        comment_text: string;
        success: boolean;
        error: string;
        ai_analysis: { sentiment?: string; topics?: string[]; tone?: string };
        session_id: string;
        screenshot_path: string;
      }>;

      return data.map(row => ({
        platform: row.platform,
        username: row.username,
        postUrl: row.post_url,
        postContent: row.post_content,
        commentText: row.comment_text,
        success: row.success,
        error: row.error,
        aiAnalysis: row.ai_analysis,
        sessionId: row.session_id,
        screenshotPath: row.screenshot_path,
      }));
    } catch (error) {
      console.error('[DB] Error getting history:', error);
      return [];
    }
  }

  /**
   * Check if we have already commented on a specific post URL
   * STRICT RULE: Prevents double-commenting on posts
   */
  async hasCommented(postUrl: string, platform: string = 'instagram'): Promise<boolean> {
    try {
      // Normalize the URL (remove trailing slashes, query params)
      const normalizedUrl = postUrl.split('?')[0].replace(/\/+$/, '');
      
      const url = `${this.supabaseUrl}/rest/v1/comment_logs?platform=eq.${platform}&post_url=like.*${encodeURIComponent(normalizedUrl.split('/p/')[1] || '')}*&success=eq.true&select=id,post_url`;
      
      const response = await fetch(url, {
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
        },
      });

      if (!response.ok) {
        console.error('[DB] Failed to check for existing comment');
        return false; // Fail safe: allow commenting if check fails
      }

      const data = await response.json() as Array<{ id: string; post_url: string }>;
      
      if (data.length > 0) {
        console.log(`[DB] ⚠️ Already commented on: ${postUrl}`);
        console.log(`[DB]   Found ${data.length} existing comment(s)`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('[DB] Error checking for existing comment:', error);
      return false; // Fail safe
    }
  }

  /**
   * Get all post URLs we have successfully commented on
   */
  async getCommentedPostUrls(platform: string = 'instagram'): Promise<Set<string>> {
    try {
      const url = `${this.supabaseUrl}/rest/v1/comment_logs?platform=eq.${platform}&success=eq.true&select=post_url`;
      
      const response = await fetch(url, {
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
        },
      });

      if (!response.ok) {
        return new Set();
      }

      const data = await response.json() as Array<{ post_url: string }>;
      const urls = new Set<string>();
      
      for (const row of data) {
        if (row.post_url) {
          // Normalize: extract post ID
          const match = row.post_url.match(/\/p\/([^\/\?]+)/);
          if (match) {
            urls.add(match[1]);
          }
        }
      }
      
      console.log(`[DB] Loaded ${urls.size} previously commented post IDs`);
      return urls;
    } catch (error) {
      console.error('[DB] Error loading commented URLs:', error);
      return new Set();
    }
  }

  /**
   * Get stats for a platform
   */
  async getStats(platform: string = 'instagram'): Promise<{
    total: number;
    successful: number;
    failed: number;
    todayCount: number;
  }> {
    try {
      const headers = {
        'apikey': this.supabaseKey,
        'Authorization': `Bearer ${this.supabaseKey}`,
        'Prefer': 'count=exact',
      };
      const base = `${this.supabaseUrl}/rest/v1/comment_logs?platform=eq.${platform}&select=id`;
      const today = new Date().toISOString().split('T')[0];

      // Use HEAD requests with count=exact to avoid fetching all rows
      const [totalRes, successRes, todayRes] = await Promise.all([
        fetch(`${base}`, { headers, method: 'HEAD' }),
        fetch(`${base}&success=eq.true`, { headers, method: 'HEAD' }),
        fetch(`${base}&created_at=gte.${today}T00:00:00`, { headers, method: 'HEAD' }),
      ]);

      const total = parseInt(totalRes.headers.get('content-range')?.split('/')[1] || '0');
      const successful = parseInt(successRes.headers.get('content-range')?.split('/')[1] || '0');
      const todayCount = parseInt(todayRes.headers.get('content-range')?.split('/')[1] || '0');

      return {
        total,
        successful,
        failed: total - successful,
        todayCount,
      };
    } catch (error) {
      console.error('[DB] Error getting stats:', error);
      return { total: 0, successful: 0, failed: 0, todayCount: 0 };
    }
  }
}
