/**
 * Content Package Schema
 * 
 * A standardized format for packaging market research content (FB, IG, Meta Ad Library)
 * into a format digestible by a Remotion-based content recreation server.
 * 
 * Each ContentPackage represents a single piece of content that can be recreated,
 * repurposed, or used as inspiration for new content.
 */

// ─── Core Package ────────────────────────────────────────────

export interface ContentPackage {
  /** Unique package ID (format: pkg_{source}_{id}_{timestamp}) */
  id: string;

  /** Schema version for forward compatibility */
  schemaVersion: '1.0';

  /** When this package was generated */
  generatedAt: string;

  /** The research source this was derived from */
  source: SourceReference;

  /** Analyzed content with text, hooks, CTAs */
  content: ContentAnalysis;

  /** All media assets with metadata */
  media: MediaManifest;

  /** Engagement metrics and competitive scoring */
  performance: PerformanceMetrics;

  /** Rendering instructions for the recreation server */
  renderSpec: RenderSpec;

  /** Recreation instructions and adaptation notes */
  recreation: RecreationInstructions;

  /** Tags for filtering and routing */
  tags: string[];
}

// ─── Source Reference ────────────────────────────────────────

export type SourcePlatform = 'facebook' | 'instagram' | 'meta_ad_library';

export interface SourceReference {
  platform: SourcePlatform;
  originalId: string;
  originalUrl: string;
  authorName: string;
  authorUrl: string;
  authorFollowers: number | null;
  isVerified: boolean;
  keyword: string;
  scrapedAt: string;
  postedAt: string;
}

// ─── Content Analysis ────────────────────────────────────────

export type ContentFormat = 'text' | 'image' | 'video' | 'reel' | 'carousel' | 'link';

export interface ContentAnalysis {
  /** Original format */
  format: ContentFormat;

  /** Full original text/caption */
  originalText: string;

  /** Extracted hook (first line or attention-grabbing opener) */
  hook: string;

  /** Extracted CTA if present */
  cta: string;

  /** Body text (between hook and CTA) */
  body: string;

  /** Hashtags used */
  hashtags: string[];

  /** Mentions used */
  mentions: string[];

  /** Detected tone/style */
  tone: ContentTone;

  /** Estimated reading time in seconds */
  readingTimeSec: number;

  /** Word count */
  wordCount: number;

  /** Emoji usage density (emojis per 100 chars) */
  emojiDensity: number;

  /** Key phrases and topics extracted */
  keyPhrases: string[];

  /** If from Ad Library: advertiser CTA button text */
  ctaButtonText?: string;

  /** If from Ad Library: landing page URL */
  landingUrl?: string;
}

export type ContentTone =
  | 'educational'
  | 'emotional'
  | 'humorous'
  | 'inspirational'
  | 'promotional'
  | 'storytelling'
  | 'conversational'
  | 'authoritative'
  | 'unknown';

// ─── Media Manifest ──────────────────────────────────────────

export interface MediaManifest {
  /** Total number of media assets */
  count: number;

  /** Primary media type */
  primaryType: 'image' | 'video' | 'none';

  /** Whether this has multiple media items (carousel) */
  isCarousel: boolean;

  /** Individual media assets */
  assets: MediaAsset[];

  /** Thumbnail for previews */
  thumbnail?: MediaAsset;
}

export interface MediaAsset {
  /** Asset index (0-based) */
  index: number;

  /** Asset type */
  type: 'image' | 'video';

  /** Remote URL (original source) */
  remoteUrl: string;

  /** Local file path (if downloaded) */
  localPath: string | null;

  /** File size in bytes (if known) */
  fileSize: number | null;

  /** Dimensions (if known) */
  width: number | null;
  height: number | null;

  /** Aspect ratio string (e.g. "9:16", "1:1", "16:9") */
  aspectRatio: string | null;

  /** Duration in seconds (video only) */
  durationSec: number | null;

  /** MIME type */
  mimeType: string | null;
}

// ─── Performance Metrics ─────────────────────────────────────

export interface PerformanceMetrics {
  /** Platform-specific engagement */
  likes: number;
  comments: number;
  shares: number;
  views: number | null;

  /** Reaction breakdown (FB only) */
  reactionBreakdown: Record<string, number>;

  /** Computed scores (0-100) */
  engagementScore: number;
  viralityScore: number;
  relevanceScore: number;
  overallRank: number;

  /** Percentile within its keyword/hashtag group */
  percentileInGroup: number;

  /** Whether this is a top performer (top 20%) */
  isTopPerformer: boolean;
}

// ─── Render Spec ─────────────────────────────────────────────

export interface RenderSpec {
  /** Recommended output format */
  outputFormat: 'video' | 'image' | 'carousel';

  /** Target platforms for the recreation */
  targetPlatforms: TargetPlatform[];

  /** Duration in seconds (for video) */
  durationSec: number;

  /** Aspect ratio */
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';

  /** Resolution */
  resolution: { width: number; height: number };

  /** FPS (for video) */
  fps: number;

  /** Suggested Remotion composition ID */
  compositionId: string;

  /** Style parameters for the composition */
  style: RenderStyle;
}

export type TargetPlatform =
  | 'instagram_reels'
  | 'instagram_feed'
  | 'instagram_stories'
  | 'tiktok'
  | 'youtube_shorts'
  | 'facebook_reels'
  | 'facebook_feed'
  | 'twitter';

export interface RenderStyle {
  /** Color palette (hex values) */
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;

  /** Typography */
  fontFamily: string;
  headingFontFamily: string;

  /** Layout template */
  layout: 'text-overlay' | 'split-screen' | 'slideshow' | 'kinetic-text' | 'talking-head' | 'b-roll-overlay';

  /** Text animation style */
  textAnimation: 'typewriter' | 'fade-in' | 'slide-up' | 'bounce' | 'none';

  /** Background style */
  backgroundStyle: 'solid' | 'gradient' | 'video' | 'image' | 'particles';

  /** Music/audio suggestion */
  musicMood: 'upbeat' | 'calm' | 'dramatic' | 'emotional' | 'corporate' | 'none';
}

// ─── Recreation Instructions ─────────────────────────────────

export interface RecreationInstructions {
  /** What type of recreation this is */
  type: 'direct-repurpose' | 'inspired-recreation' | 'format-adaptation' | 'mashup';

  /** Priority level (1=highest) based on performance score */
  priority: 1 | 2 | 3 | 4 | 5;

  /** Step-by-step recreation notes */
  steps: string[];

  /** What to keep from the original */
  keepElements: string[];

  /** What to change/improve */
  changeElements: string[];

  /** Script beats (for video content) */
  scriptBeats: string[];

  /** Adapted hook for our brand */
  adaptedHook: string;

  /** Adapted CTA */
  adaptedCta: string;

  /** Related ad brief ID (if matched to an offer) */
  relatedBriefId: string | null;

  /** Sora video prompt (if applicable) */
  soraPrompt: string | null;

  /** API calls needed for recreation */
  requiredApis: RequiredApi[];
}

export interface RequiredApi {
  /** Service name */
  service: 'remotion' | 'sora' | 'openai' | 'elevenlabs' | 'stability' | 'ffmpeg' | 'sharp';

  /** What it's used for */
  purpose: string;

  /** Endpoint or function */
  endpoint: string;

  /** Estimated cost per use */
  estimatedCost: string;
}

// ─── Batch Package ───────────────────────────────────────────

export interface ContentPackageBatch {
  /** Batch ID */
  id: string;

  /** When generated */
  generatedAt: string;

  /** Source filters used */
  filters: {
    platforms: SourcePlatform[];
    keywords: string[];
    minEngagementScore: number;
    topN: number;
    contentFormats: ContentFormat[];
  };

  /** Summary stats */
  summary: {
    totalPackages: number;
    byPlatform: Record<string, number>;
    byFormat: Record<string, number>;
    avgEngagement: number;
    topPerformers: number;
  };

  /** The packages */
  packages: ContentPackage[];
}
