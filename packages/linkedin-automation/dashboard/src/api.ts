import type { Prospect, Campaign, Stats } from './types';

const API_BASE = 'http://localhost:3105/api/linkedin/outreach';
const AUTH_TOKEN = 'test-token-12345';

const getHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${AUTH_TOKEN}`,
});

export async function fetchProspects(filters?: {
  stage?: string;
  minScore?: number;
  location?: string;
}): Promise<Prospect[]> {
  const params = new URLSearchParams();
  if (filters?.stage) params.append('stage', filters.stage);
  if (filters?.minScore !== undefined) params.append('minScore', filters.minScore.toString());
  if (filters?.location) params.append('location', filters.location);

  const url = `${API_BASE}/prospects${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) throw new Error('Failed to fetch prospects');
  const data = await response.json();
  return data.prospects || [];
}

export async function fetchCampaigns(): Promise<Campaign[]> {
  const response = await fetch(`${API_BASE}/campaigns`, { headers: getHeaders() });
  if (!response.ok) throw new Error('Failed to fetch campaigns');
  const data = await response.json();
  return data.campaigns || [];
}

export async function fetchStats(): Promise<Stats> {
  const response = await fetch(`${API_BASE}/stats`, { headers: getHeaders() });
  if (!response.ok) throw new Error('Failed to fetch stats');
  return response.json();
}

export async function runOutreachCycle(campaignId: string): Promise<any> {
  const response = await fetch(`${API_BASE}/campaigns/${campaignId}/run`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!response.ok) throw new Error('Failed to run outreach cycle');
  return response.json();
}
