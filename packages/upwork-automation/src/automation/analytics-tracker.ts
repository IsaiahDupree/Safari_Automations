/**
 * Analytics Tracker - In-memory application analytics
 * Tracks job applications, views, and responses for analytics reporting
 */

export interface ApplicationRecord {
  jobId: string;
  jobTitle: string;
  appliedAt: string;
  viewed: boolean;
  viewedAt?: string;
  responded: boolean;
  respondedAt?: string;
  score: number;
  keywords: string[];
}

export interface AnalyticsSummary {
  totalApplications: number;
  viewRate: number;
  responseRate: number;
  applicationsThisWeek: number;
  averageScore: number;
  topKeywords: Array<{ keyword: string; count: number }>;
}

// In-memory application log
const applicationLog: ApplicationRecord[] = [];

// Track a new application
export function trackApplication(record: Omit<ApplicationRecord, 'viewed' | 'responded'>): void {
  applicationLog.push({
    ...record,
    viewed: false,
    responded: false,
  });
}

// Update application status (viewed or responded)
export function updateApplicationStatus(
  jobId: string,
  update: { viewed?: boolean; viewedAt?: string; responded?: boolean; respondedAt?: string }
): void {
  const record = applicationLog.find(r => r.jobId === jobId);
  if (record) {
    if (update.viewed !== undefined) {
      record.viewed = update.viewed;
      record.viewedAt = update.viewedAt;
    }
    if (update.responded !== undefined) {
      record.responded = update.responded;
      record.respondedAt = update.respondedAt;
    }
  }
}

// Get analytics summary
export function getAnalyticsSummary(): AnalyticsSummary {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const totalApplications = applicationLog.length;
  const viewedCount = applicationLog.filter(r => r.viewed).length;
  const respondedCount = applicationLog.filter(r => r.responded).length;
  const applicationsThisWeek = applicationLog.filter(
    r => new Date(r.appliedAt).getTime() > weekAgo
  ).length;

  const viewRate = totalApplications > 0 ? (viewedCount / totalApplications) * 100 : 0;
  const responseRate = totalApplications > 0 ? (respondedCount / totalApplications) * 100 : 0;

  const averageScore =
    totalApplications > 0
      ? applicationLog.reduce((sum, r) => sum + r.score, 0) / totalApplications
      : 0;

  // Count keywords
  const keywordCounts: Record<string, number> = {};
  for (const record of applicationLog) {
    for (const keyword of record.keywords) {
      keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
    }
  }

  // Sort and get top 10 keywords
  const topKeywords = Object.entries(keywordCounts)
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalApplications,
    viewRate: Math.round(viewRate * 100) / 100,
    responseRate: Math.round(responseRate * 100) / 100,
    applicationsThisWeek,
    averageScore: Math.round(averageScore * 100) / 100,
    topKeywords,
  };
}

// Get all application records (for debugging)
export function getAllApplications(): ApplicationRecord[] {
  return [...applicationLog];
}

// Clear all records (for testing)
export function clearApplicationLog(): void {
  applicationLog.length = 0;
}

// Seed with mock data for demo purposes
export function seedMockData(): void {
  const mockData: Array<Omit<ApplicationRecord, 'viewed' | 'responded'>> = [
    {
      jobId: 'job1',
      jobTitle: 'React Developer',
      appliedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      score: 85,
      keywords: ['React', 'TypeScript', 'Node.js'],
    },
    {
      jobId: 'job2',
      jobTitle: 'Full Stack Engineer',
      appliedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      score: 78,
      keywords: ['React', 'Python', 'PostgreSQL'],
    },
    {
      jobId: 'job3',
      jobTitle: 'Frontend Developer',
      appliedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      score: 92,
      keywords: ['React', 'TypeScript', 'CSS'],
    },
  ];

  for (const record of mockData) {
    trackApplication(record);
  }

  // Mark some as viewed/responded
  updateApplicationStatus('job1', { viewed: true, viewedAt: new Date().toISOString() });
  updateApplicationStatus('job2', {
    viewed: true,
    viewedAt: new Date().toISOString(),
    responded: true,
    respondedAt: new Date().toISOString(),
  });
}

// Initialize with mock data if empty
if (applicationLog.length === 0) {
  seedMockData();
}
