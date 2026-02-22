/**
 * LinkedIn Connection Operations
 * Safari automation for connection requests, profile extraction, and lead scoring.
 */

import { SafariDriver, getDefaultDriver } from './safari-driver.js';
import type {
  LinkedInProfile,
  ConnectionRequest,
  ConnectionResult,
  ConnectionStatus,
  PendingRequest,
  SearchResult,
  PeopleSearchConfig,
  LeadScore,
  NavigationResult,
} from './types.js';
import { LINKEDIN_SELECTORS as SEL } from './types.js';

const LINKEDIN_NETWORK = 'https://www.linkedin.com/mynetwork/';
const LINKEDIN_SEARCH = 'https://www.linkedin.com/search/results/people/';

// ─── Navigation ──────────────────────────────────────────────

export async function navigateToNetwork(driver?: SafariDriver): Promise<NavigationResult> {
  const d = driver || getDefaultDriver();
  const success = await d.navigateTo(LINKEDIN_NETWORK);
  if (!success) return { success: false, error: 'Failed to navigate to My Network' };
  await d.wait(3000);
  const isLoggedIn = await d.isLoggedIn();
  if (!isLoggedIn) return { success: false, error: 'Not logged in to LinkedIn' };
  return { success: true, currentUrl: await d.getCurrentUrl() };
}

export async function navigateToProfile(profileUrl: string, driver?: SafariDriver): Promise<NavigationResult> {
  const d = driver || getDefaultDriver();
  const url = profileUrl.startsWith('http') ? profileUrl : `https://www.linkedin.com/in/${profileUrl}/`;
  const success = await d.navigateTo(url);
  if (!success) return { success: false, error: 'Failed to navigate to profile' };
  await d.wait(3000);
  return { success: true, currentUrl: await d.getCurrentUrl() };
}

// ─── Profile Extraction ──────────────────────────────────────

export async function extractProfile(profileUrl: string, driver?: SafariDriver): Promise<LinkedInProfile | null> {
  const d = driver || getDefaultDriver();
  const nav = await navigateToProfile(profileUrl, d);
  if (!nav.success) return null;

  await d.humanDelay(2000, 4000);

  const profileJson = await d.executeJS(`
    (function() {
      var nameEl = document.querySelector('h1.text-heading-xlarge, h1[class*="break-words"]');
      var name = nameEl ? nameEl.innerText.trim() : '';

      var headlineEl = document.querySelector('.text-body-medium[data-generated-suggestion-target], div.text-body-medium');
      var headline = headlineEl ? headlineEl.innerText.trim() : '';

      var locationEl = document.querySelector('span.text-body-small[class*="inline"]');
      var location = locationEl ? locationEl.innerText.trim() : '';

      var aboutSection = document.querySelector('#about');
      var about = '';
      if (aboutSection) {
        var aboutText = aboutSection.closest('section');
        if (aboutText) {
          var spans = aboutText.querySelectorAll('.inline-show-more-text span[aria-hidden="true"]');
          if (spans.length > 0) about = spans[0].innerText.trim();
        }
      }

      // Connection degree
      var degreeEl = document.querySelector('.dist-value, span.distance-badge');
      var degree = degreeEl ? degreeEl.innerText.trim().replace(/[^\\d]/g, '') : '';
      var connectionDegree = degree === '1' ? '1st' : degree === '2' ? '2nd' : degree === '3' ? '3rd' : 'out_of_network';

      // Mutual connections
      var mutualEl = document.querySelector('a[href*="mutual-connections"] span, [class*="mutual-connections"]');
      var mutualText = mutualEl ? mutualEl.innerText.trim() : '0';
      var mutualMatch = mutualText.match(/(\\d+)/);
      var mutualConnections = mutualMatch ? parseInt(mutualMatch[1]) : 0;

      // Current position
      var expSection = document.querySelector('#experience');
      var currentPosition = null;
      if (expSection) {
        var expContainer = expSection.closest('section');
        if (expContainer) {
          var firstExp = expContainer.querySelector('.pvs-list__paged-list-item');
          if (firstExp) {
            var titleEl = firstExp.querySelector('span[aria-hidden="true"]');
            var companyEl = firstExp.querySelectorAll('span[aria-hidden="true"]');
            var durationEl = firstExp.querySelector('.pvs-entity__caption-wrapper span[aria-hidden="true"]');
            currentPosition = {
              title: titleEl ? titleEl.innerText.trim() : '',
              company: companyEl.length > 1 ? companyEl[1].innerText.trim() : '',
              duration: durationEl ? durationEl.innerText.trim() : '',
            };
          }
        }
      }

      // Open to work / Hiring
      var isOpenToWork = !!document.querySelector('[class*="open-to-work"], .pv-open-to-carousel');
      var isHiring = !!document.querySelector('[class*="hiring"], .pv-hiring-badge');

      // Skills
      var skillEls = document.querySelectorAll('#skills ~ div .pvs-list__paged-list-item span[aria-hidden="true"]');
      var skills = [];
      skillEls.forEach(function(s, i) { if (i < 10) skills.push(s.innerText.trim()); });

      // Connection status buttons
      var canConnect = !!document.querySelector('button[aria-label*="Connect"], button[aria-label*="Invite"]');
      var canMessage = !!document.querySelector('button[aria-label*="Message"]');

      return JSON.stringify({
        name: name,
        headline: headline,
        location: location,
        about: about.substring(0, 500),
        currentPosition: currentPosition,
        connectionDegree: connectionDegree,
        mutualConnections: mutualConnections,
        isOpenToWork: isOpenToWork,
        isHiring: isHiring,
        skills: skills,
        canConnect: canConnect,
        canMessage: canMessage,
      });
    })()
  `);

  try {
    const raw = JSON.parse(profileJson || '{}');
    return {
      ...raw,
      profileUrl: nav.currentUrl || profileUrl,
      scrapedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Connection Status ───────────────────────────────────────

export async function getConnectionStatus(profileUrl: string, driver?: SafariDriver): Promise<ConnectionStatus> {
  const d = driver || getDefaultDriver();
  await navigateToProfile(profileUrl, d);
  await d.humanDelay(2000, 3000);

  const statusJson = await d.executeJS(`
    (function() {
      var connected = !!document.querySelector('button[aria-label*="Message"]') &&
                      !document.querySelector('button[aria-label*="Connect"]');
      var pending = !!document.querySelector('button[aria-label*="Pending"]');
      var canConnect = !!document.querySelector('button[aria-label*="Connect"], button[aria-label*="Invite"]');
      var canMessage = !!document.querySelector('button[aria-label*="Message"]');
      var following = !!document.querySelector('button[aria-label*="Following"]');

      var status = 'not_connected';
      if (connected && canMessage) status = 'connected';
      else if (pending) status = 'pending_sent';
      else if (following) status = 'following';

      return JSON.stringify({
        status: status,
        canMessage: canMessage,
        canConnect: canConnect,
      });
    })()
  `);

  try {
    const raw = JSON.parse(statusJson || '{}');
    return { profileUrl, ...raw };
  } catch {
    return { profileUrl, status: 'not_connected', canMessage: false, canConnect: false };
  }
}

// ─── Send Connection Request ─────────────────────────────────

export async function sendConnectionRequest(
  request: ConnectionRequest,
  driver?: SafariDriver
): Promise<ConnectionResult> {
  const d = driver || getDefaultDriver();
  const nav = await navigateToProfile(request.profileUrl, d);
  if (!nav.success) return { success: false, status: 'error', reason: 'Failed to load profile' };

  await d.humanDelay(2000, 4000);

  // Check current status
  const statusCheck = await d.executeJS(`
    (function() {
      var connected = !!document.querySelector('button[aria-label*="Message"]') &&
                      !document.querySelector('button[aria-label*="Connect"]');
      var pending = !!document.querySelector('button[aria-label*="Pending"]');
      if (connected) return 'already_connected';
      if (pending) return 'pending';
      return 'can_connect';
    })()
  `);

  if (statusCheck === 'already_connected' && request.skipIfConnected) {
    return { success: true, status: 'already_connected' };
  }
  if (statusCheck === 'pending' && request.skipIfPending) {
    return { success: true, status: 'pending' };
  }
  if (statusCheck !== 'can_connect') {
    return { success: false, status: statusCheck as any, reason: `Status: ${statusCheck}` };
  }

  // Click Connect button
  const clicked = await d.executeJS(`
    (function() {
      var btn = document.querySelector('button[aria-label*="Connect"]') ||
                document.querySelector('button[aria-label*="Invite"]');
      if (btn) { btn.click(); return 'clicked'; }

      // Check "More" dropdown
      var moreBtn = document.querySelector('button[aria-label="More actions"]');
      if (moreBtn) {
        moreBtn.click();
        return 'more_clicked';
      }
      return 'not_found';
    })()
  `);

  if (clicked === 'not_found') {
    return { success: false, status: 'cannot_connect', reason: 'Connect button not found' };
  }

  if (clicked === 'more_clicked') {
    await d.wait(1000);
    await d.executeJS(`
      (function() {
        var items = document.querySelectorAll('[role="menuitem"], .artdeco-dropdown__content-inner li');
        for (var item of items) {
          if (item.innerText.toLowerCase().includes('connect')) {
            item.click();
            return 'clicked';
          }
        }
        return 'not_found';
      })()
    `);
  }

  await d.wait(2000);

  // Add note if provided
  if (request.note) {
    const addNoteClicked = await d.executeJS(`
      (function() {
        var btn = document.querySelector('button[aria-label="Add a note"]');
        if (btn) { btn.click(); return 'clicked'; }
        return 'not_found';
      })()
    `);

    if (addNoteClicked === 'clicked') {
      await d.wait(1000);

      // Focus the note textarea
      await d.focusElement('textarea#custom-message, textarea[name="message"]');
      await d.wait(300);
      await d.typeViaClipboard(request.note.substring(0, 300));
      await d.wait(500);
    }
  }

  // Click Send
  const sent = await d.executeJS(`
    (function() {
      var btn = document.querySelector('button[aria-label="Send invitation"]') ||
                document.querySelector('button[aria-label="Send"]') ||
                document.querySelector('button[aria-label="Send without a note"]');
      if (btn && !btn.disabled) { btn.click(); return 'sent'; }
      return 'not_found';
    })()
  `);

  await d.wait(2000);

  if (sent === 'sent') {
    return { success: true, status: 'sent' };
  }

  return { success: false, status: 'error', reason: 'Could not send invitation' };
}

// ─── Pending Requests ────────────────────────────────────────

export async function listPendingRequests(
  type: 'received' | 'sent' = 'received',
  driver?: SafariDriver
): Promise<PendingRequest[]> {
  const d = driver || getDefaultDriver();
  const url = type === 'sent'
    ? 'https://www.linkedin.com/mynetwork/invitation-manager/sent/'
    : 'https://www.linkedin.com/mynetwork/invitation-manager/';
  await d.navigateTo(url);
  await d.wait(3000);

  const requestsJson = await d.executeJS(`
    (function() {
      var requests = [];
      var cards = document.querySelectorAll('.invitation-card, .mn-invitation-list li, .invitation-card__container');

      cards.forEach(function(card) {
        try {
          var nameEl = card.querySelector('.invitation-card__title, a[data-test-id] span, strong');
          var name = nameEl ? nameEl.innerText.trim() : '';

          var headlineEl = card.querySelector('.invitation-card__subtitle, .invitation-card__occupation');
          var headline = headlineEl ? headlineEl.innerText.trim() : '';

          var linkEl = card.querySelector('a[href*="/in/"]');
          var profileUrl = linkEl ? linkEl.href : '';

          var mutualEl = card.querySelector('.member-insights__reason, [class*="mutual"]');
          var mutualText = mutualEl ? mutualEl.innerText.trim() : '0';
          var mutualMatch = mutualText.match(/(\\d+)/);
          var mutual = mutualMatch ? parseInt(mutualMatch[1]) : 0;

          if (name) {
            requests.push(JSON.stringify({
              name: name,
              headline: headline.substring(0, 100),
              profileUrl: profileUrl,
              mutualConnections: mutual,
              type: '${type}',
            }));
          }
        } catch(e) {}
      });

      return '[' + requests.slice(0, 30).join(',') + ']';
    })()
  `);

  try {
    return JSON.parse(requestsJson || '[]') as PendingRequest[];
  } catch {
    return [];
  }
}

export async function acceptRequest(profileUrl: string, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();

  const result = await d.executeJS(`
    (function() {
      var cards = document.querySelectorAll('.invitation-card, .mn-invitation-list li');
      for (var card of cards) {
        var link = card.querySelector('a[href*="/in/"]');
        if (link && link.href.includes('${profileUrl.replace(/'/g, "\\'")}')) {
          var btn = card.querySelector('button[aria-label*="Accept"]');
          if (btn) { btn.click(); return 'accepted'; }
        }
      }
      return 'not_found';
    })()
  `);

  return result === 'accepted';
}

// ─── Search Extraction JS ────────────────────────────────────

const SEARCH_EXTRACTION_JS = `
(function() {
  var results = [];
  var processedLis = [];
  var mainEl = document.querySelector('main, [role="main"]');
  if (!mainEl) return '[]';
  var allLis = mainEl.querySelectorAll('li');

  for (var i = 0; i < allLis.length; i++) {
    var li = allLis[i];
    if (processedLis.indexOf(li) !== -1) continue;
    var links = li.querySelectorAll('a[href*="/in/"]');
    if (links.length === 0) continue;
    var href = '';
    for (var x = 0; x < links.length; x++) {
      var h = links[x].href.split('?')[0];
      if (h.indexOf('ACoAA') === -1) { href = h; break; }
    }
    if (!href) href = links[0].href.split('?')[0];
    processedLis.push(li);

    var nameSpans = [];
    var spans = li.querySelectorAll('span[aria-hidden="true"]');
    for (var j = 0; j < spans.length; j++) {
      var cl = spans[j].className || '';
      if (cl.indexOf('visually-hidden') !== -1) continue;
      var st = spans[j].innerText.trim();
      if (st.length > 2 && st.length < 150 && st.indexOf('Status') !== 0) nameSpans.push(st);
    }

    var name = '';
    for (var k = 0; k < nameSpans.length; k++) {
      if (nameSpans[k].charAt(0) !== '\\u2022' && nameSpans[k].indexOf('degree') === -1) {
        name = nameSpans[k]; break;
      }
    }

    var degree = '';
    for (var dd = 0; dd < nameSpans.length; dd++) {
      if (nameSpans[dd].indexOf('1st') !== -1) { degree = '1st'; break; }
      if (nameSpans[dd].indexOf('2nd') !== -1) { degree = '2nd'; break; }
      if (nameSpans[dd].indexOf('3rd') !== -1) { degree = '3rd'; break; }
    }

    var headline = '';
    var location = '';
    var divs = li.querySelectorAll('div');
    for (var di = 0; di < divs.length; di++) {
      var div = divs[di];
      if (div.children.length > 0) continue;
      var dt = div.innerText.trim();
      if (dt.length < 5 || dt.length > 200) continue;
      if (dt === name || dt.indexOf('degree') !== -1 || dt === 'Connect' || dt === 'Message' || dt === 'Follow') continue;
      if (!headline) { headline = dt; }
      else if (!location && dt.length < 60) { location = dt; break; }
    }

    var mutual = 0;
    var allText = li.innerText;
    var mutMatch = allText.match(/(\\\\d+)\\\\s*mutual/i);
    if (mutMatch) mutual = parseInt(mutMatch[1]);

    if (name && href) {
      results.push(JSON.stringify({
        name: name,
        profileUrl: href,
        headline: headline.substring(0, 150),
        location: location,
        connectionDegree: degree,
        mutualConnections: mutual,
      }));
    }
  }

  return '[' + results.slice(0, 20).join(',') + ']';
})()
`;

// ─── People Search ───────────────────────────────────────────

export async function searchPeople(
  config: Partial<PeopleSearchConfig> = {},
  driver?: SafariDriver
): Promise<SearchResult[]> {
  const d = driver || getDefaultDriver();

  const params = new URLSearchParams();
  if (config.keywords?.length) params.set('keywords', config.keywords.join(' '));
  if (config.title) params.set('titleFreeText', config.title);
  if (config.company) params.set('company', config.company);

  const searchUrl = `${LINKEDIN_SEARCH}?${params.toString()}`;
  await d.navigateTo(searchUrl);
  await d.wait(5000);

  // Wait for search results to render inside main (not just nav links)
  const maxWait = 15000;
  const startWait = Date.now();
  while (Date.now() - startWait < maxWait) {
    const check = await d.executeJS(
      'var m = document.querySelector("main"); m && m.querySelectorAll("a[href*=\\"/in/\\"]").length > 0 ? "ready" : "waiting"'
    );
    if (check === 'ready') break;
    await d.wait(1000);
  }
  await d.wait(1000);

  const resultsJson = await d.executeJS(SEARCH_EXTRACTION_JS);
  

  try {
    return JSON.parse(resultsJson || '[]') as SearchResult[];
  } catch {
    return [];
  }
}

// ─── Lead Scoring ────────────────────────────────────────────

export function scoreProfile(
  profile: LinkedInProfile,
  targetTitles: string[] = [],
  targetCompanies: string[] = [],
  targetLocations: string[] = [],
): LeadScore {
  const factors: LeadScore['factors'] = {
    titleMatch: 0,
    companyMatch: 0,
    locationMatch: 0,
    connectionProximity: 0,
    activityLevel: 0,
  };

  // Title match (0-30)
  if (targetTitles.length > 0 && profile.currentPosition?.title) {
    const titleLower = profile.currentPosition.title.toLowerCase();
    const match = targetTitles.some(t => titleLower.includes(t.toLowerCase()));
    factors.titleMatch = match ? 30 : 5;
  } else {
    factors.titleMatch = 10;
  }

  // Company match (0-20)
  if (targetCompanies.length > 0 && profile.currentPosition?.company) {
    const companyLower = profile.currentPosition.company.toLowerCase();
    const match = targetCompanies.some(c => companyLower.includes(c.toLowerCase()));
    factors.companyMatch = match ? 20 : 3;
  } else {
    factors.companyMatch = 8;
  }

  // Location match (0-15)
  if (targetLocations.length > 0 && profile.location) {
    const locLower = profile.location.toLowerCase();
    const match = targetLocations.some(l => locLower.includes(l.toLowerCase()));
    factors.locationMatch = match ? 15 : 3;
  } else {
    factors.locationMatch = 8;
  }

  // Connection proximity (0-20)
  if (profile.connectionDegree === '1st') factors.connectionProximity = 20;
  else if (profile.connectionDegree === '2nd') factors.connectionProximity = 15;
  else if (profile.connectionDegree === '3rd') factors.connectionProximity = 8;
  else factors.connectionProximity = 3;

  // Activity signals (0-15)
  if (profile.isOpenToWork) factors.activityLevel += 5;
  if (profile.isHiring) factors.activityLevel += 5;
  if (profile.about && profile.about.length > 50) factors.activityLevel += 5;

  const totalScore = Object.values(factors).reduce((a, b) => a + b, 0);

  const recommendation: LeadScore['recommendation'] =
    totalScore >= 70 ? 'high_priority' :
    totalScore >= 50 ? 'medium' :
    totalScore >= 30 ? 'low' :
    'skip';

  const reasons: string[] = [];
  if (factors.titleMatch >= 20) reasons.push('Title match');
  if (factors.companyMatch >= 15) reasons.push('Company match');
  if (factors.connectionProximity >= 15) reasons.push('Close connection');
  if (factors.activityLevel >= 8) reasons.push('Active profile');
  if (reasons.length === 0) reasons.push('General prospect');

  return {
    profileUrl: profile.profileUrl,
    totalScore,
    factors,
    recommendation,
    reason: reasons.join(', '),
  };
}
