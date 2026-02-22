/**
 * Automation Core
 * 
 * Base types and interface for all Safari browser automation.
 * Provides platform-agnostic abstractions for navigation, interaction,
 * session management, and proof-of-action artifacts.
 */

import * as crypto from 'crypto';

// ============================================================================
// PLATFORM
// ============================================================================

export type Platform =
  | 'twitter'
  | 'instagram'
  | 'tiktok'
  | 'linkedin'
  | 'upwork'
  | 'facebook'
  | 'youtube'
  | 'threads';

// ============================================================================
// RESULT TYPES
// ============================================================================

export interface AutomationResult {
  success: boolean;
  action: string;
  platform: Platform;
  timestamp: number;
  duration: number;
  error?: string;
  proofs: ProofArtifact[];
  metadata?: Record<string, unknown>;
}

export interface ProofArtifact {
  type: 'screenshot' | 'dom_snapshot' | 'url' | 'text' | 'hash';
  label: string;
  value: string;
  timestamp: number;
}

export interface ClickResult {
  success: boolean;
  selector: string;
  clickedText?: string;
  error?: string;
}

export interface NavigationResult {
  success: boolean;
  url?: string;
  finalUrl?: string;
  loadTime?: number;
  error?: string;
}

export interface TypeResult {
  success: boolean;
  selector: string;
  text: string;
  verified: boolean;
  error?: string;
}

export interface WaitResult {
  success: boolean;
  selector?: string;
  elapsed: number;
  found: boolean;
  error?: string;
}

export interface HealthCheckResult {
  platform: Platform;
  isReachable: boolean;
  isLoggedIn: boolean;
  currentUrl: string;
  sessionValid: boolean;
  timestamp: number;
  error?: string;
}

export interface CommentResult {
  success: boolean;
  commentId?: string;
  verified: boolean;
  text: string;
  postUrl: string;
  proofs: ProofArtifact[];
  error?: string;
}

// ============================================================================
// SESSION & COOKIE TYPES
// ============================================================================

export interface SessionData {
  platform: Platform;
  userId?: string;
  username?: string;
  cookies: EncryptedCookie[];
  createdAt: number;
  expiresAt: number;
  isValid: boolean;
}

export interface EncryptedCookie {
  name: string;
  domain: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expiresAt?: number;
}

// ============================================================================
// ENCRYPTION HELPERS
// ============================================================================

const ALGORITHM = 'aes-256-gcm';
const KEY_ENV = 'AUTOMATION_ENCRYPTION_KEY';

function getEncryptionKey(): Buffer {
  const key = process.env[KEY_ENV];
  if (!key) {
    const os = require('os');
    const seed = `safari-automation-${os.hostname()}-${os.userInfo().username}`;
    return crypto.createHash('sha256').update(seed).digest();
  }
  return crypto.createHash('sha256').update(key).digest();
}

export function encryptValue(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

export function decryptValue(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivHex, tagHex, encrypted] = ciphertext.split(':');
  if (!ivHex || !tagHex || !encrypted) throw new Error('Invalid encrypted value format');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ============================================================================
// AUTOMATION CORE INTERFACE
// ============================================================================

export interface AutomationCore {
  readonly platform: Platform;

  navigateTo(url: string): Promise<NavigationResult>;
  getCurrentUrl(): Promise<string>;
  waitForElement(selector: string, timeoutMs?: number): Promise<WaitResult>;
  waitForNavigation(timeoutMs?: number): Promise<NavigationResult>;

  click(selector: string): Promise<ClickResult>;
  type(selector: string, text: string): Promise<TypeResult>;
  getText(selector: string): Promise<string>;
  getAttributeValue(selector: string, attribute: string): Promise<string>;
  isElementPresent(selector: string): Promise<boolean>;

  executeJS(script: string): Promise<string>;

  healthCheck(): Promise<HealthCheckResult>;
  isLoggedIn(): Promise<boolean>;
  getSession(): Promise<SessionData | null>;

  takeScreenshot(label: string): Promise<ProofArtifact>;
  captureDOM(selector: string, label: string): Promise<ProofArtifact>;

  wait(ms: number): Promise<void>;
  humanDelay(minMs?: number, maxMs?: number): Promise<void>;
}

// ============================================================================
// RATE LIMITER
// ============================================================================

export class RateLimiter {
  private actions: number[] = [];

  constructor(
    private maxActions: number,
    private windowMs: number,
  ) {}

  canAct(): boolean {
    this.prune();
    return this.actions.length < this.maxActions;
  }

  record(): void {
    this.actions.push(Date.now());
  }

  remaining(): number {
    this.prune();
    return Math.max(0, this.maxActions - this.actions.length);
  }

  resetAt(): number {
    if (this.actions.length === 0) return 0;
    return this.actions[0] + this.windowMs;
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    this.actions = this.actions.filter(t => t > cutoff);
  }
}
