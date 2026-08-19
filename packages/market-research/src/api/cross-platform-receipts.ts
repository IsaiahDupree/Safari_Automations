export type CrossPlatformJobStatus = 'completed' | 'degraded' | 'failed';

export interface PlatformResearchReceipt {
  platform: string;
  status: 'completed' | 'failed';
  nicheCount: number;
  itemCount: number;
  error?: string;
}

const CONTENT_ARRAY_KEYS = ['tweets', 'videos', 'posts', 'reels', 'threads', 'items'];

function countContentItems(results: unknown[]): number {
  return results.reduce<number>((total, result) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return total;
    const record = result as Record<string, unknown>;
    const content = CONTENT_ARRAY_KEYS.find((key) => Array.isArray(record[key]));
    return total + (content ? (record[content] as unknown[]).length : 0);
  }, 0);
}

export function buildPlatformResearchReceipt(
  platform: string,
  result: unknown,
): PlatformResearchReceipt {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const error = (result as Record<string, unknown>).error;
    if (typeof error === 'string' && error.trim()) {
      return { platform, status: 'failed', nicheCount: 0, itemCount: 0, error };
    }
  }

  const results = Array.isArray(result) ? result : [];
  return {
    platform,
    status: 'completed',
    nicheCount: results.length,
    itemCount: countContentItems(results),
  };
}

export function summarizeCrossPlatformResults(
  platforms: string[],
  results: Record<string, unknown>,
): { status: CrossPlatformJobStatus; receipts: PlatformResearchReceipt[] } {
  const receipts = platforms.map((platform) => buildPlatformResearchReceipt(platform, results[platform]));
  const failures = receipts.filter((receipt) => receipt.status === 'failed').length;
  const status: CrossPlatformJobStatus = failures === 0
    ? 'completed'
    : failures === receipts.length
      ? 'failed'
      : 'degraded';
  return { status, receipts };
}
