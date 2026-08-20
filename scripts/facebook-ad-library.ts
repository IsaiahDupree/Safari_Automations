#!/usr/bin/env npx tsx
/**
 * Facebook Ad Library — Safari Automation CLI
 *
 * Programmatically scrapes the Meta Ad Library through Safari using the
 * browser-scripts module from DemandRadar. Supports all filter controls:
 *   - Top bar: search, country, ad category, sort
 *   - Filters panel: language, advertiser, platform, media type, active status, date range
 *   - Extraction: all ad data, profiles, prices, video durations, platform counts
 *
 * Usage:
 *   npx tsx scripts/facebook-ad-library.ts scrape "fitness supplements"
 *   npx tsx scripts/facebook-ad-library.ts scrape "skincare" --country=GB --media=video
 *   npx tsx scripts/facebook-ad-library.ts filters --language=English --platform=Instagram
 *   npx tsx scripts/facebook-ad-library.ts read-state
 *   npx tsx scripts/facebook-ad-library.ts extract
 *
 * Prerequisites:
 *   Safari > Develop > Allow JavaScript from Apple Events
 */

import { execFileSync, execSync } from 'child_process';
import {
  EXTRACT_ALL_ADS,
  READ_FILTER_STATE,
  DISMISS_DIALOGS,
  SCROLL_TO_BOTTOM,
  CLEAR_SEARCH,
  OPEN_FILTERS_PANEL,
  CLOSE_FILTERS_PANEL,
  READ_FILTERS_PANEL_STATE,
  APPLY_FILTERS_PANEL,
  CLEAR_FILTERS_PANEL,
  CLEAR_ALL_FILTER_CHIPS,
  changeSearch,
  selectAdCategory,
  selectCountry,
  selectSort,
  selectFiltersPanelOption,
  searchFiltersPanelAdvertiser,
  setFiltersPanelDateFrom,
  setFiltersPanelDateTo,
  setActiveStatus,
  setMediaType,
  setPlatforms,
  setLanguage,
  setDateRange,
  removeFilterChip,
} from '../packages/selectors/src/platforms/facebook/scripts/ad-library-browser-scripts';

// ── Safari JS execution ──────────────────────────────────────────

function safariExec(script: string): string {
  // Escape the script for AppleScript embedding
  const escaped = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const osascript = `
tell application "Safari"
  set targetDocument to missing value
  repeat with candidateDocument in documents
    try
      if (URL of candidateDocument) contains "facebook.com/ads/library" then
        set targetDocument to candidateDocument
        exit repeat
      end if
    end try
  end repeat
  if targetDocument is missing value then error "No shared Meta Ad Library tab is open"
  return do JavaScript "${escaped}" in targetDocument
end tell`;
  try {
    return execFileSync('osascript', ['-e', osascript], { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch (e: any) {
    return `error: ${e.message}`;
  }
}

function safariOpen(url: string): void {
  const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const osascript = `
tell application "Safari"
  if (count of windows) is 0 then error "Shared Safari window is not available"
  set totalTabs to 0
  repeat with candidateWindow in windows
    set totalTabs to totalTabs + (count of tabs of candidateWindow)
    repeat with candidateTab from 1 to count of tabs of candidateWindow
      try
        if (URL of tab candidateTab of candidateWindow) contains "facebook.com/ads/library" then
          set URL of tab candidateTab of candidateWindow to "${safeUrl}"
          set current tab of candidateWindow to tab candidateTab of candidateWindow
          activate
          return "reused"
        end if
      end try
    end repeat
  end repeat
  if totalTabs is greater than or equal to 8 then error "Safari tab limit reached (8)"
  tell front window
    set targetTab to make new tab with properties {URL:"${safeUrl}"}
    set current tab to targetTab
  end tell
  activate
  return "opened"
end tell`;
  execFileSync('osascript', ['-e', osascript], { encoding: 'utf-8', timeout: 30000 });
}

function wait(ms: number): void {
  execSync(`sleep ${ms / 1000}`);
}

// ── URL builder ──────────────────────────────────────────────────

interface ScrapeOptions {
  country?: string;
  activeStatus?: 'active' | 'inactive' | 'all';
  adType?: string;
  mediaType?: string;
  platforms?: string[];
  language?: string;
  startDateMin?: string;
  startDateMax?: string;
  sortMode?: string;
  sortDirection?: string;
  scrollPasses?: number;
}

function buildUrl(query: string, opts: ScrapeOptions = {}): string {
  const params = new URLSearchParams();
  params.set('active_status', opts.activeStatus || 'active');
  params.set('ad_type', opts.adType || 'all');
  params.set('country', opts.country || 'US');
  params.set('is_targeted_country', 'false');
  params.set('media_type', opts.mediaType || 'all');
  params.set('q', query);
  params.set('search_type', 'keyword_unordered');
  if (opts.sortMode) params.set('sort_data[mode]', opts.sortMode);
  if (opts.sortDirection) params.set('sort_data[direction]', opts.sortDirection);
  if (opts.language) params.set('content_languages[0]', opts.language);
  if (opts.startDateMin) params.set('start_date[min]', opts.startDateMin);
  if (opts.startDateMax) params.set('start_date[max]', opts.startDateMax);
  if (opts.platforms) {
    opts.platforms.forEach((p, i) => params.set(`publisher_platforms[${i}]`, p));
  }
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

// ── Commands ─────────────────────────────────────────────────────

async function cmdScrape(query: string, opts: ScrapeOptions): Promise<void> {
  const url = buildUrl(query, opts);
  const scrollPasses = opts.scrollPasses || 3;

  console.log(`\n🔍 Scraping: "${query}"`);
  console.log(`🌐 Country: ${opts.country || 'US'}`);
  console.log(`📎 URL: ${url}\n`);

  // Open Safari
  safariOpen(url);
  console.log('⏳ Waiting for page load...');
  wait(8000);

  // Dismiss dialogs
  const dialogResult = safariExec(DISMISS_DIALOGS);
  console.log(`🚪 Dialogs: ${dialogResult}`);
  wait(1000);

  // Scroll to load more ads
  for (let i = 0; i < scrollPasses; i++) {
    safariExec(SCROLL_TO_BOTTOM);
    console.log(`📜 Scroll ${i + 1}/${scrollPasses}`);
    wait(2500);
  }

  // Extract all data
  console.log('\n📊 Extracting ad data...');
  const rawJson = safariExec(EXTRACT_ALL_ADS);

  try {
    const data = JSON.parse(rawJson);
    console.log('\n═══════════════════════════════════════');
    console.log('   Facebook Ad Library Scrape Results');
    console.log('═══════════════════════════════════════');
    console.log(`   Query:              ${query}`);
    console.log(`   Total Results:      ~${data.totalResults}`);
    console.log(`   Library IDs:        ${data.libraryIds?.length || 0}`);
    console.log(`   Advertisers:        ${data.advertisers?.length || 0}`);
    console.log(`   Start Dates:        ${data.startDates?.length || 0}`);
    console.log(`   Ad Copy Blocks:     ${data.sampleAdCopy?.length || 0}`);
    console.log(`   Active Statuses:    ${data.activeStatuses?.length || 0}`);
    console.log(`   CTA Buttons:        ${data.ctaButtons?.length || 0}`);
    console.log(`   Landing URLs:       ${data.landingLinks?.length || 0}`);
    console.log(`   Landing Domains:    ${data.landingDomains?.length || 0}`);
    console.log(`   Headlines:          ${data.headlines?.length || 0}`);
    console.log(`   Images:             ${data.creativeImages?.length || 0}`);
    console.log(`   Videos:             ${data.videos?.length || 0}`);
    console.log(`   Advertiser Profiles:${data.advertiserProfiles?.length || 0}`);
    console.log(`   Multi-version Ads:  ${data.multiVersionCount || 0}`);
    console.log(`   Shared Creatives:   ${data.sharedCreatives?.length || 0}`);
    console.log(`   Platform Groups:    ${data.platformIconCounts?.length || 0}`);
    console.log(`   Prices:             ${data.prices?.length || 0}`);
    console.log(`   Video Durations:    ${data.videoDurations?.length || 0}`);
    console.log(`   Filter Chips:       ${data.filterChips?.length || 0}`);
    console.log('═══════════════════════════════════════\n');

    // Save to file
    const outFile = `/tmp/fb-ad-library-${Date.now()}.json`;
    require('fs').writeFileSync(outFile, JSON.stringify(data, null, 2));
    console.log(`💾 Full JSON saved to: ${outFile}`);
  } catch {
    console.error('❌ Failed to parse extraction result');
    console.log(rawJson.substring(0, 500));
  }
}

async function cmdReadState(): Promise<void> {
  console.log('\n📋 Reading filter bar state...');
  const result = safariExec(READ_FILTER_STATE);
  try {
    const state = JSON.parse(result);
    console.log(JSON.stringify(state, null, 2));
  } catch {
    console.log(result);
  }
}

async function cmdReadPanelState(): Promise<void> {
  console.log('\n📋 Reading Filters panel state...');
  const result = safariExec(READ_FILTERS_PANEL_STATE);
  try {
    const state = JSON.parse(result);
    console.log(JSON.stringify(state, null, 2));
  } catch {
    console.log(result);
  }
}

async function cmdExtract(): Promise<void> {
  console.log('\n📊 Extracting from current page...');
  const rawJson = safariExec(EXTRACT_ALL_ADS);
  try {
    const data = JSON.parse(rawJson);
    const outFile = `/tmp/fb-ad-library-${Date.now()}.json`;
    require('fs').writeFileSync(outFile, JSON.stringify(data, null, 2));
    console.log(`✅ Extracted ${data.libraryIds?.length || 0} ads. Saved to: ${outFile}`);
  } catch {
    console.error('❌ Parse error');
    console.log(rawJson.substring(0, 500));
  }
}

async function cmdOpenFilters(): Promise<void> {
  console.log('📂 Opening Filters panel...');
  console.log(safariExec(OPEN_FILTERS_PANEL));
}

async function cmdCloseFilters(): Promise<void> {
  console.log('📁 Closing Filters panel...');
  console.log(safariExec(CLOSE_FILTERS_PANEL));
}

async function cmdApplyFilters(): Promise<void> {
  console.log('✅ Applying filters...');
  console.log(safariExec(APPLY_FILTERS_PANEL));
}

async function cmdClearFilters(): Promise<void> {
  console.log('🧹 Clearing panel filters...');
  console.log(safariExec(CLEAR_FILTERS_PANEL));
}

async function cmdClearChips(): Promise<void> {
  console.log('🧹 Clearing all filter chips...');
  console.log(safariExec(CLEAR_ALL_FILTER_CHIPS));
}

async function cmdSetFilter(field: string, value: string): Promise<void> {
  // For Filters panel options
  const fieldMap: Record<string, 'language' | 'advertiser' | 'platform' | 'mediaType' | 'activeStatus'> = {
    language: 'language',
    advertiser: 'advertiser',
    platform: 'platform',
    media: 'mediaType',
    'media-type': 'mediaType',
    status: 'activeStatus',
    'active-status': 'activeStatus',
  };
  const mappedField = fieldMap[field];
  if (!mappedField) {
    console.error(`Unknown filter field: ${field}. Available: ${Object.keys(fieldMap).join(', ')}`);
    return;
  }
  console.log(`🔧 Opening Filters panel...`);
  safariExec(OPEN_FILTERS_PANEL);
  wait(2000);
  console.log(`🔧 Setting ${mappedField} → ${value}...`);
  const script = selectFiltersPanelOption(mappedField, value);
  console.log(safariExec(script));
}

async function cmdSearch(query: string): Promise<void> {
  console.log(`🔍 Changing search to: "${query}"`);
  console.log(safariExec(changeSearch(query)));
}

async function cmdSetDate(which: 'from' | 'to', dateStr: string): Promise<void> {
  console.log(`📅 Setting date ${which} → ${dateStr}`);
  const script = which === 'from' ? setFiltersPanelDateFrom(dateStr) : setFiltersPanelDateTo(dateStr);
  console.log(safariExec(script));
}

// ── CLI ──────────────────────────────────────────────────────────

function parseArgs(): { command: string; args: string[]; opts: ScrapeOptions } {
  const argv = process.argv.slice(2);
  const command = argv[0] || 'help';
  const args: string[] = [];
  const opts: ScrapeOptions = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, val] = arg.substring(2).split('=');
      switch (key) {
        case 'country': opts.country = val; break;
        case 'status': opts.activeStatus = val as any; break;
        case 'media': opts.mediaType = val; break;
        case 'ad-type': opts.adType = val; break;
        case 'language': opts.language = val; break;
        case 'platforms': opts.platforms = val.split(','); break;
        case 'date-min': opts.startDateMin = val; break;
        case 'date-max': opts.startDateMax = val; break;
        case 'sort': opts.sortMode = val; break;
        case 'sort-dir': opts.sortDirection = val; break;
        case 'scrolls': opts.scrollPasses = parseInt(val); break;
        default: console.warn(`Unknown option: --${key}`);
      }
    } else {
      args.push(arg);
    }
  }

  return { command, args, opts };
}

async function main(): Promise<void> {
  const { command, args, opts } = parseArgs();

  switch (command) {
    case 'scrape':
      if (!args[0]) { console.error('Usage: scrape <query> [--country=US] [--media=video] ...'); return; }
      await cmdScrape(args[0], opts);
      break;

    case 'extract':
      await cmdExtract();
      break;

    case 'read-state':
      await cmdReadState();
      break;

    case 'read-panel':
      await cmdReadPanelState();
      break;

    case 'search':
      if (!args[0]) { console.error('Usage: search <query>'); return; }
      await cmdSearch(args[0]);
      break;

    case 'open-filters':
      await cmdOpenFilters();
      break;

    case 'close-filters':
      await cmdCloseFilters();
      break;

    case 'apply-filters':
      await cmdApplyFilters();
      break;

    case 'clear-filters':
      await cmdClearFilters();
      break;

    case 'clear-chips':
      await cmdClearChips();
      break;

    case 'set-filter':
      if (args.length < 2) { console.error('Usage: set-filter <field> <value>'); return; }
      await cmdSetFilter(args[0], args[1]);
      break;

    case 'set-date':
      if (args.length < 2) { console.error('Usage: set-date <from|to> <mm/dd/yyyy>'); return; }
      await cmdSetDate(args[0] as 'from' | 'to', args[1]);
      break;

    case 'help':
    default:
      console.log(`
Facebook Ad Library — Safari Automation CLI

Commands:
  scrape <query> [options]     Full scrape: open, scroll, extract
  extract                      Extract from current page
  search <query>               Change search query
  read-state                   Read top filter bar state
  read-panel                   Read Filters panel state (must be open)
  open-filters                 Open the Filters panel
  close-filters                Close the Filters panel
  apply-filters                Click Apply in the Filters panel
  clear-filters                Clear all Filters panel fields
  clear-chips                  Clear all filter chips
  set-filter <field> <value>   Set a Filters panel dropdown
  set-date <from|to> <date>    Set a date in the Filters panel

Scrape options:
  --country=US                 Country code
  --status=active              active | inactive | all
  --media=all                  all | image | video | meme | none
  --ad-type=all                all | political_and_issue_ads | housing | ...
  --language=en                Language code
  --platforms=facebook,instagram  Comma-separated platform list
  --date-min=2025-01-01        Start date min
  --date-max=2025-12-31        Start date max
  --sort=total_impressions     Sort mode
  --sort-dir=desc              Sort direction
  --scrolls=3                  Number of scroll passes

Filter fields for set-filter:
  language      All languages, English, German, Italian, Spanish
  platform      All platforms, Facebook, Instagram, Messenger, WhatsApp, Threads
  media         All media types, Images, Memes, Videos, No image or video
  status        Active and inactive, Active ads, Inactive ads
  advertiser    (type to search)

Examples:
  npx tsx scripts/facebook-ad-library.ts scrape "fitness supplements"
  npx tsx scripts/facebook-ad-library.ts scrape "skincare" --country=GB --media=video
  npx tsx scripts/facebook-ad-library.ts open-filters
  npx tsx scripts/facebook-ad-library.ts set-filter language English
  npx tsx scripts/facebook-ad-library.ts set-filter platform Instagram
  npx tsx scripts/facebook-ad-library.ts apply-filters
  npx tsx scripts/facebook-ad-library.ts extract
`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
