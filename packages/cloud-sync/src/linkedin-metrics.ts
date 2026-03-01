/**
 * LinkedIn Computed Metrics
 * Calculates derived metrics from LinkedIn data in Supabase:
 *  - Connection accept rate (sent invitations that became connections)
 *  - Response rate (DMs sent vs replies received)
 *  - Post engagement averages
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface LinkedInMetrics {
  invitations: {
    totalSent: number;
    totalReceived: number;
    pendingSent: number;
    pendingReceived: number;
    acceptRate: number | null; // null if no data
  };
  dms: {
    totalConversations: number;
    outboundMessages: number;
    inboundMessages: number;
    responseRate: number | null; // inbound / outbound
    avgLeadScore: number | null;
  };
  posts: {
    totalPosts: number;
    avgLikes: number;
    avgComments: number;
    avgShares: number;
    topPost: { post_id: string; likes: number; url: string } | null;
  };
  computedAt: string;
}

export async function computeLinkedInMetrics(client: SupabaseClient): Promise<LinkedInMetrics> {
  // === Invitation metrics ===
  const { data: invitations } = await client
    .from('linkedin_invitations')
    .select('direction, status');

  const totalSent = invitations?.filter(i => i.direction === 'sent').length || 0;
  const totalReceived = invitations?.filter(i => i.direction === 'received').length || 0;
  const pendingSent = invitations?.filter(i => i.direction === 'sent' && i.status === 'pending').length || 0;
  const pendingReceived = invitations?.filter(i => i.direction === 'received' && i.status === 'pending').length || 0;
  const acceptedSent = invitations?.filter(i => i.direction === 'sent' && i.status === 'accepted').length || 0;

  // Accept rate: accepted / total sent (only if we have enough data)
  const acceptRate = totalSent >= 3 ? Math.round((acceptedSent / totalSent) * 100) : null;

  // === DM metrics ===
  const { data: dms } = await client
    .from('platform_dms')
    .select('direction, lead_score')
    .eq('platform', 'linkedin');

  const outboundMessages = dms?.filter(d => d.direction === 'outbound').length || 0;
  const inboundMessages = dms?.filter(d => d.direction === 'inbound').length || 0;
  const totalConversations = dms?.length || 0;

  // Response rate: inbound replies / outbound messages
  const responseRate = outboundMessages >= 2
    ? Math.round((inboundMessages / outboundMessages) * 100)
    : null;

  // Average lead score
  const scores = dms?.map(d => d.lead_score).filter((s): s is number => s !== null && s !== undefined) || [];
  const avgLeadScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;

  // === Post metrics ===
  const { data: posts } = await client
    .from('post_stats')
    .select('post_id, post_url, likes, comments, shares')
    .eq('platform', 'linkedin')
    .order('synced_at', { ascending: false })
    .limit(20);

  const totalPosts = posts?.length || 0;
  const avgLikes = totalPosts > 0
    ? Math.round((posts?.reduce((s, p) => s + (p.likes || 0), 0) || 0) / totalPosts)
    : 0;
  const avgComments = totalPosts > 0
    ? Math.round((posts?.reduce((s, p) => s + (p.comments || 0), 0) || 0) / totalPosts)
    : 0;
  const avgShares = totalPosts > 0
    ? Math.round((posts?.reduce((s, p) => s + (p.shares || 0), 0) || 0) / totalPosts)
    : 0;

  // Top post by likes
  let topPost: { post_id: string; likes: number; url: string } | null = null;
  if (posts?.length) {
    const best = posts.reduce((top, p) => (p.likes || 0) > (top.likes || 0) ? p : top, posts[0]);
    if (best.likes > 0) {
      topPost = { post_id: best.post_id, likes: best.likes, url: best.post_url };
    }
  }

  return {
    invitations: { totalSent, totalReceived, pendingSent, pendingReceived, acceptRate },
    dms: { totalConversations, outboundMessages, inboundMessages, responseRate, avgLeadScore },
    posts: { totalPosts, avgLikes, avgComments, avgShares, topPost },
    computedAt: new Date().toISOString(),
  };
}
