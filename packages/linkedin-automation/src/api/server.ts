/**
 * LinkedIn Automation API Server
 * REST API for connections, messaging, profile extraction, and lead scoring.
 * Port: 3105
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import {
  SafariDriver,
  getDefaultDriver,
  navigateToNetwork,
  navigateToProfile,
  navigateToMessaging,
  extractProfile,
  getConnectionStatus,
  sendConnectionRequest,
  listPendingRequests,
  acceptRequest,
  searchPeople,
  scoreProfile,
  listConversations,
  readMessages,
  openConversation,
  sendMessage,
  sendMessageToProfile,
  getUnreadCount,
  runProspectingPipeline,
  searchAndScore,
  DEFAULT_RATE_LIMITS,
} from '../automation/index.js';
import type { RateLimitConfig, ConnectionRequest, PeopleSearchConfig } from '../automation/types.js';
import type { ProspectingConfig } from '../automation/prospecting-pipeline.js';
import {
  createCampaign, getCampaigns, getCampaign,
  getProspects, getStats, getRecentRuns,
  runOutreachCycle,
  markConverted, markOptedOut, addProspectNote, tagProspect,
} from '../automation/outreach-engine.js';
import type { ProspectStage } from '../automation/outreach-engine.js';

const PORT = process.env.LINKEDIN_PORT || 3105;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const app = express();
app.use(cors());
app.use(express.json());

// Rate limiting state
let connectionsToday = 0;
let messagesToday = 0;
let actionsThisHour = 0;
let lastHourReset = Date.now();
let lastDayReset = Date.now();
let rateLimits: RateLimitConfig = { ...DEFAULT_RATE_LIMITS };

function resetCountersIfNeeded() {
  const now = Date.now();
  if (now - lastHourReset > 3600000) {
    actionsThisHour = 0;
    lastHourReset = now;
  }
  if (now - lastDayReset > 86400000) {
    connectionsToday = 0;
    messagesToday = 0;
    lastDayReset = now;
  }
}

function checkHourlyLimit(): boolean {
  resetCountersIfNeeded();
  if (actionsThisHour >= rateLimits.searchesPerHour) return false;
  actionsThisHour++;
  return true;
}

function isWithinActiveHours(): boolean {
  const hour = new Date().getHours();
  return hour >= rateLimits.activeHoursStart && hour < rateLimits.activeHoursEnd;
}

// ─── Health ──────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    platform: 'linkedin',
    status: 'running',
    port: PORT,
    uptime: process.uptime(),
    withinActiveHours: isWithinActiveHours(),
    counters: { connectionsToday, messagesToday, actionsThisHour },
  });
});

app.get('/api/linkedin/status', async (_req: Request, res: Response) => {
  try {
    const driver = getDefaultDriver();
    const isOnLinkedIn = await driver.isOnLinkedIn();
    const isLoggedIn = isOnLinkedIn ? await driver.isLoggedIn() : false;
    const url = await driver.getCurrentUrl();

    res.json({
      isOnLinkedIn,
      isLoggedIn,
      currentUrl: url,
      withinActiveHours: isWithinActiveHours(),
      rateLimits: { connectionsToday, messagesToday, actionsThisHour },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Navigation ──────────────────────────────────────────────

app.post('/api/linkedin/navigate/network', async (_req: Request, res: Response) => {
  try {
    const result = await navigateToNetwork();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/linkedin/navigate/messaging', async (_req: Request, res: Response) => {
  try {
    const result = await navigateToMessaging();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/linkedin/navigate/profile', async (req: Request, res: Response) => {
  try {
    const { profileUrl } = req.body;
    if (!profileUrl) return res.status(400).json({ error: 'profileUrl required' });
    const result = await navigateToProfile(profileUrl);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Debug ───────────────────────────────────────────────────

app.post('/api/linkedin/debug/js', async (req: Request, res: Response) => {
  try {
    const { js } = req.body;
    if (!js) return res.status(400).json({ error: 'js required' });
    const d = getDefaultDriver();
    const result = await d.executeJS(js);
    res.json({ result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Profile Extraction ──────────────────────────────────────

app.get('/api/linkedin/profile/extract-current', async (_req: Request, res: Response) => {
  try {
    const d = getDefaultDriver();
    const url = await d.getCurrentUrl();
    const raw = await d.executeJS(`
      (function() {
        var mainEl = document.querySelector('main');
        if (!mainEl) return JSON.stringify({error: 'no main'});
        var mainText = mainEl.innerText;
        var NL = String.fromCharCode(10);
        var h2s = mainEl.querySelectorAll('h2');
        var name = '';
        var sectionHeadings = ['activity','experience','education','skills','interests','languages','certifications','recommendations','courses','projects','publications','honors','organizations','volunteering','about'];
        for (var i = 0; i < h2s.length; i++) {
          var t = h2s[i].innerText.trim();
          if (t.length > 2 && t.length < 60 && sectionHeadings.indexOf(t.toLowerCase()) === -1 && t.indexOf('notification') === -1) { name = t; break; }
        }
        var lines = mainText.split(NL).map(function(l){return l.trim();}).filter(function(l){return l.length > 0;});
        var nameIdx = -1;
        for (var ni = 0; ni < lines.length; ni++) { if (lines[ni] === name) { nameIdx = ni; break; } }
        var headline = '';
        var location = '';
        var connectionDegree = 'out_of_network';
        var mutualConnections = 0;
        if (nameIdx >= 0) {
          for (var li = nameIdx + 1; li < Math.min(nameIdx + 15, lines.length); li++) {
            var line = lines[li];
            if (line.match(/[123](?:st|nd|rd)/i) && line.length < 10) { connectionDegree = line.replace(/[^123]/g,'') === '1' ? '1st' : line.replace(/[^123]/g,'') === '2' ? '2nd' : '3rd'; continue; }
            if (line.toLowerCase() === 'contact info' || line === 'Connect' || line === 'Message' || line === 'Follow') continue;
            var mutMatch = line.match(/(\\d+).*mutual/i);
            if (mutMatch) { mutualConnections = parseInt(mutMatch[1]) || 0; continue; }
            if (line.toLowerCase().indexOf('mutual') !== -1) continue;
            if (sectionHeadings.indexOf(line.toLowerCase()) !== -1) break;
            if (line === 'Activity' || line === 'Show all') break;
            if (!headline && line.length > 5 && line !== name) { headline = line; continue; }
            if (headline && !location && (line.indexOf(',') !== -1 || line.indexOf('United States') !== -1)) { location = line; continue; }
          }
        }
        var currentPosition = null;
        for (var eh = 0; eh < h2s.length; eh++) {
          if (h2s[eh].innerText.trim() === 'Experience') {
            var expSection = h2s[eh].closest('section') || h2s[eh].parentElement;
            if (expSection) {
              var expLis = expSection.querySelectorAll('li');
              if (expLis.length > 0) {
                var expLines = expLis[0].innerText.trim().split(NL).map(function(l){return l.trim();}).filter(function(l){return l.length > 0;});
                if (expLines.length >= 2) { currentPosition = { title: expLines[0], company: expLines[1], duration: expLines.length > 2 ? expLines[2] : '' }; }
              }
            }
            break;
          }
        }
        var skills = [];
        for (var sh = 0; sh < h2s.length; sh++) {
          if (h2s[sh].innerText.trim() === 'Skills') {
            var skillSec = h2s[sh].closest('section') || h2s[sh].parentElement;
            if (skillSec) {
              var sLis = skillSec.querySelectorAll('li');
              for (var si = 0; si < Math.min(10, sLis.length); si++) {
                var sText = sLis[si].innerText.trim().split(NL)[0];
                if (sText.length > 1 && sText.length < 60 && sText !== 'Show all') skills.push(sText);
              }
            }
            break;
          }
        }
        var canConnect = false; var canMessage = false;
        var btns = document.querySelectorAll('button');
        for (var bi = 0; bi < btns.length; bi++) {
          var bLabel = (btns[bi].getAttribute('aria-label') || '') + ' ' + btns[bi].innerText;
          if (bLabel.match(/Connect|Invite.*connect/i)) canConnect = true;
          if (bLabel.match(/^Message/i)) canMessage = true;
        }
        var ancs = document.querySelectorAll('a');
        for (var ai = 0; ai < ancs.length; ai++) {
          var aLabel = (ancs[ai].getAttribute('aria-label') || '') + ' ' + ancs[ai].innerText.trim();
          var aHref = ancs[ai].href || '';
          if (aLabel.match(/Connect|Invite.*connect/i) || aHref.indexOf('custom-invite') !== -1) canConnect = true;
          if (aLabel.match(/^Message/i) || aHref.indexOf('/messaging/compose') !== -1) canMessage = true;
        }
        var isOpenToWork = mainText.indexOf('Open to work') !== -1 || mainText.indexOf('#OpenToWork') !== -1;
        var isHiring = mainText.indexOf('Hiring') !== -1 || mainText.indexOf('#Hiring') !== -1;
        return JSON.stringify({ name: name, headline: headline, location: location, connectionDegree: connectionDegree, mutualConnections: mutualConnections, currentPosition: currentPosition, skills: skills, canConnect: canConnect, canMessage: canMessage, isOpenToWork: isOpenToWork, isHiring: isHiring, nameIdx: nameIdx, linesCount: lines.length });
      })()
    `);
    const parsed = JSON.parse(raw || '{}');
    res.json({ url, ...parsed });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/profile/:username', async (req: Request, res: Response) => {
  try {
    if (!checkHourlyLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const profile = await extractProfile(req.params.username);
    if (!profile) return res.status(404).json({ error: 'Could not extract profile' });
    res.json(profile);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/profile/score', async (req: Request, res: Response) => {
  try {
    const { profile, targetTitles, targetCompanies, targetLocations } = req.body;
    if (!profile) return res.status(400).json({ error: 'profile object required' });
    const score = scoreProfile(profile, targetTitles, targetCompanies, targetLocations);
    res.json(score);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Connections ─────────────────────────────────────────────

app.get('/api/linkedin/connections/status', async (req: Request, res: Response) => {
  try {
    const profileUrl = req.query.profileUrl as string;
    if (!profileUrl) return res.status(400).json({ error: 'profileUrl query param required' });
    if (!checkHourlyLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const status = await getConnectionStatus(profileUrl);
    res.json(status);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/connections/request', async (req: Request, res: Response) => {
  try {
    resetCountersIfNeeded();
    if (connectionsToday >= rateLimits.connectionRequestsPerDay) {
      return res.status(429).json({ error: 'Daily connection request limit reached', limit: rateLimits.connectionRequestsPerDay });
    }
    if (!isWithinActiveHours()) {
      return res.status(403).json({ error: 'Outside active hours', activeHours: `${rateLimits.activeHoursStart}-${rateLimits.activeHoursEnd}` });
    }

    const request: ConnectionRequest = {
      profileUrl: req.body.profileUrl,
      note: req.body.note,
      skipIfConnected: req.body.skipIfConnected !== false,
      skipIfPending: req.body.skipIfPending !== false,
    };

    if (!request.profileUrl) return res.status(400).json({ error: 'profileUrl required' });

    const result = await sendConnectionRequest(request);
    if (result.success && result.status === 'sent') connectionsToday++;
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/connections/pending', async (req: Request, res: Response) => {
  try {
    const type = (req.query.type as 'sent' | 'received') || 'received';
    const requests = await listPendingRequests(type);
    res.json({ requests, count: requests.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/connections/accept', async (req: Request, res: Response) => {
  try {
    const { profileUrl } = req.body;
    if (!profileUrl) return res.status(400).json({ error: 'profileUrl required' });
    const accepted = await acceptRequest(profileUrl);
    res.json({ success: accepted });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Search ──────────────────────────────────────────────────

app.post('/api/linkedin/search/people', async (req: Request, res: Response) => {
  try {
    if (!checkHourlyLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const config: Partial<PeopleSearchConfig> = req.body;
    const results = await searchPeople(config);
    res.json({ results, count: results.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/search/extract-current', async (_req: Request, res: Response) => {
  try {
    const d = getDefaultDriver();
    const url = await d.getCurrentUrl();
    const raw = await d.executeJS(`
      (function() {
        var results = [];
        var processedLis = [];
        var mainEl = document.querySelector('main, [role="main"]');
        if (!mainEl) return JSON.stringify({ error: 'no main', liCount: 0 });
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

          if (name && href) {
            results.push({ name: name, profileUrl: href, headline: headline.substring(0, 150), location: location, connectionDegree: degree, mutualConnections: 0 });
          }
        }
        return JSON.stringify({ count: results.length, liTotal: allLis.length, results: results.slice(0, 20) });
      })()
    `);
    const parsed = JSON.parse(raw || '{}');
    res.json({ url, ...parsed });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Messages ────────────────────────────────────────────────

app.get('/api/linkedin/conversations', async (_req: Request, res: Response) => {
  try {
    const nav = await navigateToMessaging();
    if (!nav.success) return res.status(500).json(nav);
    const convos = await listConversations();
    res.json({ conversations: convos, count: convos.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/messages', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const msgs = await readMessages(limit);
    res.json({ messages: msgs, count: msgs.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/messages/unread', async (_req: Request, res: Response) => {
  try {
    const count = await getUnreadCount();
    res.json({ unreadCount: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/messages/open', async (req: Request, res: Response) => {
  try {
    const { participantName } = req.body;
    if (!participantName) return res.status(400).json({ error: 'participantName required' });
    const opened = await openConversation(participantName);
    res.json({ success: opened });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/messages/send', async (req: Request, res: Response) => {
  try {
    resetCountersIfNeeded();
    if (messagesToday >= rateLimits.messagesPerDay) {
      return res.status(429).json({ error: 'Daily message limit reached' });
    }
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const result = await sendMessage(text);
    if (result.success) messagesToday++;
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/messages/send-to', async (req: Request, res: Response) => {
  try {
    resetCountersIfNeeded();
    if (messagesToday >= rateLimits.messagesPerDay) {
      return res.status(429).json({ error: 'Daily message limit reached' });
    }
    const { profileUrl, text } = req.body;
    if (!profileUrl || !text) return res.status(400).json({ error: 'profileUrl and text required' });
    const result = await sendMessageToProfile(profileUrl, text);
    if (result.success) messagesToday++;
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── AI Message Generation ───────────────────────────────────

app.post('/api/linkedin/ai/generate-message', async (req: Request, res: Response) => {
  try {
    const { profile, purpose, tone, context } = req.body;
    if (!profile) return res.status(400).json({ error: 'profile object required' });

    const purposeLabel = purpose || 'connection_note';
    const toneLabel = tone || 'professional';

    if (!OPENAI_API_KEY) {
      return res.json({
        text: `Hi ${profile.name?.split(' ')[0] || 'there'}, I came across your profile and would love to connect. ${profile.headline ? `Your work as ${profile.headline.substring(0, 50)} is impressive.` : ''} Looking forward to connecting!`,
        confidence: 0.3,
        aiGenerated: false,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const fallbackText = `Hi ${profile.name?.split(' ')[0] || 'there'}, would love to connect!`;
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `Generate a SHORT, personalized LinkedIn ${purposeLabel.replace(/_/g, ' ')} (max 280 chars for notes, 500 for messages). Tone: ${toneLabel}. Be specific, not generic. Reference their actual role/company. No emojis unless friendly tone.`,
            },
            {
              role: 'user',
              content: `Profile: ${profile.name}, ${profile.headline || ''}, ${profile.currentPosition?.company || ''}. Location: ${profile.location || ''}. ${context ? `Context: ${context}` : ''}`,
            },
          ],
          max_tokens: 150,
          temperature: 0.8,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`[AI] OpenAI returned ${response.status}`);
        return res.json({ text: fallbackText, confidence: 0.3, aiGenerated: false });
      }

      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content?.trim() || '';

      res.json({
        text: text || fallbackText,
        confidence: text ? 0.85 : 0.3,
        aiGenerated: !!text,
      });
    } catch (aiError) {
      clearTimeout(timeout);
      console.error('[AI] OpenAI request failed:', aiError instanceof Error ? aiError.message : aiError);
      res.json({ text: fallbackText, confidence: 0.3, aiGenerated: false });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Rate Limits ─────────────────────────────────────────────

app.get('/api/linkedin/rate-limits', (_req: Request, res: Response) => {
  resetCountersIfNeeded();
  res.json({
    config: rateLimits,
    current: { connectionsToday, messagesToday, actionsThisHour },
    withinActiveHours: isWithinActiveHours(),
  });
});

app.put('/api/linkedin/rate-limits', (req: Request, res: Response) => {
  rateLimits = { ...rateLimits, ...req.body };
  res.json({ updated: true, config: rateLimits });
});

// ─── Prospecting Pipeline ────────────────────────────────────

app.post('/api/linkedin/prospect/search-score', async (req: Request, res: Response) => {
  try {
    if (!checkHourlyLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const { search, targetTitles, targetCompanies, targetLocations } = req.body;
    if (!search) return res.status(400).json({ error: 'search config required' });
    const results = await searchAndScore(search, targetTitles, targetCompanies, targetLocations);
    res.json({
      results,
      count: results.length,
      qualified: results.filter((r: any) => r.score.recommendation !== 'skip').length,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/prospect/pipeline', async (req: Request, res: Response) => {
  try {
    if (!isWithinActiveHours() && !req.body.force) {
      return res.status(403).json({ error: 'Outside active hours', activeHours: `${rateLimits.activeHoursStart}-${rateLimits.activeHoursEnd}` });
    }

    const config: ProspectingConfig = {
      search: req.body.search || {},
      scoring: {
        targetTitles: req.body.targetTitles || [],
        targetCompanies: req.body.targetCompanies || [],
        targetLocations: req.body.targetLocations || [],
        minScore: req.body.minScore || 30,
      },
      connection: {
        sendRequest: req.body.sendConnections !== false,
        noteTemplate: req.body.noteTemplate || 'Hi {firstName}, I came across your work as {headline} and would love to connect.',
        skipIfConnected: true,
        skipIfPending: true,
      },
      dm: {
        enabled: req.body.sendDMs || false,
        messageTemplate: req.body.dmTemplate || 'Hi {firstName}, I noticed your experience in {headline}. I work on automation tools and thought we might have some synergies. Would love to chat!',
        onlyIfConnected: true,
      },
      maxProspects: req.body.maxProspects || 5,
      dryRun: req.body.dryRun !== false,
      delayBetweenActions: req.body.delayMs || 30000,
    };

    const result = await runProspectingPipeline(config);

    if (result.summary.connectionsSent > 0) connectionsToday += result.summary.connectionsSent;
    if (result.summary.messagesSent > 0) messagesToday += result.summary.messagesSent;

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Outreach Engine ─────────────────────────────────────────

// Campaigns
app.post('/api/linkedin/outreach/campaigns', (req: Request, res: Response) => {
  try {
    const campaign = createCampaign(req.body);
    res.json({ success: true, campaign });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get('/api/linkedin/outreach/campaigns', (_req: Request, res: Response) => {
  res.json({ campaigns: getCampaigns() });
});

app.get('/api/linkedin/outreach/campaigns/:id', (req: Request, res: Response) => {
  const c = getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  res.json(c);
});

// Prospects
app.get('/api/linkedin/outreach/prospects', (req: Request, res: Response) => {
  const filters: any = {};
  if (req.query.campaign) filters.campaign = req.query.campaign;
  if (req.query.stage) filters.stage = (req.query.stage as string).split(',') as ProspectStage[];
  if (req.query.minScore) filters.minScore = parseInt(req.query.minScore as string);
  res.json({ prospects: getProspects(filters) });
});

// Stats
app.get('/api/linkedin/outreach/stats', (req: Request, res: Response) => {
  const campaign = req.query.campaign as string | undefined;
  res.json(getStats(campaign));
});

// Runs
app.get('/api/linkedin/outreach/runs', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  res.json({ runs: getRecentRuns(limit) });
});

// Run outreach cycle
app.post('/api/linkedin/outreach/run', async (req: Request, res: Response) => {
  try {
    const { campaignId, dryRun, skipDiscovery, skipFollowUps } = req.body;
    if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
    const result = await runOutreachCycle(campaignId, { dryRun, skipDiscovery, skipFollowUps });
    if (result.summary.connectionsSent > 0) connectionsToday += result.summary.connectionsSent;
    if (result.summary.dmsSent > 0) messagesToday += result.summary.dmsSent;
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Manual prospect actions
app.post('/api/linkedin/outreach/prospects/:id/convert', (req: Request, res: Response) => {
  const p = markConverted(req.params.id, req.body.notes);
  if (!p) return res.status(404).json({ error: 'Prospect not found' });
  res.json({ success: true, prospect: p });
});

app.post('/api/linkedin/outreach/prospects/:id/opt-out', (req: Request, res: Response) => {
  const p = markOptedOut(req.params.id);
  if (!p) return res.status(404).json({ error: 'Prospect not found' });
  res.json({ success: true, prospect: p });
});

app.post('/api/linkedin/outreach/prospects/:id/note', (req: Request, res: Response) => {
  const p = addProspectNote(req.params.id, req.body.note || '');
  if (!p) return res.status(404).json({ error: 'Prospect not found' });
  res.json({ success: true, prospect: p });
});

app.post('/api/linkedin/outreach/prospects/:id/tag', (req: Request, res: Response) => {
  const p = tagProspect(req.params.id, req.body.tag || '');
  if (!p) return res.status(404).json({ error: 'Prospect not found' });
  res.json({ success: true, prospect: p });
});

// ─── Start Server ────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🔗 LinkedIn Automation API running on http://localhost:${PORT}`);
  console.log(`   Health: GET http://localhost:${PORT}/health`);
  console.log(`   Status: GET http://localhost:${PORT}/api/linkedin/status`);
  console.log(`   Profile: GET http://localhost:${PORT}/api/linkedin/profile/:username`);
  console.log(`   Connect: POST http://localhost:${PORT}/api/linkedin/connections/request`);
  console.log(`   Search: POST http://localhost:${PORT}/api/linkedin/search/people`);
  console.log(`   Messages: GET http://localhost:${PORT}/api/linkedin/conversations`);
  if (OPENAI_API_KEY) console.log(`   AI: POST http://localhost:${PORT}/api/linkedin/ai/generate-message`);
  console.log(`   Prospect: POST http://localhost:${PORT}/api/linkedin/prospect/search-score`);
  console.log(`   Pipeline: POST http://localhost:${PORT}/api/linkedin/prospect/pipeline`);
  console.log(`   ── Outreach Engine ──`);
  console.log(`   Campaigns: POST/GET http://localhost:${PORT}/api/linkedin/outreach/campaigns`);
  console.log(`   Prospects: GET http://localhost:${PORT}/api/linkedin/outreach/prospects`);
  console.log(`   Stats:     GET http://localhost:${PORT}/api/linkedin/outreach/stats`);
  console.log(`   Run Cycle: POST http://localhost:${PORT}/api/linkedin/outreach/run`);
  console.log(`   Runs:      GET http://localhost:${PORT}/api/linkedin/outreach/runs`);
  console.log(`   Rate limits: connections ${rateLimits.connectionRequestsPerDay}/day, messages ${rateLimits.messagesPerDay}/day`);
  console.log(`   Active hours: ${rateLimits.activeHoursStart}:00 - ${rateLimits.activeHoursEnd}:00`);
  console.log('');
});

export default app;
