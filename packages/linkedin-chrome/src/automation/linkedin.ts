import { navigateTo, getPage, waitFor, evalJS, typeInto, click, takeScreenshot } from './browser.js';
import { logInfo, logWarn, logError, logDebug } from './logger.js';
import type {
  LinkedInProfile, LinkedInConversation, LinkedInPost, LinkedInComment,
  LinkedInSearchResult, ConnectionRequest, IcpCriteria, ScoreResult, NetworkRequest,
} from './types.js';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const MOD = 'linkedin';
const LI = 'https://www.linkedin.com';

// ─── Profile Extraction ────────────────────────────────────────────────────

export async function extractProfile(profileUrl: string): Promise<LinkedInProfile> {
  const t = Date.now();
  logInfo(MOD, 'extractProfile', { profileUrl });
  try {
  const p = await navigateTo(profileUrl, 'domcontentloaded');
  // Wait for React to render profile content (client-side rendering)
  await sleep(2_000);
  // LinkedIn new UI uses .text-heading-xlarge; older top-card uses h1
  const NAME_SEL = 'h1, .text-heading-xlarge, .top-card-layout__title';
  await p.waitForSelector(NAME_SEL, { timeout: 15_000 }).catch(() => {
    logWarn(MOD, 'Profile name selector not found — proceeding with partial extraction', { profileUrl });
  });

  const result = await evalJS<LinkedInProfile>(`(function() {
    const text = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
    const texts = (sel) => [...document.querySelectorAll(sel)].map(e => e.innerText?.trim()).filter(Boolean);

    const name = text('h1') || text('.text-heading-xlarge') || text('.top-card-layout__title');
    const headline = text('.text-body-medium.break-words') || text('.top-card-layout__headline');
    const location = text('.text-body-small.inline.t-black--light.break-words') || text('.top-card-layout__second-subline');
    const about = text('#about ~ * .full-width') || text('.core-section-container__content .pv-about__summary-text');
    const connections = text('.t-bold span[aria-hidden]') || text('.pv-top-card--list li:nth-child(2)');

    const expItems = [...document.querySelectorAll('#experience ~ * .pvs-list__item--line-separated')].slice(0, 5);
    const experience = expItems.map(el => ({
      title: el.querySelector('.mr1.hoverable-link-text span[aria-hidden]')?.innerText?.trim() || '',
      company: el.querySelector('.t-14.t-normal span[aria-hidden]')?.innerText?.trim() || '',
      duration: el.querySelector('.t-14.t-normal.t-black--light span[aria-hidden]')?.innerText?.trim() || '',
    })).filter(e => e.title || e.company);

    const eduItems = [...document.querySelectorAll('#education ~ * .pvs-list__item--line-separated')].slice(0, 3);
    const education = eduItems.map(el => ({
      school: el.querySelector('.mr1.hoverable-link-text span[aria-hidden]')?.innerText?.trim() || '',
      degree: el.querySelector('.t-14.t-normal span[aria-hidden]')?.innerText?.trim() || '',
    })).filter(e => e.school);

    const skills = texts('#skills ~ * .hoverable-link-text span[aria-hidden]').slice(0, 10);

    return { name, headline, location, about, connections, experience, education, skills, profileUrl: window.location.href };
  })()`);
    logInfo(MOD, 'extractProfile ✓', { name: result.name, ms: Date.now() - t });
    return result;
  } catch (err) {
    logError(MOD, 'extractProfile failed', { profileUrl, ms: Date.now() - t, error: (err as Error).message });
    throw err;
  }
}

// ─── People Search ─────────────────────────────────────────────────────────

export async function searchPeople(
  query: string,
  opts: { title?: string; company?: string; location?: string } = {}
): Promise<LinkedInSearchResult[]> {
  logInfo(MOD, 'searchPeople →', { query, ...opts });
  const params = new URLSearchParams({ keywords: query, origin: 'GLOBAL_SEARCH_HEADER' });
  if (opts.title) params.set('titleFilter', opts.title);
  if (opts.company) params.set('company', opts.company);
  const url = `${LI}/search/results/people/?${params}`;
  await navigateTo(url, 'domcontentloaded');
  await waitFor('.search-results-container', 8_000).catch(() => {});

  return evalJS<LinkedInSearchResult[]>(`(function() {
    const results = [];
    document.querySelectorAll('.reusable-search__result-container').forEach(el => {
      const name = el.querySelector('.entity-result__title-text a span[aria-hidden]')?.innerText?.trim();
      const headline = el.querySelector('.entity-result__primary-subtitle')?.innerText?.trim();
      const location = el.querySelector('.entity-result__secondary-subtitle')?.innerText?.trim();
      const anchor = el.querySelector('.app-aware-link');
      const profileUrl = anchor?.href?.split('?')[0] || '';
      const degree = el.querySelector('.dist-value')?.innerText?.trim();
      if (name && profileUrl) results.push({ name, headline, location, profileUrl, connectionDegree: degree });
    });
    return results;
  })()`);
}

// ─── Send Connection Request ───────────────────────────────────────────────

export async function sendConnectionRequest(req: ConnectionRequest): Promise<{ success: boolean; status: string }> {
  logInfo(MOD, 'sendConnectionRequest →', { profileUrl: req.profileUrl, hasNote: !!req.note });
  await navigateTo(req.profileUrl, 'domcontentloaded');
  const p = await getPage();
  await p.waitForSelector('h1', { timeout: 10_000 });

  // Find Connect button
  const connected = await p.evaluate(`(function() {
    const btns = [...document.querySelectorAll('button')];
    const connected = btns.find(b => b.innerText?.includes('Message') || b.innerText?.includes('Withdraw'));
    const connect = btns.find(b => b.innerText?.trim() === 'Connect' || b.innerText?.trim() === 'Follow' && false);
    const pending = btns.find(b => b.innerText?.includes('Pending'));
    if (pending) return 'pending';
    if (connected && connected.innerText?.includes('Message')) return 'connected';
    if (connect) { connect.click(); return 'clicking'; }
    return 'not_found';
  })()`);

  if (connected === 'pending') return { success: false, status: 'already_pending' };
  if (connected === 'connected') return { success: false, status: 'already_connected' };
  if (connected === 'not_found') return { success: false, status: 'connect_button_not_found' };

  await sleep(1500);

  // Handle "Add a note" dialog
  if (req.note) {
    const hasNoteBtn = await p.evaluate(`(function() {
      const btn = [...document.querySelectorAll('button')].find(b => b.innerText?.includes('Add a note'));
      if (btn) { btn.click(); return true; }
      return false;
    })()`);
    if (hasNoteBtn) {
      await p.waitForSelector('textarea[name="message"]', { timeout: 5_000 });
      await p.type('textarea[name="message"]', req.note.slice(0, 300), { delay: 30 });
    }
  }

  // Click Send
  await p.evaluate(`(function() {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText?.includes('Send') || b.innerText?.includes('Connect'));
    if (btn) btn.click();
  })()`);
  await sleep(2_000);
  return { success: true, status: 'sent' };
}

// ─── Send Message ──────────────────────────────────────────────────────────

export async function sendMessage(profileUrl: string, text: string): Promise<{ success: boolean }> {
  logInfo(MOD, 'sendMessage →', { profileUrl, textLen: text.length });
  const profileId = profileUrl.replace(/\/$/, '').split('/').pop() || '';
  const composeUrl = `${LI}/messaging/compose/?profileUrn=urn:li:fs_profile:${profileId}`;

  await navigateTo(composeUrl, 'domcontentloaded');
  const p = await getPage();

  // Try compose URL approach first
  const hasCompose = await p.waitForSelector('.msg-form__contenteditable', { timeout: 6_000 }).then(() => true).catch(() => false);

  if (!hasCompose) {
    // Fallback: navigate to profile → click Message
    await navigateTo(profileUrl, 'domcontentloaded');
    await p.evaluate(`(function() {
      const btn = [...document.querySelectorAll('button')].find(b => b.innerText?.trim() === 'Message');
      if (btn) btn.click();
    })()`);
    await p.waitForSelector('.msg-form__contenteditable', { timeout: 8_000 });
  }

  await p.waitForSelector('.msg-form__contenteditable', { timeout: 8_000 });
  await p.click('.msg-form__contenteditable');
  await p.keyboard.type(text, { delay: 30 });
  await sleep(500);
  // Send with Ctrl+Enter or click Send button
  await p.evaluate(`(function() {
    const btn = document.querySelector('button.msg-form__send-button');
    if (btn && !btn.disabled) btn.click();
  })()`);
  await sleep(2_000);
  return { success: true };
}

// ─── List Conversations ────────────────────────────────────────────────────

export async function listConversations(limit = 20): Promise<{ conversations: LinkedInConversation[]; count: number }> {
  logInfo(MOD, 'listConversations →', { limit });
  await navigateTo(`${LI}/messaging/`, 'domcontentloaded');
  await waitFor('.msg-conversations-container', 6_000).catch(() => {});

  const conversations = await evalJS<LinkedInConversation[]>(`(function() {
    const results = [];
    document.querySelectorAll('.msg-conversation-listitem').forEach(el => {
      const name = el.querySelector('.msg-conversation-listitem__participant-names')?.innerText?.trim() || '';
      const lastMessage = el.querySelector('.msg-conversation-card__message-snippet')?.innerText?.trim() || '';
      const timestamp = el.querySelector('time')?.getAttribute('datetime') || el.querySelector('.msg-conversation-listitem__time-stamp')?.innerText?.trim() || '';
      const unread = !!el.querySelector('.msg-conversation-listitem__unread-count');
      const anchor = el.querySelector('a.msg-conversation-listitem__link');
      const conversationUrl = anchor?.href || '';
      if (name) results.push({ name, lastMessage, timestamp, unread, conversationUrl });
    });
    return results;
  })()`);

  const limited = conversations.slice(0, limit);
  return { conversations: limited, count: limited.length };
}

// ─── Get Feed ─────────────────────────────────────────────────────────────

export async function getFeed(limit = 10): Promise<LinkedInPost[]> {
  logInfo(MOD, 'getFeed →', { limit });
  await navigateTo(`${LI}/feed/`, 'domcontentloaded');
  await waitFor('[data-urn]', 6_000).catch(() => {});

  return evalJS<LinkedInPost[]>(`(function() {
    const posts = [];
    document.querySelectorAll('.feed-shared-update-v2').forEach(el => {
      const author = el.querySelector('.update-components-actor__name span[aria-hidden]')?.innerText?.trim() || '';
      const text = el.querySelector('.feed-shared-update-v2__description span[aria-hidden]')?.innerText?.trim()
                || el.querySelector('.feed-shared-text span[aria-hidden]')?.innerText?.trim() || '';
      const likes = parseInt(el.querySelector('.social-details-social-counts__reactions-count')?.innerText?.replace(/,/g, '') || '0');
      const comments = parseInt(el.querySelector('.social-details-social-counts__comments a')?.innerText?.replace(/[^0-9]/g, '') || '0');
      const anchor = el.querySelector('[data-urn]');
      const urn = anchor?.getAttribute('data-urn') || '';
      if (author && text) posts.push({ author, text, likes, comments, postUrl: urn });
    });
    return posts.slice(0, ${limit});
  })()`);
}

// ─── Get Post Comments ─────────────────────────────────────────────────────

export async function getPostComments(postUrl: string, limit = 20): Promise<LinkedInComment[]> {
  logInfo(MOD, 'getPostComments →', { postUrl, limit });
  await navigateTo(postUrl, 'domcontentloaded');
  await waitFor('.comments-comment-item', 6_000).catch(() => {});

  return evalJS<LinkedInComment[]>(`(function() {
    const comments = [];
    document.querySelectorAll('.comments-comment-item').forEach(el => {
      const author = el.querySelector('.comments-post-meta__name-text span[aria-hidden]')?.innerText?.trim() || '';
      const text = el.querySelector('.comments-comment-item__main-content span[aria-hidden]')?.innerText?.trim() || '';
      const likes = parseInt(el.querySelector('.comments-comment-social-bar__reactions-count')?.innerText?.replace(/[^0-9]/g, '') || '0');
      const timestamp = el.querySelector('time')?.getAttribute('datetime') || '';
      const anchor = el.querySelector('.comments-post-meta__name-text a');
      const authorUrl = anchor?.href?.split('?')[0] || '';
      if (author && text) comments.push({ author, text, likes, timestamp, authorUrl });
    });
    return comments.slice(0, ${limit});
  })()`);
}

// ─── Like / Comment on Post ────────────────────────────────────────────────

export async function likePost(postUrl: string): Promise<{ success: boolean }> {
  logInfo(MOD, 'likePost →', { postUrl });
  await navigateTo(postUrl, 'domcontentloaded');
  const p = await getPage();
  const liked = await p.evaluate(`(function() {
    const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label')?.toLowerCase().includes('like'));
    if (!btn) return false;
    const already = btn.getAttribute('aria-pressed') === 'true';
    if (!already) btn.click();
    return true;
  })()`);
  return { success: !!liked };
}

export async function commentOnPost(postUrl: string, text: string): Promise<{ success: boolean }> {
  logInfo(MOD, 'commentOnPost →', { postUrl, textLen: text.length });
  await navigateTo(postUrl, 'domcontentloaded');
  const p = await getPage();
  await p.evaluate(`(function() {
    const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label')?.includes('Comment') || b.innerText?.trim() === 'Comment');
    if (btn) btn.click();
  })()`);
  await p.waitForSelector('.ql-editor[contenteditable="true"]', { timeout: 6_000 });
  await p.click('.ql-editor[contenteditable="true"]');
  await p.keyboard.type(text, { delay: 30 });
  await sleep(500);
  await p.evaluate(`(function() {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText?.trim() === 'Post' || b.getAttribute('aria-label')?.includes('Submit comment'));
    if (btn && !btn.disabled) btn.click();
  })()`);
  await sleep(2_000);
  return { success: true };
}

// ─── Get Company ───────────────────────────────────────────────────────────

export async function getCompany(companyUrl: string): Promise<Record<string, unknown>> {
  logInfo(MOD, 'getCompany →', { companyUrl });
  await navigateTo(companyUrl, 'domcontentloaded');
  await waitFor('h1', 5_000).catch(() => {});

  return evalJS<Record<string, unknown>>(`(function() {
    const text = (sel) => document.querySelector(sel)?.innerText?.trim() || '';
    return {
      name: text('h1') || text('.org-top-card-summary__title'),
      tagline: text('.org-top-card-summary__tagline'),
      about: text('.org-about-us-organization-description__text'),
      industry: text('.org-top-card-summary-info-list__info-item') || '',
      size: text('.org-top-card-summary-info-list__info-item:nth-child(2)') || '',
      followers: text('.org-top-card-summary-info-list__followers span') || '',
      url: window.location.href,
    };
  })()`);
}

// ─── Get My Profile ────────────────────────────────────────────────────────

export async function getMyProfile(): Promise<LinkedInProfile> {
  logInfo(MOD, 'getMyProfile →');
  await navigateTo(`${LI}/me/`, 'domcontentloaded');
  // Wait for JS to resolve the /me/ redirect (client-side nav)
  await sleep(3_000);
  const redirectUrl = await getPage().then(p => p.url());
  logInfo(MOD, 'getMyProfile: redirected', { redirectUrl });
  return extractProfile(redirectUrl);
}

// ─── Get Notifications ─────────────────────────────────────────────────────

export async function getNotifications(limit = 10): Promise<Array<Record<string, unknown>>> {
  logInfo(MOD, 'getNotifications →', { limit });
  await navigateTo(`${LI}/notifications/`, 'domcontentloaded');
  await waitFor('.nt-card', 6_000).catch(() => {});

  return evalJS<Array<Record<string, unknown>>>(`(function() {
    const notifs = [];
    document.querySelectorAll('.nt-card').forEach(el => {
      const text = el.querySelector('.nt-card__text')?.innerText?.trim() || el.innerText?.trim() || '';
      const timestamp = el.querySelector('time')?.getAttribute('datetime') || '';
      const unread = el.classList.contains('nt-card--new');
      if (text) notifs.push({ text, timestamp, unread });
    });
    return notifs.slice(0, ${limit});
  })()`);
}

// ─── Accept Connection Requests ────────────────────────────────────────────

export async function acceptConnectionRequests(maxAccept = 5): Promise<{ accepted: number }> {
  logInfo(MOD, 'acceptConnectionRequests →', { maxAccept });
  await navigateTo(`${LI}/mynetwork/invitation-manager/`, 'domcontentloaded');
  const p = await getPage();
  await waitFor('.invitation-card', 5_000).catch(() => {});

  let accepted = 0;
  const cards = await p.$$('.invitation-card');
  for (const card of cards.slice(0, maxAccept)) {
    const btn = await card.$('button[aria-label*="Accept"]');
    if (btn) { await btn.click(); await sleep(1_000); accepted++; }
  }
  return { accepted };
}

// ─── Get Intercepted Network Requests ─────────────────────────────────────

const _networkLog: NetworkRequest[] = [];

export async function startNetworkCapture(): Promise<void> {
  logInfo(MOD, 'startNetworkCapture: attaching interceptor, resetting log');
  const p = await getPage();
  _networkLog.length = 0;
  try { await p.setRequestInterception(true); }
  catch { logWarn(MOD, 'startNetworkCapture: interception already active'); }
  p.removeAllListeners('request');
  p.on('request', req => { req.continue(); });
  p.on('response', async res => {
    _networkLog.push({
      url: res.url(),
      method: res.request().method(),
      status: res.status(),
      resourceType: res.request().resourceType(),
    });
  });
  logInfo(MOD, 'startNetworkCapture: capturing');
}

export function getNetworkLog(filter?: string): NetworkRequest[] {
  const log = filter ? _networkLog.filter(r => r.url.includes(filter)) : [..._networkLog];
  logInfo(MOD, 'getNetworkLog', { total: _networkLog.length, filtered: log.length, filter });
  return log;
}

// ─── Score Profile (pure logic) ───────────────────────────────────────────

export function scoreProfile(profile: LinkedInProfile, icp: IcpCriteria = {}): ScoreResult {
  let score = 0;
  const breakdown: Record<string, number> = {};
  const reasons: string[] = [];

  if (icp.targetTitle && profile.headline) {
    const match = profile.headline.toLowerCase().includes(icp.targetTitle.toLowerCase());
    breakdown['title'] = match ? 30 : 0;
    if (match) reasons.push(`Title matches "${icp.targetTitle}"`);
  }
  if (icp.targetCompany && profile.experience?.length) {
    const match = profile.experience.some(e => e.company.toLowerCase().includes((icp.targetCompany || '').toLowerCase()));
    breakdown['company'] = match ? 30 : 0;
    if (match) reasons.push(`Works at "${icp.targetCompany}"`);
  }
  if (icp.targetLocation && profile.location) {
    const match = profile.location.toLowerCase().includes(icp.targetLocation.toLowerCase());
    breakdown['location'] = match ? 20 : 0;
    if (match) reasons.push(`Located in "${icp.targetLocation}"`);
  }
  if (profile.connections) {
    const n = parseInt(profile.connections.replace(/[^0-9]/g, ''));
    breakdown['connections'] = n > 500 ? 20 : n > 100 ? 10 : 5;
  }

  score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const result = { totalScore: Math.min(score, 100), reason: reasons.join('; ') || 'No criteria matched', breakdown };
  logInfo(MOD, 'scoreProfile', { name: profile.name, score: result.totalScore, reason: result.reason });
  return result;
}

export { takeScreenshot };
