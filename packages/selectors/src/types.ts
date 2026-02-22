export type SelectorType = 'css' | 'xpath' | 'aria';

export interface SelectorContract {
  expectedCount: 'one' | 'many' | number;
  mustBeClickable?: boolean;
  mustBeVisible?: boolean;
  mustSurviveScroll?: boolean;
  mustSurviveRefresh?: boolean;
  extractionType?: 'text' | 'attribute' | 'html';
  attribute?: string;
  pattern?: RegExp;
  optional?: boolean;
}

export interface Selector {
  primary: string;
  fallbacks: string[];
  type: SelectorType;
  contract: SelectorContract;
}

export interface SelectorGroup {
  [elementName: string]: Selector;
}

export interface SelectorValidation {
  selector: string;
  valid: boolean;
  matchCount: number;
  errors: string[];
  warnings: string[];
}

export type Platform = 'instagram' | 'tiktok' | 'threads' | 'twitter' | 'facebook';
