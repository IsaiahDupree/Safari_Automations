import { describe, expect, it } from 'vitest';

import { FacebookResearcher } from '../../packages/facebook-comments/src/automation/facebook-researcher.js';
import { InstagramResearcher } from '../../packages/instagram-comments/src/automation/instagram-researcher.js';
import { ThreadsResearcher } from '../../packages/threads-comments/src/automation/threads-researcher.js';
import { TikTokResearcher } from '../../packages/tiktok-comments/src/automation/tiktok-researcher.js';
import {
  TwitterResearcher,
  researchRelevance,
} from '../../packages/twitter-comments/src/automation/twitter-researcher.js';

describe('trend research query mode', () => {
  it('keeps current-event queries free of business-niche suffixes', () => {
    const niche = 'Tupac autopsy';
    const queries = {
      twitter: new TwitterResearcher({ queryMode: 'trend' }).buildSearchQueries(niche),
      threads: new ThreadsResearcher({ queryMode: 'trend' }).buildSearchQueries(niche),
      instagram: new InstagramResearcher({ queryMode: 'trend' }).buildSearchQueries(niche),
      facebook: new FacebookResearcher({ queryMode: 'trend' }).buildSearchQueries(niche),
      tiktok: new TikTokResearcher({ queryMode: 'trend' }).buildSearchQueries(niche),
    };

    for (const platformQueries of Object.values(queries)) {
      expect(platformQueries.length).toBeGreaterThan(0);
      expect(platformQueries.join(' ').toLowerCase()).not.toMatch(/tips|strategy|community|tutorial/);
    }
    expect(queries.twitter).toContain('"Tupac autopsy"');
    expect(queries.instagram).toContain('tupacautopsy');
    expect(queries.tiktok).toContain('#Tupacautopsy');
  });

  it('routes Instagram trend research directly to keyword explore', () => {
    const researcher = new InstagramResearcher({ queryMode: 'trend' });

    expect(researcher.buildSearchPlan('Colorado bear car lock warning')).toEqual({
      mode: 'explore',
      queries: ['Colorado bear car lock warning'],
    });
  });

  it('rejects a prior-query result while retaining an on-topic result', () => {
    expect(researchRelevance(
      'Tupac Shakur murder trial opening statements and autopsy evidence',
      'CBSNews',
      'Tupac autopsy',
    ).accepted).toBe(true);
    expect(researchRelevance(
      'Roblox Wonderland gameplay review',
      'GamingChannel',
      'Tupac autopsy',
    ).accepted).toBe(false);
    expect(researchRelevance(
      'Outshine fruit bars recalled after contamination warning',
      'ConsumerNews',
      'Hello Kitty Godzilla Happy Meal',
    ).accepted).toBe(false);
    expect(researchRelevance(
      'Hello Kitty and Godzilla arrive in a new Happy Meal promotion',
      'FoodNews',
      'Hello Kitty Godzilla Happy Meal',
    ).accepted).toBe(true);
  });
});
