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

// ─── Profile Extraction JS (Feb 2026 LinkedIn DOM) ──────────

const PROFILE_EXTRACTION_JS = `
(function() {
  var mainEl = document.querySelector('main');
  if (!mainEl) return JSON.stringify({});
  var mainText = mainEl.innerText;
  var NL = String.fromCharCode(10);
  var lines = mainText.split(NL).map(function(l){return l.trim();}).filter(function(l){return l.length > 0;});

  // Section headings used by LinkedIn profile pages
  var sectionHeadings = ['activity','experience','education','skills','interests','languages','certifications','recommendations','courses','projects','publications','honors','organizations','volunteering','about','people you may know','you might like','more profiles for you'];

  // Name: first h2 in main that is not a section heading
  var h2s = mainEl.querySelectorAll('h2');
  var name = '';
  for (var i = 0; i < h2s.length; i++) {
    var t = h2s[i].innerText.trim();
    if (t.length > 2 && t.length < 60 && sectionHeadings.indexOf(t.toLowerCase()) === -1 && t.indexOf('notification') === -1 && t.indexOf('Ad ') !== 0 && t.indexOf('Don') !== 0) { name = t; break; }
  }

  // Find ordered section boundaries from lines
  function findSection(heading) {
    for (var si = 0; si < lines.length; si++) { if (lines[si].toLowerCase() === heading.toLowerCase()) return si; }
    return -1;
  }
  function nextSectionAfter(idx) {
    for (var ni = idx + 1; ni < lines.length; ni++) {
      if (sectionHeadings.indexOf(lines[ni].toLowerCase()) !== -1) return ni;
    }
    return lines.length;
  }

  // Parse intro block
  var nameIdx = -1;
  for (var ni = 0; ni < lines.length; ni++) { if (lines[ni] === name) { nameIdx = ni; break; } }
  var headline = '';
  var location = '';
  var connectionDegree = 'out_of_network';
  var mutualConnections = 0;
  if (nameIdx >= 0) {
    for (var li = nameIdx + 1; li < Math.min(nameIdx + 15, lines.length); li++) {
      var line = lines[li];
      if (line.match(/[123](?:st|nd|rd)/i) && line.length < 10) { var dNum = line.replace(/[^123]/g,''); connectionDegree = dNum === '1' ? '1st' : dNum === '2' ? '2nd' : '3rd'; continue; }
      if (line.toLowerCase() === 'contact info' || line === 'Connect' || line === 'Message' || line === 'Follow') continue;
      var mutMatch = line.match(/(\\d+).*mutual/i);
      if (mutMatch) { mutualConnections = parseInt(mutMatch[1]) || 0; continue; }
      if (line.toLowerCase().indexOf('mutual') !== -1) continue;
      if (sectionHeadings.indexOf(line.toLowerCase()) !== -1) break;
      if (line === 'Show all') break;
      if (!headline && line.length > 5 && line !== name) { headline = line; continue; }
      if (headline && !location && (line.indexOf(',') !== -1 || line.indexOf('United States') !== -1)) { location = line; continue; }
    }
  }

  // Experience: parse text between "Experience" and next section heading
  var currentPosition = null;
  var expIdx = findSection('Experience');
  if (expIdx >= 0) {
    var expEnd = nextSectionAfter(expIdx);
    var expLines = lines.slice(expIdx + 1, Math.min(expIdx + 8, expEnd));
    if (expLines.length >= 2) {
      var title = expLines[0] || '';
      var company = expLines[1] || '';
      var duration = '';
      for (var ei = 2; ei < expLines.length; ei++) {
        if (expLines[ei].match(/\\d{4}\\s*-|\\d+\\s+(yr|mo)/i)) { duration = expLines[ei]; break; }
      }
      currentPosition = { title: title, company: company, duration: duration };
    }
  }

  // About: text between "About" and next section heading
  var about = '';
  var aboutIdx = findSection('About');
  if (aboutIdx >= 0) {
    var aboutEnd = nextSectionAfter(aboutIdx);
    var aboutLines = lines.slice(aboutIdx + 1, aboutEnd);
    about = aboutLines.join(' ').substring(0, 500);
  }

  // Skills: text between "Skills" and next section heading
  var skills = [];
  var skillsIdx = findSection('Skills');
  if (skillsIdx >= 0) {
    var skillsEnd = nextSectionAfter(skillsIdx);
    var skillLines = lines.slice(skillsIdx + 1, skillsEnd);
    for (var ski = 0; ski < skillLines.length && skills.length < 10; ski++) {
      var sl = skillLines[ski];
      if (sl.length > 1 && sl.length < 60 && sl !== 'Show all' && !sl.match(/^\\d+ endorsement/i)) skills.push(sl);
    }
  }

  // Open to work / Hiring
  var isOpenToWork = mainText.indexOf('Open to work') !== -1 || mainText.indexOf('#OpenToWork') !== -1;
  var isHiring = mainText.indexOf('Hiring') !== -1 || mainText.indexOf('#Hiring') !== -1;

  // Buttons AND anchors (LinkedIn Feb 2026 uses <a> for Connect/Message)
  var canConnect = false; var canMessage = false;
  var buttons = document.querySelectorAll('button');
  for (var bi = 0; bi < buttons.length; bi++) {
    var label = (buttons[bi].getAttribute('aria-label') || '') + ' ' + buttons[bi].innerText;
    if (label.match(/Connect|Invite.*connect/i)) canConnect = true;
    if (label.match(/^Message/i)) canMessage = true;
  }
  var anchors = document.querySelectorAll('a');
  for (var ai = 0; ai < anchors.length; ai++) {
    var aLabel = (anchors[ai].getAttribute('aria-label') || '') + ' ' + anchors[ai].innerText.trim();
    var aHref = anchors[ai].href || '';
    if (aLabel.match(/Connect|Invite.*connect/i) || aHref.indexOf('custom-invite') !== -1) canConnect = true;
    if (aLabel.match(/^Message/i) || aHref.indexOf('/messaging/compose') !== -1) canMessage = true;
  }

  return JSON.stringify({ name: name, headline: headline, location: location, about: about, currentPosition: currentPosition, connectionDegree: connectionDegree, mutualConnections: mutualConnections, isOpenToWork: isOpenToWork, isHiring: isHiring, skills: skills, canConnect: canConnect, canMessage: canMessage });
})()
`;

// ─── Profile Extraction ──────────────────────────────────────

export async function extractProfile(profileUrl: string, driver?: SafariDriver): Promise<LinkedInProfile | null> {
  const d = driver || getDefaultDriver();
  const nav = await navigateToProfile(profileUrl, d);
  if (!nav.success) return null;

  await d.wait(5000);
  // Wait for profile content to render (h2 inside main)
  const maxWait = 15000;
  const startWait = Date.now();
  while (Date.now() - startWait < maxWait) {
    const check = await d.executeJS(
      'var m = document.querySelector("main"); m && m.querySelectorAll("h2").length > 2 ? "ready" : "waiting"'
    );
    if (check === 'ready') break;
    await d.wait(1000);
  }
  await d.wait(1000);

  // Single round-trip using combined PROFILE_EXTRACTION_JS (was 5 separate calls)
  const rawResult = await d.executeJS(PROFILE_EXTRACTION_JS);

  try {
    const data = JSON.parse(rawResult || '{}');

    return {
      profileUrl: nav.currentUrl || profileUrl,
      name: data.name || '',
      headline: data.headline || '',
      location: data.location || '',
      about: data.about || '',
      currentPosition: data.currentPosition?.title ? data.currentPosition : undefined,
      connectionDegree: data.connectionDegree || 'out_of_network',
      mutualConnections: data.mutualConnections || 0,
      isOpenToWork: data.isOpenToWork || false,
      isHiring: data.isHiring || false,
      skills: Array.isArray(data.skills) ? data.skills : [],
      canConnect: data.canConnect || false,
      canMessage: data.canMessage || false,
      scrapedAt: new Date().toISOString(),
    } as any;
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
      var canMessage = false, canConnect = false, pending = false, following = false;
      // Check buttons
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
        if (a.indexOf('message') !== -1) canMessage = true;
        if (a.indexOf('connect') !== -1 || a.indexOf('invite') !== -1) canConnect = true;
        if (a.indexOf('pending') !== -1) pending = true;
        if (a.indexOf('following') !== -1) following = true;
      }
      // Check anchors (LinkedIn Feb 2026 uses <a> for Connect/Message)
      var anchors = document.querySelectorAll('a');
      for (var j = 0; j < anchors.length; j++) {
        var al = (anchors[j].getAttribute('aria-label') || '').toLowerCase();
        var ah = (anchors[j].href || '').toLowerCase();
        if (al.indexOf('message') !== -1 || ah.indexOf('/messaging/compose') !== -1) canMessage = true;
        if (al.indexOf('connect') !== -1 || al.indexOf('invite') !== -1 || ah.indexOf('custom-invite') !== -1) canConnect = true;
      }

      var status = 'not_connected';
      if (canMessage && !canConnect) status = 'connected';
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

  // Check current status — look at profile section buttons AND anchors
  const statusCheck = await d.executeJS(`
    (function() {
      var main = document.querySelector('main');
      if (!main) return 'no_main';
      var section = main.querySelector('section');
      if (!section) return 'no_section';
      var hasMessage = false, hasPending = false, hasConnect = false, hasFollow = false, hasMore = false;
      // Check buttons
      var btns = section.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
        var t = btns[i].innerText.trim().toLowerCase();
        if (a.includes('message')) hasMessage = true;
        if (a.includes('pending')) hasPending = true;
        if (a.includes('connect') || a.includes('invite')) hasConnect = true;
        if (a.includes('follow')) hasFollow = true;
        if (a === 'more') hasMore = true;
      }
      // Check anchors (LinkedIn Feb 2026 renders Connect/Message as <a> tags)
      var anchors = section.querySelectorAll('a');
      for (var j = 0; j < anchors.length; j++) {
        var aa = (anchors[j].getAttribute('aria-label') || '').toLowerCase();
        var at = anchors[j].innerText.trim().toLowerCase();
        var ah = (anchors[j].href || '').toLowerCase();
        if (aa.includes('message') || at === 'message' || ah.includes('/messaging/compose')) hasMessage = true;
        if (aa.includes('pending') || at === 'pending') hasPending = true;
        if (aa.includes('connect') || aa.includes('invite') || at === 'connect' || ah.includes('custom-invite')) hasConnect = true;
        if (aa.includes('follow') || at === 'follow') hasFollow = true;
      }
      if (hasPending) return 'pending';
      if (hasMessage && !hasConnect && !hasFollow) return 'already_connected';
      if (hasConnect) return 'can_connect_direct';
      if (hasFollow && hasMore) return 'can_connect_via_more';
      if (hasMore) return 'can_connect_via_more';
      return 'unknown';
    })()
  `);

  console.log(`[Connection] Status check for ${request.profileUrl}: ${statusCheck}`);

  if (statusCheck === 'already_connected' && request.skipIfConnected) {
    return { success: true, status: 'already_connected' };
  }
  if (statusCheck === 'pending' && request.skipIfPending) {
    return { success: true, status: 'pending' };
  }

  // Direct Connect button or anchor
  if (statusCheck === 'can_connect_direct') {
    await d.executeJS(`
      (function() {
        var main = document.querySelector('main');
        var section = main.querySelector('section');
        // Try buttons first
        var btns = section.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
          if (a.includes('connect') || a.includes('invite')) { btns[i].click(); return 'clicked_btn'; }
        }
        // Try anchors (LinkedIn Feb 2026 uses <a> for Connect)
        var anchors = section.querySelectorAll('a');
        for (var j = 0; j < anchors.length; j++) {
          var aa = (anchors[j].getAttribute('aria-label') || '').toLowerCase();
          var at = anchors[j].innerText.trim().toLowerCase();
          if (aa.includes('connect') || aa.includes('invite') || at === 'connect') { anchors[j].click(); return 'clicked_anchor'; }
        }
        return 'not_found';
      })()
    `);
    await d.wait(2000);

  } else if (statusCheck === 'can_connect_via_more') {
    // Open More dropdown in profile section
    await d.executeJS(`
      (function() {
        var main = document.querySelector('main');
        var section = main.querySelector('section');
        var btn = section.querySelector('button[aria-label="More"]');
        if (btn) btn.click();
      })()
    `);
    await d.wait(1500);

    // Click Connect in dropdown
    const connectClicked = await d.executeJS(`
      (function() {
        var items = document.querySelectorAll('[role="menuitem"], .artdeco-dropdown__content-inner li, .artdeco-dropdown__item');
        for (var i = 0; i < items.length; i++) {
          if (items[i].innerText.trim().toLowerCase() === 'connect') {
            items[i].click();
            return 'clicked';
          }
        }
        return 'not_found';
      })()
    `);

    console.log(`[Connection] Connect from More dropdown: ${connectClicked}`);
    if (connectClicked === 'not_found') {
      return { success: false, status: 'cannot_connect', reason: 'Connect not in More menu' };
    }
    await d.wait(2000);

  } else {
    return { success: false, status: statusCheck as any, reason: `Status: ${statusCheck}` };
  }

  // Add note if provided
  if (request.note) {
    const addNoteClicked = await d.executeJS(`
      (function() {
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
          var t = btns[i].innerText.trim().toLowerCase();
          if (a.includes('add a note') || t === 'add a note') { btns[i].click(); return 'clicked'; }
        }
        return 'not_found';
      })()
    `);

    console.log(`[Connection] Add note button: ${addNoteClicked}`);
    if (addNoteClicked === 'clicked') {
      await d.wait(1500);

      // Focus and type into the note textarea
      await d.focusElement('textarea#custom-message, textarea[name="message"]');
      await d.wait(300);
      await d.typeViaClipboard(request.note.substring(0, 300));
      await d.wait(500);
    }
  }

  // Click Send — try multiple selectors for the invitation button
  const sent = await d.executeJS(`
    (function() {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
        var t = btns[i].innerText.trim().toLowerCase();
        if ((a.includes('send invitation') || a.includes('send now') ||
             t === 'send invitation' || t === 'send' || t === 'send now' ||
             a === 'send without a note' || t === 'send without a note') &&
            !btns[i].disabled) {
          btns[i].click();
          return 'sent';
        }
      }
      return 'not_found';
    })()
  `);

  console.log(`[Connection] Send invitation: ${sent}`);
  await d.wait(2000);

  if (sent === 'sent') {
    return { success: true, status: 'sent', noteSent: !!request.note };
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
        if (link && link.href.includes('${profileUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '')}')) {
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
