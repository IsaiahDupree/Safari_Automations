/**
 * Platform Poller Registry
 */
export { BasePoller } from './base-poller';
export { InstagramPoller } from './instagram-poller';
export { TwitterPoller } from './twitter-poller';
export { TikTokPoller } from './tiktok-poller';
export { ThreadsPoller } from './threads-poller';
export { LinkedInPoller } from './linkedin-poller';

import { Platform } from '../types';
import { BasePoller } from './base-poller';
import { InstagramPoller } from './instagram-poller';
import { TwitterPoller } from './twitter-poller';
import { TikTokPoller } from './tiktok-poller';
import { ThreadsPoller } from './threads-poller';
import { LinkedInPoller } from './linkedin-poller';

const pollerMap: Record<Platform, () => BasePoller> = {
  instagram: () => new InstagramPoller(),
  twitter: () => new TwitterPoller(),
  tiktok: () => new TikTokPoller(),
  threads: () => new ThreadsPoller(),
  linkedin: () => new LinkedInPoller(),
};

export function getPoller(platform: Platform): BasePoller {
  return pollerMap[platform]();
}

export function getAllPollers(platforms?: Platform[]): BasePoller[] {
  const list = platforms || (['instagram', 'twitter', 'tiktok', 'threads', 'linkedin'] as Platform[]);
  return list.map(p => pollerMap[p]());
}
