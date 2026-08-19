import { describe, expect, it } from 'vitest';

import {
  buildPlatformResearchReceipt,
  summarizeCrossPlatformResults,
} from '../../packages/market-research/src/api/cross-platform-receipts.js';

describe('cross-platform research receipts', () => {
  it("counts platform results using each researcher's content collection", () => {
    expect(buildPlatformResearchReceipt('twitter', [
      { niche: 'one', tweets: [{ id: '1' }, { id: '2' }] },
      { niche: 'two', tweets: [{ id: '3' }] },
    ])).toEqual({
      platform: 'twitter',
      status: 'completed',
      nicheCount: 2,
      itemCount: 3,
    });

    expect(buildPlatformResearchReceipt('tiktok', [
      { niche: 'one', videos: [{ id: '1' }] },
    ])).toMatchObject({ nicheCount: 1, itemCount: 1 });
  });

  it('marks a mixed run degraded and preserves the platform error', () => {
    const summary = summarizeCrossPlatformResults(
      ['twitter', 'tiktok'],
      {
        twitter: { error: 'Safari timed out' },
        tiktok: [{ niche: 'GTA 6 leaks', videos: [{ id: 'video-1' }] }],
      },
    );

    expect(summary.status).toBe('degraded');
    expect(summary.receipts).toEqual([
      {
        platform: 'twitter',
        status: 'failed',
        nicheCount: 0,
        itemCount: 0,
        error: 'Safari timed out',
      },
      {
        platform: 'tiktok',
        status: 'completed',
        nicheCount: 1,
        itemCount: 1,
      },
    ]);
  });

  it('marks a run failed only when every requested platform fails', () => {
    const summary = summarizeCrossPlatformResults(
      ['instagram', 'facebook'],
      {
        instagram: { error: 'Instagram unavailable' },
        facebook: { error: 'Facebook unavailable' },
      },
    );

    expect(summary.status).toBe('failed');
  });
});
