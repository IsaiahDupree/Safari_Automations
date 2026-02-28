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
  // Wait for the profile name h2 to appear — a non-section-heading h2 inside main.
  // The generic "h2.length > 2" check fires too early on page skeleton elements.
  const SECTION_HEADINGS_INLINE = '["activity","experience","education","skills","interests","languages","certifications","recommendations","courses","projects","publications","honors","organizations","volunteering","about","people you may know","you might like","more profiles for you"]';
  const readyCheck = `(function(){var m=document.querySelector("main");if(!m)return "";var sh=${SECTION_HEADINGS_INLINE};var h2s=m.querySelectorAll("h2");for(var i=0;i<h2s.length;i++){var t=(h2s[i].innerText||"").trim();if(t.length>2&&t.length<60&&sh.indexOf(t.toLowerCase())===-1&&t.indexOf("notification")===-1)return"ready";}return"";})()`
  const maxWait = 20000;
  const startWait = Date.now();
  while (Date.now() - startWait < maxWait) {
    const check = await d.executeJS(readyCheck);
    if (check === 'ready') break;
    await d.wait(1000);
  }
  await d.wait(500);

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
  const log = (msg: string) => console.log(`[Connection] ${msg}`);

  const nav = await navigateToProfile(request.profileUrl, d);
  if (!nav.success) return { success: false, status: 'error', reason: 'Failed to load profile' };

  // Wait for profile section action buttons to actually render (not fixed delay)
  const pageReady = await d.waitForCondition(
    `(function(){var m=document.querySelector('main');if(!m)return '';var s=m.querySelector('section');if(!s)return '';var has=s.querySelector('a[href*="custom-invite"],button[aria-label*="Pending" i],a[href*="/messaging/compose"],button[aria-label*="message" i],button[aria-label*="invite" i]');return has?'ready':'';})()`,
    10000
  );
  if (!pageReady) {
    log('Profile section buttons did not load within 10s');
  }
  await d.wait(3000);

  // ── Step 1: Read actual page state from the DOM ──────────────
  const PAGE_STATE_JS = `(function(){var m=document.querySelector('main');if(!m)return'no_main';var s=m.querySelector('section');if(!s)return'no_section';var r={connect:null,message:null,pending:null,follow:null,more:null};var el;el=s.querySelector('a[href*="custom-invite"]');if(el)r.connect={tag:'a',label:el.getAttribute('aria-label')||'',href:el.href};if(!r.connect){el=s.querySelector('button[aria-label*="invite" i]');if(el)r.connect={tag:'button',label:el.getAttribute('aria-label')||''};}el=s.querySelector('a[href*="/messaging/compose"]');if(el)r.message={tag:'a',href:el.href};if(!r.message){el=s.querySelector('button[aria-label*="message" i]');if(el)r.message={tag:'button'};}el=s.querySelector('button[aria-label*="Pending" i]');if(!el)el=s.querySelector('a[aria-label*="Pending" i]');if(el)r.pending={label:el.getAttribute('aria-label')||''};el=s.querySelector('button[aria-label="More"]');if(!el)el=s.querySelector('button[aria-label="more" i]');if(el)r.more=true;var allEls=s.querySelectorAll('button,a');for(var i=0;i<allEls.length;i++){var lbl=(allEls[i].getAttribute('aria-label')||'').toLowerCase();var txt=(allEls[i].innerText||'').trim().toLowerCase();if((txt==='follow'||lbl==='follow')&&!lbl.includes('unfollow')&&txt!=='unfollow'){r.follow=true;break;}}return JSON.stringify(r);})()`;

  const rawState = await d.executeJS(PAGE_STATE_JS);
  if (rawState === 'no_main' || rawState === 'no_section') {
    return { success: false, status: 'error', reason: `Profile DOM not ready: ${rawState}` };
  }

  let state: { connect: any; message: any; pending: any; follow: any; more: any };
  try { state = JSON.parse(rawState); } catch {
    return { success: false, status: 'error', reason: `Bad state JSON: ${rawState.substring(0, 80)}` };
  }

  log(`State: connect=${!!state.connect} message=${!!state.message} pending=${!!state.pending} follow=${!!state.follow} more=${!!state.more}`);

  // LinkedIn SPA race: page briefly shows Connect anchor before settling on Pending.
  // If Connect is found, poll up to 5s for Pending to appear (catches the transition).
  if (state.connect && !state.pending) {
    const pendingPoll = await d.waitForCondition(
      `(function(){var m=document.querySelector('main');var s=m?m.querySelector('section'):null;if(!s)return '';var p=s.querySelector('button[aria-label*="Pending" i]');return p?p.getAttribute('aria-label'):'';})()`,
      5000, 500
    );
    if (pendingPoll) {
      log(`SPA transition caught: Connect→Pending (${pendingPoll.substring(0, 60)})`);
      try { state = JSON.parse(await d.executeJS(PAGE_STATE_JS)); } catch {}
      log(`State (settled): connect=${!!state.connect} message=${!!state.message} pending=${!!state.pending} follow=${!!state.follow} more=${!!state.more}`);
    }
  }

  // ── Step 2: Determine status from actual DOM elements ────────
  if (state.pending) {
    if (request.skipIfPending) return { success: true, status: 'pending' };
    return { success: false, status: 'pending', reason: state.pending.label };
  }
  if (state.message && !state.connect) {
    if (request.skipIfConnected) return { success: true, status: 'already_connected' };
    return { success: false, status: 'already_connected' };
  }

  // ── Step 3: Determine if we can connect and extract vanityName ──
  const wantsNote = !!request.note;
  let vanityName = '';

  if (state.connect) {
    // Extract vanityName from the Connect anchor href or profile URL
    if (state.connect.href) {
      const vnMatch = state.connect.href.match(/vanityName=([^&]+)/);
      if (vnMatch) vanityName = vnMatch[1];
    }
    if (!vanityName) {
      const urlMatch = request.profileUrl.match(/\/in\/([^/?]+)/);
      if (urlMatch) vanityName = urlMatch[1].replace(/\/$/, '');
    }
  } else if (state.more) {
    // Check if Connect is in the More dropdown
    log('No direct Connect — opening More dropdown...');
    await d.executeJS(`(function(){var m=document.querySelector('main');var s=m.querySelector('section');var btn=s.querySelector('button[aria-label="More"]');if(btn)btn.click();})()`);

    const menuAppeared = await d.waitForCondition(
      `document.querySelector('[role="menuitem"]') ? 'yes' : ''`, 5000
    );
    if (!menuAppeared) {
      return { success: false, status: 'cannot_connect', reason: 'More dropdown did not open' };
    }

    const menuItems = await d.executeJS(
      `(function(){var items=document.querySelectorAll('[role="menuitem"],.artdeco-dropdown__content-inner li');var r=[];for(var i=0;i<items.length;i++)r.push(items[i].innerText.trim().toLowerCase());return JSON.stringify(r);})()`
    );
    log(`More menu items: ${menuItems}`);

    let menuList: string[] = [];
    try { menuList = JSON.parse(menuItems); } catch {}

    if (!menuList.some(t => t === 'connect')) {
      // Close dropdown
      await d.executeJS(`document.body.click()`);
      if (state.follow) {
        return { success: false, status: 'cannot_connect', reason: 'Follow-only profile — Connect not in More menu' };
      }
      return { success: false, status: 'cannot_connect', reason: `Connect not in More menu. Items: ${menuList.join(', ')}` };
    }
    // Close dropdown before proceeding
    await d.executeJS(`document.body.click()`);
    await d.wait(500);

    // Extract vanityName from profile URL
    const urlMatch = request.profileUrl.match(/\/in\/([^/?]+)/);
    if (urlMatch) vanityName = urlMatch[1].replace(/\/$/, '');
  } else if (state.follow) {
    return { success: false, status: 'cannot_connect', reason: 'Follow-only profile — no Connect option available' };
  } else {
    return { success: false, status: 'cannot_connect', reason: 'No Connect, Message, Follow, or More found on profile' };
  }

  // ── Step 4: Send the connection request ──────────────────────
  let noteSent = false;

  if (wantsNote && vanityName) {
    // ── Path A: Navigate to custom-invite page for note form ──
    const customInviteUrl = `https://www.linkedin.com/preload/custom-invite/?vanityName=${vanityName}`;
    log(`Navigating to custom-invite for note: ${customInviteUrl}`);
    await d.navigateTo(customInviteUrl);
    await d.wait(2000);

    // Wait for the custom-invite page buttons
    const pageLoaded = await d.waitForCondition(
      `(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].innerText.trim().toLowerCase()==='add a note')return 'ready';}return '';})()`,
      8000
    );
    if (!pageLoaded) {
      log('Custom-invite page did not load — falling back to no-note send');
    } else {
      // Click "Add a note" to reveal textarea
      await d.executeJS(
        `(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].innerText.trim().toLowerCase()==='add a note'){btns[i].click();return 'clicked';}}return 'miss';})()`
      );
      await d.wait(1000);

      // Type the note via JS value + input event (works with Ember textarea)
      const noteText = request.note!.substring(0, 300).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      const typed = await d.executeJS(
        `(function(){var ta=document.querySelector('textarea#custom-message,textarea[name="message"]');if(!ta)return 'no_textarea';ta.focus();ta.value='${noteText}';ta.dispatchEvent(new Event('input',{bubbles:true}));ta.dispatchEvent(new Event('change',{bubbles:true}));return 'typed:'+ta.value.length;})()`
      );
      log(`Note: ${typed}`);

      if (typed.startsWith('typed:')) {
        await d.wait(500);

        // Wait for Send button to become enabled
        const sendReady = await d.waitForCondition(
          `(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){var t=btns[i].innerText.trim().toLowerCase();if(t==='send'&&!btns[i].disabled)return 'ready';}return '';})()`,
          3000
        );

        if (sendReady) {
          await d.executeJS(
            `(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){var t=btns[i].innerText.trim().toLowerCase();if(t==='send'&&!btns[i].disabled){btns[i].click();return 'sent';}}return 'miss';})()`
          );
          log('Clicked Send (with note)');
          noteSent = true;
        } else {
          log('Send button did not enable — clicking "Send without a note" as fallback');
        }
      }

      // Fallback: if typing failed, send without note
      if (!noteSent) {
        await d.executeJS(
          `(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].innerText.trim().toLowerCase()==='send without a note'){btns[i].click();return 'sent';}}return 'miss';})()`
        );
        log('Sent without note (fallback)');
      }
    }
    await d.wait(2000);

  } else if (wantsNote && !vanityName) {
    // ── Path A fallback: can't extract vanityName, send without note ──
    log('Cannot extract vanityName for custom-invite — sending without note');
    await d.executeJS(`(function(){var m=document.querySelector('main');var s=m.querySelector('section');var el=s.querySelector('a[href*="custom-invite"]');if(!el)el=s.querySelector('button[aria-label*="invite" i]');if(el)el.click();})()`);
    await d.wait(3000);

  } else {
    // ── Path B: No note — JS click sends invitation directly ──
    log(`JS-clicking Connect (no note): ${state.connect?.label || ''}`);
    await d.executeJS(`(function(){var m=document.querySelector('main');var s=m.querySelector('section');var el=s.querySelector('a[href*="custom-invite"]');if(!el)el=s.querySelector('button[aria-label*="invite" i]');if(el)el.click();})()`);
    await d.wait(3000);
  }

  // ── Step 5: Verify Pending ──────
  // If we navigated away (custom-invite path), go back to profile first
  const currentUrl = await d.getCurrentUrl();
  if (!currentUrl.includes(vanityName || '___none___') || currentUrl.includes('/preload/')) {
    await d.navigateTo(request.profileUrl);
    await d.wait(3000);
  }

  // Poll for Pending to appear (SPA may need time)
  const pendingVerified = await d.waitForCondition(
    `(function(){var m=document.querySelector('main');var s=m?m.querySelector('section'):null;if(!s)return '';var p=s.querySelector('button[aria-label*="Pending" i]');return p?p.getAttribute('aria-label'):'';})()`,
    8000, 500
  );

  if (pendingVerified) {
    log(`✓ Verified: Pending confirmed${noteSent ? ' (with note)' : ''}`);
    return { success: true, status: 'sent', noteSent };
  }

  // Final fallback: re-read full state
  const finalState = await d.executeJS(PAGE_STATE_JS);
  let final: any = {};
  try { final = JSON.parse(finalState); } catch {}

  if (final.pending) {
    log(`✓ Verified: Pending confirmed (final check)${noteSent ? ' (with note)' : ''}`);
    return { success: true, status: 'sent', noteSent };
  }
  if (!final.connect && final.message) {
    log('✓ Final: already connected (Connect gone, Message present)');
    return { success: true, status: 'already_connected' };
  }

  log(`✗ Could not verify. Final state: ${finalState.substring(0, 120)}`);
  return { success: false, status: 'error', reason: 'Connection click did not produce Pending state' };
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

// Single-line extraction JS — multi-line template literals return undefined via osascript temp file
const SEARCH_EXTRACTION_JS = '(function(){var results=[];var mainEl=document.querySelector("main,[role=main]");if(!mainEl)return"[]";var cards=mainEl.querySelectorAll("[data-view-name=people-search-result]");if(cards.length===0)cards=mainEl.querySelectorAll("li");for(var i=0;i<cards.length;i++){var card=cards[i];var links=card.querySelectorAll("a[href*=\'/in/\']");if(links.length===0)continue;var href="";for(var x=0;x<links.length;x++){var h=links[x].href.split("?")[0];if(h.indexOf("ACoAA")===-1&&h.indexOf("/in/")!==-1){href=h;break;}}if(!href)href=links[0].href.split("?")[0];var rawLink=(links[0].innerText||links[0].textContent||"").trim();var bulletIdx=rawLink.indexOf("\\u2022");var name=bulletIdx>0?rawLink.substring(0,bulletIdx).trim():rawLink.split("\\n")[0].trim();name=name.replace(/\\s*(1st|2nd|3rd)\\s*$/,"").trim();if(!name||name.length<2){var spans=card.querySelectorAll("span[aria-hidden=true]");for(var j=0;j<spans.length;j++){var st=(spans[j].innerText||"").trim();if(st.length>2&&st.length<100&&st.charAt(0)!=="\\u2022"){name=st;break;}}}var degree="";var allText=card.innerText||"";if(allText.indexOf("1st")!==-1)degree="1st";else if(allText.indexOf("2nd")!==-1)degree="2nd";else if(allText.indexOf("3rd")!==-1)degree="3rd";var headline="";var linkLines=rawLink.split("\\n");if(linkLines.length>1)headline=linkLines[1].trim().substring(0,150);var location="";var divs=card.querySelectorAll("div");for(var di=0;di<divs.length;di++){var div=divs[di];if(div.children.length>0)continue;var dt=(div.innerText||"").trim();if(dt.length<5||dt.length>200)continue;if(dt===name||dt===headline||dt.indexOf("degree")!==-1||dt==="Connect"||dt==="Message"||dt==="Follow")continue;if(!headline){headline=dt.substring(0,150);}else if(!location&&dt.length<80){location=dt;break;}}var mutual=0;var mutMatch=allText.match(/(\\d+)\\s*mutual/i);if(mutMatch)mutual=parseInt(mutMatch[1]);if(name&&href){results.push(JSON.stringify({name:name,profileUrl:href,headline:headline.substring(0,150),location:location,connectionDegree:degree,mutualConnections:mutual}));}}return"["+results.slice(0,20).join(",")+"]";})()';

// ─── People Search ───────────────────────────────────────────

export async function searchPeople(
  config: Partial<PeopleSearchConfig> = {},
  driver?: SafariDriver
): Promise<SearchResult[]> {
  const d = driver || getDefaultDriver();
  const log = (msg: string) => console.log(`[Search] ${msg}`);

  const params = new URLSearchParams();
  if (config.keywords?.length) params.set('keywords', config.keywords.join(' '));
  if (config.title) params.set('titleFreeText', config.title);
  if (config.company) params.set('company', config.company);

  // Connection degree filter: F=1st, S=2nd, O=3rd+
  if (config.connectionDegree) {
    const degreeMap: Record<string, string> = { '1st': 'F', '2nd': 'S', '3rd+': 'O' };
    const degrees = Array.isArray(config.connectionDegree) ? config.connectionDegree : [config.connectionDegree];
    const codes = degrees.map(d => degreeMap[d]).filter(Boolean);
    if (codes.length) {
      params.set('network', JSON.stringify(codes));
      params.set('origin', 'FACETED_SEARCH');
    }
  }

  // Pagination
  if (config.page && config.page > 1) {
    params.set('page', String(config.page));
  }

  // Origin override
  if (config.origin) params.set('origin', config.origin);

  const searchUrl = `${LINKEDIN_SEARCH}?${params.toString()}`;
  log(`Navigating: ${searchUrl}`);
  await d.navigateTo(searchUrl);
  await d.wait(5000);

  // Wait for search results to render inside main (not just nav links)
  const resultsReady = await d.waitForCondition(
    'var m=document.querySelector("main");m&&m.querySelectorAll("a[href*=\\"/in/\\"]").length>0?"ready":""',
    15000, 1000
  );
  if (!resultsReady) {
    log('No search results found within 15s');
    return [];
  }
  await d.wait(1000);

  // Scroll to load all lazy-loaded results on the current page
  await d.executeJS(`(function(){
    var scrollCount = 0;
    var interval = setInterval(function(){
      window.scrollBy(0, 600);
      scrollCount++;
      if (scrollCount >= 8 || (window.innerHeight + window.scrollY) >= document.body.scrollHeight - 200) {
        clearInterval(interval);
      }
    }, 300);
  })()`);
  await d.wait(3000);

  const resultsJson = await d.executeJS(SEARCH_EXTRACTION_JS);

  let results: SearchResult[] = [];
  try {
    results = JSON.parse(resultsJson || '[]') as SearchResult[];
  } catch {
    results = [];
  }

  log(`Found ${results.length} results on page ${config.page || 1}`);
  return results;
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
