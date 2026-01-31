import type { Selector, SelectorGroup, Platform } from './types';
import { instagramSelectors } from './platforms/instagram';
import { tiktokSelectors } from './platforms/tiktok';
import { threadsSelectors } from './platforms/threads';
import { twitterSelectors } from './platforms/twitter';

export class SelectorNotFoundError extends Error {
  constructor(path: string) {
    super(`Selector not found: ${path}`);
    this.name = 'SelectorNotFoundError';
  }
}

export class SelectorRegistry {
  private selectors: Map<string, Selector> = new Map();
  private version: string;

  constructor() {
    this.loadSelectors();
    this.version = this.computeVersion();
  }

  get(path: string): string {
    const selector = this.selectors.get(path);
    if (!selector) {
      throw new SelectorNotFoundError(path);
    }
    return selector.primary;
  }

  getWithFallbacks(path: string): string[] {
    const selector = this.selectors.get(path);
    if (!selector) {
      throw new SelectorNotFoundError(path);
    }
    return [selector.primary, ...selector.fallbacks];
  }

  getSelector(path: string): Selector {
    const selector = this.selectors.get(path);
    if (!selector) {
      throw new SelectorNotFoundError(path);
    }
    return selector;
  }

  has(path: string): boolean {
    return this.selectors.has(path);
  }

  getVersion(): string {
    return this.version;
  }

  getAllPaths(): string[] {
    return Array.from(this.selectors.keys());
  }

  getPathsForPlatform(platform: Platform): string[] {
    return this.getAllPaths().filter((path) => path.startsWith(`${platform}.`));
  }

  private loadSelectors(): void {
    this.loadPlatformSelectors('instagram', instagramSelectors);
    this.loadPlatformSelectors('tiktok', tiktokSelectors);
    this.loadPlatformSelectors('threads', threadsSelectors);
    this.loadPlatformSelectors('twitter', twitterSelectors);
  }

  private loadPlatformSelectors(
    platform: string,
    selectors: Record<string, SelectorGroup>
  ): void {
    for (const [page, group] of Object.entries(selectors)) {
      for (const [element, selector] of Object.entries(group)) {
        const path = `${platform}.${page}.${element}`;
        this.selectors.set(path, selector);
      }
    }
  }

  private computeVersion(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  }
}
