import type { SelectorGroup } from '../../types';

/**
 * Facebook Ad Library selectors — discovered from live DOM probing (Feb 2026).
 *
 * The Ad Library uses custom React components with non-standard HTML:
 *   - Dropdowns are `div[role="combobox"]` (not <select>)
 *   - Options are `[role="option"]`
 *   - Buttons are `div[role="none"]` or `div[role="button"]`
 *   - Close buttons have parent `[role="button"]` with text "Close"
 *
 * Many controls are identified by Y-position ranges because they share
 * the same `div[role="combobox"]` selector. The Filters panel dialog
 * sits at x>400 to distinguish from the top-bar comboboxes at x<200.
 */

// ── Top filter bar (always visible) ──────────────────────────────

export const topBarSelectors: SelectorGroup = {
  searchInput: {
    primary: 'input[type="search"][placeholder="Search by keyword or advertiser"]',
    fallbacks: ['input[placeholder*="keyword"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeVisible: true },
  },
  clearSearchButton: {
    primary: 'div[role="button"][aria-label="Clear"]',
    fallbacks: [],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true, optional: true },
  },
  countryCombobox: {
    primary: 'div[role="combobox"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
      // First combobox (x < 200). Text includes country name or "Search for country".
    },
  },
  adCategoryCombobox: {
    primary: 'div[role="combobox"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
      // Second combobox. Text includes "All ads" or category name.
    },
  },
  sortByCombobox: {
    primary: 'div[role="combobox"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
      // Contains "Sort by" text.
    },
  },
  totalResultsText: {
    primary: 'body',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      extractionType: 'text',
      pattern: /~?[\d,]+\s+results?/i,
    },
  },
};

// ── Filter chips (appear when URL-param filters are active) ──────

export const filterChipSelectors: SelectorGroup = {
  activeStatusChip: {
    primary: 'body',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      extractionType: 'text',
      pattern: /Active status:\s*\S+ ads/,
      optional: true,
    },
  },
  platformChip: {
    primary: 'body',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      extractionType: 'text',
      pattern: /Platform:\s*[^\n]+/,
      optional: true,
    },
  },
  languageChip: {
    primary: 'body',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      extractionType: 'text',
      pattern: /Language:\s*[^\n]+/,
      optional: true,
    },
  },
  dateRangeChip: {
    primary: 'body',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      extractionType: 'text',
      pattern: /Impressions by date:\s*[^\n]+/,
      optional: true,
    },
  },
};

// ── Filters panel (modal dialog) ─────────────────────────────────

export const filtersPanelSelectors: SelectorGroup = {
  dialog: {
    primary: 'div[role="dialog"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeVisible: true,
      // The filters dialog is at x>400, width 600, height ~640.
    },
  },
  languageCombobox: {
    primary: 'div[role="combobox"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
      // Inside panel, x > 400, y 260-320. Text: "All languages" or language name.
    },
  },
  advertiserCombobox: {
    primary: 'div[role="combobox"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
      // Inside panel, x > 400, y 340-395. Text: "All advertisers" or advertiser name.
    },
  },
  advertiserSearchInput: {
    primary: 'input[type="text"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeVisible: true,
      // Appears after clicking advertiser combobox, y 380-450, x > 400.
    },
  },
  platformCombobox: {
    primary: 'div[role="combobox"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
      // Inside panel, x > 400, y 410-470. Text: "All platforms" or platform name.
    },
  },
  mediaTypeCombobox: {
    primary: 'div[role="combobox"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
      // Inside panel, x > 400, y 490-550. Text: "All media types" or type name.
    },
  },
  activeStatusCombobox: {
    primary: 'div[role="combobox"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
      // Inside panel, x > 400, y 560-620. Text: "Active ads", "Inactive ads", or "Active and inactive".
    },
  },
  dateFromInput: {
    primary: 'input[placeholder="mm/dd/yyyy"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      // First mm/dd/yyyy input (index 0), x ~491.
    },
  },
  dateToInput: {
    primary: 'input[placeholder="mm/dd/yyyy"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      // Second mm/dd/yyyy input (index 1), x ~768.
    },
  },
  applyButton: {
    primary: 'div[role="none"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
      // Text: "Apply N filter(s)". Located at bottom of dialog.
    },
  },
  clearAllButton: {
    primary: 'div[role="none"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
      optional: true,
      // Text: "Clear all". Located at y > 700 inside the panel.
    },
  },
  closeButton: {
    primary: '[role="button"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
      // Parent role="button" containing text "Close", top-right of dialog.
    },
  },
  dropdownOption: {
    primary: '[role="option"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'many',
      mustBeClickable: true,
      // Appears after clicking any combobox in the panel.
    },
  },
};

// ── Ad card extraction selectors ─────────────────────────────────

export const adCardSelectors: SelectorGroup = {
  libraryId: {
    primary: 'body',
    fallbacks: [],
    type: 'css',
    contract: { expectedCount: 'many', extractionType: 'text', pattern: /Library ID:\s*\d+/ },
  },
  startDate: {
    primary: 'body',
    fallbacks: [],
    type: 'css',
    contract: { expectedCount: 'many', extractionType: 'text', pattern: /Started running on\s+[A-Za-z]+ \d+, \d+/ },
  },
  activeStatus: {
    primary: 'body',
    fallbacks: [],
    type: 'css',
    contract: { expectedCount: 'many', extractionType: 'text', pattern: /\n(Active|Inactive)\n/ },
  },
  creativeImage: {
    primary: 'img[src*="fbcdn.net"]',
    fallbacks: [],
    type: 'css',
    contract: { expectedCount: 'many', extractionType: 'attribute', attribute: 'src' },
  },
  video: {
    primary: 'video',
    fallbacks: [],
    type: 'css',
    contract: { expectedCount: 'many', optional: true },
  },
  landingLink: {
    primary: 'a[href*="l.facebook.com"], a[href*="fb.me"]',
    fallbacks: [],
    type: 'css',
    contract: { expectedCount: 'many', optional: true },
  },
  ctaButton: {
    primary: 'div, span',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'many',
      extractionType: 'text',
      // Match exact CTA text: "Shop now", "Learn more", "Sign up", etc.
    },
  },
  advertiserProfileLink: {
    primary: 'a[href*="facebook.com/"]',
    fallbacks: [],
    type: 'css',
    contract: { expectedCount: 'many', extractionType: 'attribute', attribute: 'href' },
  },
  platformIcon: {
    primary: 'div[style*="mask-image"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'many',
      // 12x12px divs with CSS mask-image sprites. Group by Y-position for per-ad counts.
    },
  },
  seeAdDetailsButton: {
    primary: 'div[role="button"]',
    fallbacks: [],
    type: 'css',
    contract: {
      expectedCount: 'many',
      mustBeClickable: true,
      // Text: "See ad details"
    },
  },
};

export const facebookSelectors = {
  topBar: topBarSelectors,
  filterChips: filterChipSelectors,
  filtersPanel: filtersPanelSelectors,
  adCard: adCardSelectors,
};
