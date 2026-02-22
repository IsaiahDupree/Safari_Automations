/**
 * Content Packager
 * 
 * Transforms market research data (FB, IG, Meta Ad Library) into standardized
 * ContentPackages that can be consumed by a Remotion-based content recreation server.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  ContentPackage,
  ContentPackageBatch,
  ContentAnalysis,
  ContentFormat,
  ContentTone,
  MediaManifest,
  MediaAsset,
  PerformanceMetrics,
  RenderSpec,
  RenderStyle,
  RecreationInstructions,
  RequiredApi,
  SourcePlatform,
  SourceReference,
  TargetPlatform,
} from './types.js';

// ─── Config ──────────────────────────────────────────────────

const RESEARCH_BASE = path.join(process.env.HOME || '~', 'market-research');
const FB_POSTS_DIR = path.join(RESEARCH_BASE, 'facebook/posts');
const IG_POSTS_DIR = path.join(RESEARCH_BASE, 'instagram/posts');
const AD_LIBRARY_DIR = path.join(RESEARCH_BASE, 'meta-ad-library/ads');
const AD_BRIEFS_DIR = path.join(RESEARCH_BASE, 'ad-briefs');
const CREATIVE_RADAR_DIR = path.join(RESEARCH_BASE, 'creative-radar');
const OUTPUT_DIR = path.join(RESEARCH_BASE, 'content-packages');

// ─── Helpers ─────────────────────────────────────────────────

function readJsonFile(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function extractHook(text: string): string {
  if (!text) return '';
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  return lines[0]?.trim().substring(0, 200) || '';
}

function extractCta(text: string): string {
  if (!text) return '';
  const ctaPatterns = [
    /(?:link in bio|click (?:the )?link|shop now|learn more|sign up|download|get started|try (?:it )?(?:now|free)|visit|subscribe|follow|save this|share with|comment|tag a friend|dm (?:me|us))[.!]*/gi,
  ];
  for (const pattern of ctaPatterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const last = lines[lines.length - 1]?.trim() || '';
  if (last.length < 80 && (last.includes('👇') || last.includes('⬇') || last.includes('🔗') || last.includes('💬'))) {
    return last;
  }
  return '';
}

function extractBody(text: string, hook: string, cta: string): string {
  let body = text;
  if (hook && body.startsWith(hook)) body = body.slice(hook.length);
  if (cta && body.endsWith(cta)) body = body.slice(0, -cta.length);
  return body.trim();
}

function detectTone(text: string): ContentTone {
  const lower = text.toLowerCase();
  if (lower.includes('did you know') || lower.includes('here\'s how') || lower.includes('tip') || lower.includes('steps to')) return 'educational';
  if (lower.includes('❤️') || lower.includes('😢') || lower.includes('struggle') || lower.includes('feel') || lower.includes('remember when')) return 'emotional';
  if (lower.includes('😂') || lower.includes('lol') || lower.includes('bruh') || lower.includes('literally')) return 'humorous';
  if (lower.includes('you can') || lower.includes('believe') || lower.includes('never give up') || lower.includes('💪')) return 'inspirational';
  if (lower.includes('sale') || lower.includes('discount') || lower.includes('buy') || lower.includes('shop') || lower.includes('% off')) return 'promotional';
  if (lower.includes('once') || lower.includes('story') || lower.includes('happened') || lower.includes('last year')) return 'storytelling';
  if (lower.includes('?') || lower.includes('comment') || lower.includes('what do you')) return 'conversational';
  return 'unknown';
}

function countEmojis(text: string): number {
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu;
  return (text.match(emojiRegex) || []).length;
}

function extractKeyPhrases(text: string): string[] {
  const phrases: string[] = [];
  const lines = text.split('\n').filter(l => l.trim().length > 10 && l.trim().length < 100);
  for (const line of lines.slice(0, 5)) {
    const clean = line.replace(/[^\w\s'-]/g, '').trim();
    if (clean.length > 10) phrases.push(clean.substring(0, 80));
  }
  return phrases.slice(0, 8);
}

function guessAspectRatio(format: ContentFormat): '9:16' | '16:9' | '1:1' | '4:5' {
  switch (format) {
    case 'reel': case 'video': return '9:16';
    case 'image': return '1:1';
    case 'carousel': return '1:1';
    default: return '9:16';
  }
}

function guessResolution(ar: string): { width: number; height: number } {
  switch (ar) {
    case '9:16': return { width: 1080, height: 1920 };
    case '16:9': return { width: 1920, height: 1080 };
    case '1:1': return { width: 1080, height: 1080 };
    case '4:5': return { width: 1080, height: 1350 };
    default: return { width: 1080, height: 1920 };
  }
}

function mapContentFormat(raw: string): ContentFormat {
  const lower = (raw || '').toLowerCase();
  if (lower === 'reel') return 'reel';
  if (lower === 'video') return 'video';
  if (lower === 'image') return 'image';
  if (lower === 'carousel') return 'carousel';
  if (lower === 'link') return 'link';
  return 'text';
}

function guessMimeType(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.includes('.mp4')) return 'video/mp4';
  if (lower.includes('.mov')) return 'video/quicktime';
  if (lower.includes('.webm')) return 'video/webm';
  if (lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.heic')) return 'image/jpeg';
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.gif')) return 'image/gif';
  if (lower.includes('video')) return 'video/mp4';
  return 'image/jpeg';
}

function selectCompositionId(format: ContentFormat, tone: ContentTone): string {
  if (format === 'video' || format === 'reel') {
    if (tone === 'educational') return 'KineticTextExplainer';
    if (tone === 'emotional') return 'EmotionalStoryReel';
    if (tone === 'humorous') return 'QuickCutMeme';
    if (tone === 'promotional') return 'ProductShowcase';
    if (tone === 'storytelling') return 'NarrativeReel';
    return 'TextOverlayReel';
  }
  if (format === 'carousel') return 'CarouselSlideshow';
  if (format === 'image') return 'StaticPostCard';
  return 'TextOverlayReel';
}

function selectLayout(format: ContentFormat, tone: ContentTone): RenderStyle['layout'] {
  if (format === 'carousel') return 'slideshow';
  if (tone === 'educational') return 'kinetic-text';
  if (tone === 'promotional') return 'split-screen';
  if (format === 'video' || format === 'reel') return 'text-overlay';
  return 'text-overlay';
}

function selectTargetPlatforms(format: ContentFormat, platform: SourcePlatform): TargetPlatform[] {
  if (format === 'reel' || format === 'video') {
    return ['instagram_reels', 'tiktok', 'youtube_shorts'];
  }
  if (format === 'carousel' || format === 'image') {
    return ['instagram_feed', 'facebook_feed'];
  }
  if (platform === 'facebook') return ['facebook_feed', 'facebook_reels'];
  if (platform === 'instagram') return ['instagram_feed', 'instagram_reels'];
  return ['instagram_reels', 'tiktok'];
}

function determineRequiredApis(format: ContentFormat, hasMedia: boolean): RequiredApi[] {
  const apis: RequiredApi[] = [];
  
  if (format === 'video' || format === 'reel') {
    apis.push({
      service: 'remotion',
      purpose: 'Render video composition with text overlays and transitions',
      endpoint: 'POST /api/render',
      estimatedCost: '$0.05-0.20/render',
    });
    apis.push({
      service: 'elevenlabs',
      purpose: 'Generate voiceover narration from script beats',
      endpoint: 'POST /v1/text-to-speech/{voice_id}',
      estimatedCost: '$0.01-0.05/generation',
    });
  }

  if (format === 'image' || format === 'carousel') {
    apis.push({
      service: 'remotion',
      purpose: 'Render static image or carousel frames',
      endpoint: 'POST /api/render/still',
      estimatedCost: '$0.01-0.05/render',
    });
  }

  apis.push({
    service: 'openai',
    purpose: 'Adapt copy, generate variations, and personalize messaging',
    endpoint: 'POST /v1/chat/completions',
    estimatedCost: '$0.01-0.03/generation',
  });

  if (!hasMedia) {
    apis.push({
      service: 'sora',
      purpose: 'Generate original video footage from prompt',
      endpoint: 'Sora Safari automation pipeline',
      estimatedCost: '$0.10-0.50/generation',
    });
  }

  apis.push({
    service: 'ffmpeg',
    purpose: 'Post-processing: watermark removal, format conversion, stitching',
    endpoint: 'CLI ffmpeg',
    estimatedCost: 'free (local)',
  });

  return apis;
}

// ─── Packagers ───────────────────────────────────────────────

function packageFacebookPost(post: any, groupSize: number, rank: number): ContentPackage {
  const text = post.text_content || '';
  const format = mapContentFormat(post.content_type);
  const hook = extractHook(text);
  const cta = extractCta(text);
  const tone = detectTone(text);
  const ar = guessAspectRatio(format);

  const mediaAssets: MediaAsset[] = (post.media_urls || []).map((url: string, i: number) => ({
    index: i,
    type: (url.includes('video') || url.includes('.mp4')) ? 'video' as const : 'image' as const,
    remoteUrl: url,
    localPath: post.local_media_paths?.[i] || null,
    fileSize: null,
    width: null,
    height: null,
    aspectRatio: null,
    durationSec: null,
    mimeType: guessMimeType(url),
  }));

  const percentile = groupSize > 0 ? Math.round(((groupSize - rank) / groupSize) * 100) : 50;

  return {
    id: `pkg_fb_${post.id}_${Date.now()}`,
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    source: {
      platform: 'facebook',
      originalId: post.id,
      originalUrl: post.url || '',
      authorName: post.author_name || '',
      authorUrl: post.author_url || '',
      authorFollowers: post.author_followers || null,
      isVerified: post.is_verified || false,
      keyword: post.keyword || '',
      scrapedAt: post.scraped_at || '',
      postedAt: post.posted_at || '',
    },
    content: {
      format,
      originalText: text,
      hook,
      cta,
      body: extractBody(text, hook, cta),
      hashtags: post.hashtags || [],
      mentions: post.mentions || [],
      tone,
      readingTimeSec: Math.ceil((text.split(/\s+/).length) / 3.5),
      wordCount: text.split(/\s+/).filter((w: string) => w.length > 0).length,
      emojiDensity: text.length > 0 ? Math.round((countEmojis(text) / text.length) * 10000) / 100 : 0,
      keyPhrases: extractKeyPhrases(text),
    },
    media: {
      count: mediaAssets.length,
      primaryType: mediaAssets.length > 0 ? mediaAssets[0].type : 'none',
      isCarousel: mediaAssets.length > 1,
      assets: mediaAssets,
      thumbnail: post.thumbnail_path ? {
        index: 0, type: 'image', remoteUrl: '', localPath: post.thumbnail_path,
        fileSize: null, width: null, height: null, aspectRatio: null, durationSec: null, mimeType: 'image/jpeg',
      } : undefined,
    },
    performance: {
      likes: post.reactions || 0,
      comments: post.comments || 0,
      shares: post.shares || 0,
      views: post.views || null,
      reactionBreakdown: post.reaction_breakdown || {},
      engagementScore: post.engagement_score || 0,
      viralityScore: post.virality_score || 0,
      relevanceScore: post.relevance_score || 0,
      overallRank: post.overall_rank || 0,
      percentileInGroup: percentile,
      isTopPerformer: percentile >= 80,
    },
    renderSpec: {
      outputFormat: (format === 'video' || format === 'reel') ? 'video' : (format === 'carousel' ? 'carousel' : 'image'),
      targetPlatforms: selectTargetPlatforms(format, 'facebook'),
      durationSec: (format === 'video' || format === 'reel') ? 30 : 5,
      aspectRatio: ar,
      resolution: guessResolution(ar),
      fps: 30,
      compositionId: selectCompositionId(format, tone),
      style: {
        primaryColor: '#1877F2',
        secondaryColor: '#42B72A',
        backgroundColor: '#0A0A0A',
        textColor: '#FFFFFF',
        fontFamily: 'Inter',
        headingFontFamily: 'Inter',
        layout: selectLayout(format, tone),
        textAnimation: 'fade-in',
        backgroundStyle: mediaAssets.length > 0 ? 'video' : 'gradient',
        musicMood: tone === 'emotional' ? 'emotional' : tone === 'humorous' ? 'upbeat' : 'calm',
      },
    },
    recreation: buildRecreationInstructions(text, hook, cta, format, tone, percentile, mediaAssets.length > 0),
    tags: buildTags(post.keyword, format, tone, 'facebook', percentile >= 80),
  };
}

function packageInstagramPost(post: any, groupSize: number, rank: number): ContentPackage {
  const text = post.caption || '';
  const format = mapContentFormat(post.content_type);
  const hook = extractHook(text);
  const cta = extractCta(text);
  const tone = detectTone(text);
  const ar = guessAspectRatio(format);

  const mediaAssets: MediaAsset[] = (post.media_urls || []).map((url: string, i: number) => ({
    index: i,
    type: (url.includes('video') || url.includes('.mp4')) ? 'video' as const : 'image' as const,
    remoteUrl: url,
    localPath: post.local_media_paths?.[i] || null,
    fileSize: null,
    width: null,
    height: null,
    aspectRatio: null,
    durationSec: null,
    mimeType: guessMimeType(url),
  }));

  // Add thumbnail as asset if no other media
  if (mediaAssets.length === 0 && post.thumbnail_url) {
    mediaAssets.push({
      index: 0,
      type: 'image',
      remoteUrl: post.thumbnail_url,
      localPath: null,
      fileSize: null,
      width: null,
      height: null,
      aspectRatio: null,
      durationSec: null,
      mimeType: 'image/jpeg',
    });
  }

  const percentile = groupSize > 0 ? Math.round(((groupSize - rank) / groupSize) * 100) : 50;

  return {
    id: `pkg_ig_${post.id}_${Date.now()}`,
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    source: {
      platform: 'instagram',
      originalId: post.id,
      originalUrl: post.url || '',
      authorName: post.author_username || '',
      authorUrl: post.author_username ? `https://instagram.com/${post.author_username}` : '',
      authorFollowers: null,
      isVerified: false,
      keyword: post.keyword || '',
      scrapedAt: post.scraped_at || '',
      postedAt: post.posted_at || '',
    },
    content: {
      format,
      originalText: text,
      hook,
      cta,
      body: extractBody(text, hook, cta),
      hashtags: post.hashtags || [],
      mentions: [],
      tone,
      readingTimeSec: Math.ceil((text.split(/\s+/).length) / 3.5),
      wordCount: text.split(/\s+/).filter((w: string) => w.length > 0).length,
      emojiDensity: text.length > 0 ? Math.round((countEmojis(text) / text.length) * 10000) / 100 : 0,
      keyPhrases: extractKeyPhrases(text),
    },
    media: {
      count: mediaAssets.length,
      primaryType: mediaAssets.length > 0 ? mediaAssets[0].type : 'none',
      isCarousel: mediaAssets.length > 1,
      assets: mediaAssets,
    },
    performance: {
      likes: post.likes || 0,
      comments: post.comments || 0,
      shares: 0,
      views: post.views || null,
      reactionBreakdown: {},
      engagementScore: post.engagement_score || 0,
      viralityScore: post.virality_score || 0,
      relevanceScore: post.relevance_score || 0,
      overallRank: post.overall_rank || 0,
      percentileInGroup: percentile,
      isTopPerformer: percentile >= 80,
    },
    renderSpec: {
      outputFormat: (format === 'video' || format === 'reel') ? 'video' : (format === 'carousel' ? 'carousel' : 'image'),
      targetPlatforms: selectTargetPlatforms(format, 'instagram'),
      durationSec: (format === 'video' || format === 'reel') ? 30 : 5,
      aspectRatio: ar,
      resolution: guessResolution(ar),
      fps: 30,
      compositionId: selectCompositionId(format, tone),
      style: {
        primaryColor: '#E1306C',
        secondaryColor: '#833AB4',
        backgroundColor: '#0A0A0A',
        textColor: '#FFFFFF',
        fontFamily: 'Inter',
        headingFontFamily: 'Inter',
        layout: selectLayout(format, tone),
        textAnimation: 'slide-up',
        backgroundStyle: mediaAssets.length > 0 ? 'video' : 'gradient',
        musicMood: tone === 'emotional' ? 'emotional' : tone === 'humorous' ? 'upbeat' : 'calm',
      },
    },
    recreation: buildRecreationInstructions(text, hook, cta, format, tone, percentile, mediaAssets.length > 0),
    tags: buildTags(post.keyword, format, tone, 'instagram', percentile >= 80),
  };
}

function packageAdLibraryAd(ad: any, groupSize: number, rank: number): ContentPackage {
  const text = ad.ad_text || '';
  const format: ContentFormat = ad.has_video ? 'video' : (ad.has_image ? 'image' : 'text');
  const hook = extractHook(text);
  const cta = ad.cta_text || extractCta(text);
  const tone = detectTone(text);
  const ar = guessAspectRatio(format);

  const mediaAssets: MediaAsset[] = (ad.media_urls || []).map((url: string, i: number) => ({
    index: i,
    type: ad.has_video ? 'video' as const : 'image' as const,
    remoteUrl: url,
    localPath: ad.local_media_paths?.[i] || null,
    fileSize: null,
    width: null,
    height: null,
    aspectRatio: null,
    durationSec: null,
    mimeType: guessMimeType(url),
  }));

  const percentile = groupSize > 0 ? Math.round(((groupSize - rank) / groupSize) * 100) : 50;

  return {
    id: `pkg_ad_${ad.id}_${Date.now()}`,
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    source: {
      platform: 'meta_ad_library',
      originalId: ad.id || ad.ad_id || '',
      originalUrl: '',
      authorName: ad.advertiser_name || '',
      authorUrl: ad.advertiser_url || '',
      authorFollowers: null,
      isVerified: false,
      keyword: ad.keyword || '',
      scrapedAt: ad.scraped_at || '',
      postedAt: ad.started_running || '',
    },
    content: {
      format,
      originalText: text,
      hook,
      cta,
      body: extractBody(text, hook, cta),
      hashtags: [],
      mentions: [],
      tone,
      readingTimeSec: Math.ceil((text.split(/\s+/).length) / 3.5),
      wordCount: text.split(/\s+/).filter((w: string) => w.length > 0).length,
      emojiDensity: text.length > 0 ? Math.round((countEmojis(text) / text.length) * 10000) / 100 : 0,
      keyPhrases: extractKeyPhrases(text),
      ctaButtonText: ad.cta_text || undefined,
      landingUrl: ad.landing_url || undefined,
    },
    media: {
      count: mediaAssets.length,
      primaryType: mediaAssets.length > 0 ? mediaAssets[0].type : 'none',
      isCarousel: mediaAssets.length > 1,
      assets: mediaAssets,
    },
    performance: {
      likes: 0,
      comments: 0,
      shares: 0,
      views: null,
      reactionBreakdown: {},
      engagementScore: 0,
      viralityScore: 0,
      relevanceScore: 0,
      overallRank: 0,
      percentileInGroup: percentile,
      isTopPerformer: ad.is_active || false,
    },
    renderSpec: {
      outputFormat: format === 'video' ? 'video' : 'image',
      targetPlatforms: ['instagram_reels', 'facebook_feed', 'tiktok'],
      durationSec: format === 'video' ? 30 : 5,
      aspectRatio: ar,
      resolution: guessResolution(ar),
      fps: 30,
      compositionId: selectCompositionId(format, tone),
      style: {
        primaryColor: '#0062E0',
        secondaryColor: '#19CF86',
        backgroundColor: '#111111',
        textColor: '#FFFFFF',
        fontFamily: 'Inter',
        headingFontFamily: 'Inter',
        layout: 'split-screen',
        textAnimation: 'fade-in',
        backgroundStyle: mediaAssets.length > 0 ? 'image' : 'gradient',
        musicMood: 'corporate',
      },
    },
    recreation: buildRecreationInstructions(text, hook, cta, format, tone, percentile, mediaAssets.length > 0),
    tags: buildTags(ad.keyword, format, tone, 'meta_ad_library', false),
  };
}

// ─── Shared Builders ─────────────────────────────────────────

function buildRecreationInstructions(
  text: string, hook: string, cta: string,
  format: ContentFormat, tone: ContentTone,
  percentile: number, hasMedia: boolean
): RecreationInstructions {
  const priority = percentile >= 90 ? 1 : percentile >= 75 ? 2 : percentile >= 50 ? 3 : percentile >= 25 ? 4 : 5;

  const steps: string[] = [];
  if (format === 'video' || format === 'reel') {
    steps.push('1. Extract script beats from original text');
    steps.push('2. Adapt hook for our brand voice');
    steps.push('3. Generate voiceover via ElevenLabs TTS');
    if (hasMedia) {
      steps.push('4. Download and process original media as B-roll reference');
    } else {
      steps.push('4. Generate B-roll via Sora or stock footage');
    }
    steps.push('5. Compose in Remotion with text overlays and transitions');
    steps.push('6. Add background music matching mood');
    steps.push('7. Export at target resolution and aspect ratio');
  } else if (format === 'carousel') {
    steps.push('1. Break content into slide-sized chunks');
    steps.push('2. Design each slide in Remotion CarouselSlideshow composition');
    steps.push('3. Add brand colors, fonts, and logo');
    steps.push('4. Export individual frames and combined video version');
  } else {
    steps.push('1. Adapt text copy for our brand voice');
    steps.push('2. Generate or source visual asset');
    steps.push('3. Compose in Remotion StaticPostCard composition');
    steps.push('4. Export at target resolution');
  }

  const scriptBeats = text.split('\n')
    .filter(l => l.trim().length > 10 && l.trim().length < 150)
    .slice(0, 8)
    .map(l => l.trim());

  return {
    type: percentile >= 80 ? 'direct-repurpose' : 'inspired-recreation',
    priority: priority as 1 | 2 | 3 | 4 | 5,
    steps,
    keepElements: [
      hook ? `Hook: "${hook.substring(0, 60)}..."` : 'N/A',
      `Content format: ${format}`,
      `Tone: ${tone}`,
    ].filter(e => e !== 'N/A'),
    changeElements: [
      'Brand voice and terminology',
      'Visual style and colors',
      'CTA pointing to our product',
      'Remove competitor mentions',
    ],
    scriptBeats,
    adaptedHook: hook || '',
    adaptedCta: cta || 'Link in bio',
    relatedBriefId: null,
    soraPrompt: null,
    requiredApis: determineRequiredApis(format, hasMedia),
  };
}

function buildTags(keyword: string, format: ContentFormat, tone: ContentTone, platform: string, isTop: boolean): string[] {
  const tags: string[] = [platform, format, tone];
  if (keyword) tags.push(keyword.toLowerCase().replace(/\s+/g, '-'));
  if (isTop) tags.push('top-performer');
  if (format === 'video' || format === 'reel') tags.push('video-content');
  if (format === 'carousel') tags.push('carousel-content');
  return tags;
}

// ─── Main Packager ───────────────────────────────────────────

export interface PackagerOptions {
  platforms?: SourcePlatform[];
  keywords?: string[];
  minEngagementScore?: number;
  topN?: number;
  contentFormats?: ContentFormat[];
  includeAdLibrary?: boolean;
}

export function packageResearchData(options: PackagerOptions = {}): ContentPackageBatch {
  const {
    platforms = ['facebook', 'instagram', 'meta_ad_library'],
    keywords,
    minEngagementScore = 0,
    topN = 50,
    contentFormats,
    includeAdLibrary = true,
  } = options;

  const packages: ContentPackage[] = [];
  const byPlatform: Record<string, number> = {};
  const byFormat: Record<string, number> = {};

  // Package Facebook posts
  if (platforms.includes('facebook') && fs.existsSync(FB_POSTS_DIR)) {
    const dirs = fs.readdirSync(FB_POSTS_DIR).filter(d => {
      if (keywords && keywords.length > 0) {
        return keywords.some(k => d.toLowerCase().includes(k.toLowerCase()));
      }
      return true;
    });

    for (const dir of dirs) {
      const rankedFile = path.join(FB_POSTS_DIR, dir, 'ranked.json');
      const posts = readJsonFile(rankedFile);
      if (!posts || !Array.isArray(posts)) continue;

      const filtered = posts.filter((p: any) => {
        if (minEngagementScore > 0 && (p.engagement_score || 0) < minEngagementScore) return false;
        if (contentFormats && contentFormats.length > 0) {
          if (!contentFormats.includes(mapContentFormat(p.content_type))) return false;
        }
        return true;
      });

      filtered.forEach((post: any, idx: number) => {
        const pkg = packageFacebookPost(post, filtered.length, idx);
        packages.push(pkg);
        byPlatform['facebook'] = (byPlatform['facebook'] || 0) + 1;
        byFormat[pkg.content.format] = (byFormat[pkg.content.format] || 0) + 1;
      });
    }
  }

  // Package Instagram posts
  if (platforms.includes('instagram') && fs.existsSync(IG_POSTS_DIR)) {
    const dirs = fs.readdirSync(IG_POSTS_DIR).filter(d => {
      if (keywords && keywords.length > 0) {
        return keywords.some(k => d.toLowerCase().includes(k.toLowerCase()));
      }
      return true;
    });

    for (const dir of dirs) {
      const rankedFile = path.join(IG_POSTS_DIR, dir, 'ranked.json');
      const posts = readJsonFile(rankedFile);
      if (!posts || !Array.isArray(posts)) continue;

      const filtered = posts.filter((p: any) => {
        if (minEngagementScore > 0 && (p.engagement_score || 0) < minEngagementScore) return false;
        if (contentFormats && contentFormats.length > 0) {
          if (!contentFormats.includes(mapContentFormat(p.content_type))) return false;
        }
        return true;
      });

      filtered.forEach((post: any, idx: number) => {
        const pkg = packageInstagramPost(post, filtered.length, idx);
        packages.push(pkg);
        byPlatform['instagram'] = (byPlatform['instagram'] || 0) + 1;
        byFormat[pkg.content.format] = (byFormat[pkg.content.format] || 0) + 1;
      });
    }
  }

  // Package Ad Library ads
  if (includeAdLibrary && platforms.includes('meta_ad_library') && fs.existsSync(AD_LIBRARY_DIR)) {
    const dirs = fs.readdirSync(AD_LIBRARY_DIR).filter(d => {
      if (keywords && keywords.length > 0) {
        return keywords.some(k => d.toLowerCase().includes(k.toLowerCase()));
      }
      return true;
    });

    for (const dir of dirs) {
      const adsFile = path.join(AD_LIBRARY_DIR, dir, 'ads.json');
      const ads = readJsonFile(adsFile);
      if (!ads || !Array.isArray(ads)) continue;

      const filtered = ads.filter((a: any) => {
        if (contentFormats && contentFormats.length > 0) {
          const f = a.has_video ? 'video' : (a.has_image ? 'image' : 'text');
          if (!contentFormats.includes(f as ContentFormat)) return false;
        }
        return true;
      });

      filtered.forEach((ad: any, idx: number) => {
        const pkg = packageAdLibraryAd(ad, filtered.length, idx);
        packages.push(pkg);
        byPlatform['meta_ad_library'] = (byPlatform['meta_ad_library'] || 0) + 1;
        byFormat[pkg.content.format] = (byFormat[pkg.content.format] || 0) + 1;
      });
    }
  }

  // Sort by performance (engagement + virality + rank)
  packages.sort((a, b) => {
    const scoreA = a.performance.engagementScore + a.performance.viralityScore + a.performance.overallRank;
    const scoreB = b.performance.engagementScore + b.performance.viralityScore + b.performance.overallRank;
    return scoreB - scoreA;
  });

  // Limit to topN
  const topPackages = packages.slice(0, topN);
  const totalEngagement = topPackages.reduce((sum, p) => sum + p.performance.engagementScore, 0);

  const batch: ContentPackageBatch = {
    id: `batch_${Date.now()}`,
    generatedAt: new Date().toISOString(),
    filters: {
      platforms,
      keywords: keywords || [],
      minEngagementScore,
      topN,
      contentFormats: contentFormats || [],
    },
    summary: {
      totalPackages: topPackages.length,
      byPlatform,
      byFormat,
      avgEngagement: topPackages.length > 0 ? Math.round(totalEngagement / topPackages.length * 100) / 100 : 0,
      topPerformers: topPackages.filter(p => p.performance.isTopPerformer).length,
    },
    packages: topPackages,
  };

  return batch;
}

// ─── Enrichment: Match ad briefs ─────────────────────────────

export function enrichWithAdBriefs(batch: ContentPackageBatch): ContentPackageBatch {
  if (!fs.existsSync(AD_BRIEFS_DIR)) return batch;

  const briefFiles = fs.readdirSync(AD_BRIEFS_DIR).filter(f => f.endsWith('.json'));
  const briefs: any[] = briefFiles.map(f => readJsonFile(path.join(AD_BRIEFS_DIR, f))).filter(Boolean);

  for (const pkg of batch.packages) {
    const keyword = pkg.source.keyword.toLowerCase();
    const matchedBrief = briefs.find(b =>
      b.keyword?.toLowerCase().includes(keyword) ||
      keyword.includes(b.keyword?.toLowerCase() || '')
    );

    if (matchedBrief) {
      pkg.recreation.relatedBriefId = matchedBrief.id;
      if (matchedBrief.sora_prompt) {
        pkg.recreation.soraPrompt = matchedBrief.sora_prompt;
      }
      if (matchedBrief.primary_hook && !pkg.recreation.adaptedHook) {
        pkg.recreation.adaptedHook = matchedBrief.primary_hook;
      }
    }
  }

  return batch;
}

// ─── Export / Save ───────────────────────────────────────────

export function saveBatch(batch: ContentPackageBatch, outputPath?: string): string {
  const dir = outputPath || OUTPUT_DIR;
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${batch.id}.json`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, JSON.stringify(batch, null, 2));

  // Also save a manifest for quick lookups
  const manifestPath = path.join(dir, 'latest-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    batchId: batch.id,
    generatedAt: batch.generatedAt,
    summary: batch.summary,
    packageIds: batch.packages.map(p => p.id),
    file: filename,
  }, null, 2));

  return fullPath;
}

// ─── CLI ─────────────────────────────────────────────────────

if (process.argv[1]?.includes('packager')) {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace('--', '');
      flags[key] = args[i + 1] || 'true';
      i++;
    }
  }

  const options: PackagerOptions = {};
  if (flags.platforms) options.platforms = flags.platforms.split(',') as SourcePlatform[];
  if (flags.keywords) options.keywords = flags.keywords.split(',');
  if (flags['min-engagement']) options.minEngagementScore = parseFloat(flags['min-engagement']);
  if (flags['top-n']) options.topN = parseInt(flags['top-n']);
  if (flags.formats) options.contentFormats = flags.formats.split(',') as ContentFormat[];
  if (flags['no-ads']) options.includeAdLibrary = false;

  console.log('📦 Content Packager');
  console.log('─'.repeat(50));
  console.log(`Platforms: ${(options.platforms || ['all']).join(', ')}`);
  console.log(`Keywords: ${(options.keywords || ['all']).join(', ')}`);
  console.log(`Min engagement: ${options.minEngagementScore || 0}`);
  console.log(`Top N: ${options.topN || 50}`);
  console.log('');

  console.log('🔍 Scanning research data...');
  let batch = packageResearchData(options);

  console.log('🔗 Enriching with ad briefs...');
  batch = enrichWithAdBriefs(batch);

  const outputFile = saveBatch(batch);

  console.log('');
  console.log('✅ Package complete!');
  console.log(`   Total packages: ${batch.summary.totalPackages}`);
  console.log(`   By platform: ${JSON.stringify(batch.summary.byPlatform)}`);
  console.log(`   By format: ${JSON.stringify(batch.summary.byFormat)}`);
  console.log(`   Top performers: ${batch.summary.topPerformers}`);
  console.log(`   Avg engagement: ${batch.summary.avgEngagement}`);
  console.log(`   Output: ${outputFile}`);
}
