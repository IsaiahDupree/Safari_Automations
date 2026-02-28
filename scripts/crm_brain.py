#!/usr/bin/env python3
"""
crm_brain.py — AI-powered CRM agent across all platforms

Capabilities:
  --sync            Pull conversations + messages from all platforms → Supabase
  --sync-linkedin   Import linkedin_prospects → crm_contacts
  --score           AI-score every contact's relationship depth (0-100)
  --generate        Generate brand-aligned messages for queued contacts
  --send            Send pending messages from crm_message_queue
  --send-test       Same as --send but restricted to test contact only
  --pipeline        Full run: sync → score → generate → send
  --status          Dashboard: contact stages, queue, top prospects
  --review NAME     Show full AI analysis for one contact

Platform services (must be running):
  Instagram DM:  http://localhost:3100
  Twitter DM:    http://localhost:3003
  TikTok DM:     http://localhost:3102
  LinkedIn DM:   http://localhost:3105

Claude API key required: export ANTHROPIC_API_KEY=sk-ant-...
"""

import os, sys, json, time, random, subprocess, re, textwrap
import urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone, timedelta
import email.utils

def _safe_ts(val):
    """Return ISO UTC timestamp string or None. Handles None, ISO strings, and human dates."""
    if not val:
        return None
    if isinstance(val, datetime):
        return val.astimezone(timezone.utc).isoformat()
    s = str(val).strip()
    if not s:
        return None
    # Already ISO-ish
    for fmt in ('%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(s, fmt).astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
    # Human-readable like 'Feb 22', 'Jan 5', 'Dec 19, 2025'
    try:
        return email.utils.parsedate_to_datetime(s).astimezone(timezone.utc).isoformat()
    except Exception:
        pass
    # Give up — return None so the DB uses its default
    return None


# ── Config ─────────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ivhfuhxorppptyuofbgq.supabase.co")
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or
                os.environ.get("SUPABASE_ANON_KEY") or
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aGZ1aHhvcnBwcHR5dW9mYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzg5OTcsImV4cCI6MjA4NzExNDk5N30.tYXhbRaTquQWmNnhtfyKkE64e7zGI8CRBAc5dRtQR3Y")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL      = "claude-haiku-4-5-20251001"   # fast + cheap for CRM ops

PLATFORM_SERVICES = {
    "instagram": "http://localhost:3100",
    "twitter":   "http://localhost:3003",
    "tiktok":    "http://localhost:3102",
    "linkedin":  "http://localhost:3105",
}

TEST_CONTACT = "isaiah dupree"   # only contact allowed in test mode

# Brand voice for message generation
BRAND_VOICE = """
You are Isaiah Dupree — a content writer and ghostwriter helping founders, executives, and B2B SaaS companies build powerful personal brands and thought leadership on LinkedIn and beyond.

Brand voice: Warm, direct, insightful, no-BS. You value genuine relationships over transactional ones.
You help people who are too busy or not confident in their writing to show up consistently.

Offer: Content writing, ghostwriting, LinkedIn content strategy, thought leadership packages.
Price range: $500–$5,000/month depending on scope.
"""

# ── HTTP helpers ───────────────────────────────────────────────────────────────
def _http(method, url, body=None, headers=None, timeout=20):
    data = json.dumps(body).encode() if body else None
    h = {'Content-Type': 'application/json'}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read().decode()[:200]}"
    except Exception as ex:
        return None, str(ex)


def _sb(method, table, body=None, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += '?' + urllib.parse.urlencode(params)
    h = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Prefer': 'return=representation,resolution=merge-duplicates',
    }
    result, err = _http(method, url, body, h, timeout=15)
    if err:
        print(f"  ⚠️  Supabase {method} {table}: {err[:120]}")
    return result or []


def _sb_upsert(table, rows, conflict_col='id'):
    if not rows:
        return 0
    result = _sb('POST', table, rows,
                 params={'on_conflict': conflict_col})
    return len(result) if isinstance(result, list) else 0


def _sb_patch(table, updates, **filters):
    params = {k: f'eq.{v}' for k, v in filters.items()}
    params['on_conflict'] = list(filters.keys())[0] if filters else 'id'
    updates['updated_at'] = utcnow()
    _sb('PATCH', table, updates, params=params)


def _sb_get(table, **params):
    p = {'select': '*'}
    p.update(params)
    return _sb('GET', table, params=p) or []


def utcnow():
    return datetime.now(timezone.utc).isoformat()


# ── Platform service helpers ───────────────────────────────────────────────────
def _svc(platform, method, path, body=None, timeout=30):
    base = PLATFORM_SERVICES.get(platform)
    if not base:
        return None, f"unknown platform: {platform}"
    return _http(method, f"{base}{path}", body, timeout=timeout)


def _check_services():
    alive = {}
    for p, base in PLATFORM_SERVICES.items():
        r, err = _http('GET', f"{base}/health", timeout=3)
        alive[p] = (r is not None and not err)
    return alive


# ── Platform: collect conversations ───────────────────────────────────────────
def _collect_instagram():
    """Collect Instagram conversations via service (requires active Safari session)."""
    _svc("instagram", "POST", "/api/session/ensure", timeout=15)
    time.sleep(1)
    r, err = _svc("instagram", "GET", "/api/conversations/all", timeout=30)
    if err:
        r, err = _svc("instagram", "GET", "/api/conversations", timeout=20)
    if err or not r:
        print(f"    IG: {err}")
        return []
    convos = r.get('conversations', r if isinstance(r, list) else [])
    out = []
    for c in convos:
        name = (c.get('name') or c.get('username') or c.get('handle') or
                c.get('displayName') or c.get('participantName') or '').strip()
        handle = (c.get('username') or c.get('handle') or name)
        if not name:
            continue
        out.append({'platform': 'instagram', 'handle': handle, 'name': name,
                    'last_message': c.get('lastMessage') or c.get('last_message', ''),
                    'last_message_at': c.get('lastMessageAt') or c.get('last_message_at'),
                    'thread_id': c.get('id') or c.get('threadId') or c.get('conversationId', '')})
    return out


def _collect_twitter():
    r, err = _svc("twitter", "GET", "/api/twitter/conversations", timeout=20)
    if err or not r:
        print(f"    Twitter: {err}")
        return []
    convos = r.get('conversations', [])
    out = []
    for c in convos:
        name = (c.get('name') or c.get('displayName') or c.get('username') or
                c.get('participantName') or '').strip()
        handle = (c.get('username') or c.get('handle') or name)
        if not name:
            continue
        out.append({'platform': 'twitter', 'handle': handle, 'name': name,
                    'last_message': c.get('lastMessage') or c.get('last_message', ''),
                    'last_message_at': c.get('lastMessageAt') or c.get('last_message_at'),
                    'thread_id': c.get('id') or c.get('conversationId', '')})
    return out


def _collect_tiktok():
    r, err = _svc("tiktok", "GET", "/api/tiktok/conversations", timeout=20)
    if err or not r:
        print(f"    TikTok: {err}")
        return []
    convos = r.get('conversations', [])
    out = []
    for c in convos:
        name = (c.get('name') or c.get('displayName') or c.get('username') or
                c.get('participantName') or '').strip()
        handle = (c.get('username') or c.get('handle') or name)
        if not name:
            continue
        out.append({'platform': 'tiktok', 'handle': handle, 'name': name,
                    'last_message': c.get('lastMessage') or c.get('last_message', ''),
                    'last_message_at': c.get('lastMessageAt') or c.get('last_message_at'),
                    'thread_id': c.get('id') or c.get('conversationId', '')})
    return out


def _collect_linkedin():
    r, err = _svc("linkedin", "GET", "/api/linkedin/conversations", timeout=20)
    if err or not r:
        print(f"    LinkedIn: {err}")
        return []
    convos = r.get('conversations', r if isinstance(r, list) else [])
    out = []
    for c in convos:
        # Service returns: participantName, conversationId, lastMessage, lastMessageAt
        name = (c.get('participantName') or c.get('name') or
                c.get('displayName') or c.get('username') or '').strip()
        handle = (c.get('profileUrl') or c.get('username') or
                  c.get('conversationId') or name)
        if not name:
            continue
        out.append({'platform': 'linkedin', 'handle': handle, 'name': name,
                    'last_message': c.get('lastMessage') or c.get('last_message', ''),
                    'last_message_at': c.get('lastMessageAt') or c.get('last_message_at'),
                    'thread_id': c.get('conversationId') or c.get('threadId') or c.get('id', '')})
    return out


def _fetch_messages(platform, thread_id, contact_name='', limit=20):
    """Fetch recent messages for a conversation thread."""
    if platform == 'instagram':
        r, _ = _svc("instagram", "GET", f"/api/messages?limit={limit}", timeout=20)
        msgs = r.get('messages', []) if r else []
    elif platform == 'twitter':
        r, _ = _svc("twitter", "GET", f"/api/twitter/messages?conversationId={thread_id}&limit={limit}", timeout=20)
        msgs = r.get('messages', []) if r else []
    elif platform == 'tiktok':
        r, _ = _svc("tiktok", "GET", f"/api/tiktok/messages?limit={limit}", timeout=20)
        msgs = r.get('messages', []) if r else []
    elif platform == 'linkedin':
        r, _ = _svc("linkedin", "GET", f"/api/linkedin/messages?limit={limit}", timeout=20)
        msgs = r.get('messages', []) if r else []
    else:
        msgs = []
    return msgs


# ── Sync: upsert contacts + conversations ─────────────────────────────────────
def sync_platform_contacts(platform, convos):
    """Upsert contacts and conversations into crm tables."""
    upserted = 0
    for c in convos:
        name = (c.get('name') or c.get('handle') or '').strip()
        if not name:
            continue

        # Build contact row — use platform+handle as dedup key via display_name + platform
        handle = c.get('handle', '')
        contact_row = {
            'display_name':          name,
            'platform':              platform,
            'username':              handle,
            'last_message':          (c.get('last_message') or '')[:500],
            'last_message_at':       _safe_ts(c.get('last_message_at')) or utcnow(),
            'source':                f'{platform}_dm',
            'relationship_stage':    'cold',
            'updated_at':            utcnow(),
        }
        # Set platform-specific handle column
        if platform == 'instagram':
            contact_row['instagram_handle'] = handle
        elif platform == 'twitter':
            contact_row['twitter_handle'] = handle
        elif platform == 'tiktok':
            contact_row['tiktok_handle'] = handle
        elif platform == 'linkedin':
            contact_row['linkedin_url'] = handle

        # Try to find existing contact by platform+username
        existing = _sb_get('crm_contacts',
                            **{'platform': f'eq.{platform}',
                               'username': f'eq.{handle}',
                               'select': 'id',
                               'limit': 1})
        if existing:
            cid = existing[0]['id']
            _sb('PATCH', 'crm_contacts',
                {k: v for k, v in contact_row.items()},
                params={'id': f'eq.{cid}'})
        else:
            result = _sb('POST', 'crm_contacts', contact_row)
            if isinstance(result, list) and result:
                cid = result[0]['id']
            else:
                continue

        # Upsert conversation (find + update / insert)
        convo_row = {
            'contact_id':           cid,
            'platform':             platform,
            'platform_thread_id':   c.get('thread_id', ''),
            'last_message_preview': (c.get('last_message') or '')[:200],
            'last_message_at':      _safe_ts(c.get('last_message_at')) or utcnow(),
            'updated_at':           utcnow(),
        }
        existing_conv = _sb_get('crm_conversations',
                                **{'contact_id': f'eq.{cid}',
                                   'platform':   f'eq.{platform}',
                                   'select': 'id', 'limit': 1})
        if existing_conv:
            _sb('PATCH', 'crm_conversations', convo_row,
                params={'id': f'eq.{existing_conv[0]["id"]}'})
        else:
            _sb('POST', 'crm_conversations', convo_row)
        upserted += 1

    return upserted


def sync_linkedin_prospects():
    """Import qualified linkedin_prospects → crm_contacts."""
    prospects = _sb_get('linkedin_prospects',
                         **{'stage': 'not.eq.not_fit',
                            'select': '*',
                            'limit': 500})
    upserted = 0
    for p in prospects:
        if not p.get('full_name'):
            continue
        row = {
            'display_name':       p['full_name'],
            'platform':           'linkedin',
            'username':           p.get('profile_url', ''),
            'linkedin_url':       p.get('profile_url', ''),
            'headline':           p.get('headline', ''),
            'bio':                p.get('about_snippet', ''),
            'source':             'linkedin_search',
            'relationship_stage': p.get('stage', 'cold'),
            'relationship_score': p.get('fit_score', 0),
            'last_message':       p.get('connection_note', ''),
            'last_message_at':    p.get('contacted_at') or utcnow(),
            'updated_at':         utcnow(),
        }
        existing = _sb_get('crm_contacts',
                            **{'linkedin_url': f'eq.{p.get("profile_url", "")}',
                               'select': 'id',
                               'limit': 1})
        if existing:
            _sb('PATCH', 'crm_contacts', row,
                params={'id': f'eq.{existing[0]["id"]}'})
        else:
            _sb('POST', 'crm_contacts', row)
        upserted += 1
    return upserted


# ── Claude AI helpers ──────────────────────────────────────────────────────────
def _claude(prompt, system=None, max_tokens=800):
    if not ANTHROPIC_API_KEY:
        return None, "ANTHROPIC_API_KEY not set"
    body = {
        'model':      CLAUDE_MODEL,
        'max_tokens': max_tokens,
        'messages':   [{'role': 'user', 'content': prompt}],
    }
    if system:
        body['system'] = system
    result, err = _http(
        'POST',
        'https://api.anthropic.com/v1/messages',
        body,
        headers={
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        timeout=30
    )
    if err:
        return None, err
    try:
        return result['content'][0]['text'].strip(), None
    except Exception as e:
        return None, str(e)


# ── AI: Score a contact ────────────────────────────────────────────────────────
def ai_score_contact(contact, messages=None):
    """
    Use Claude to score relationship depth (0-100) and determine stage.
    Returns (score, stage, summary, next_action).
    """
    name = contact.get('display_name', 'Unknown')
    platform = contact.get('platform', '')
    headline = contact.get('headline') or contact.get('bio', '')
    msgs_text = ''
    if messages:
        for m in messages[-10:]:  # last 10 messages
            direction = '→' if m.get('direction') == 'outbound' else '←'
            msgs_text += f"{direction} {m.get('body', '')[:200]}\n"

    prompt = f"""Analyze this contact and score the relationship.

Contact: {name}
Platform: {platform}
Headline: {headline}
Message history (→ = sent by us, ← = received):
{msgs_text or '(no messages yet)'}

Score this relationship from 0-100:
0-20: Cold (no interaction or never replied)
21-40: Warm (some interaction, shows interest)
41-60: Engaged (regular interaction, positive signals)
61-80: Hot (actively interested, asked about services)
81-100: Client/High-Value (paid or very close to buying)

Respond ONLY as JSON (no markdown):
{{
  "score": <0-100>,
  "stage": "cold|warm|engaged|hot|client",
  "offer_readiness": <0-100>,
  "summary": "<2-3 sentence summary of relationship>",
  "next_action": "<specific next best action to take>",
  "next_action_type": "nurture|offer|follow_up|check_in|none"
}}"""

    text, err = _claude(prompt, system=BRAND_VOICE, max_tokens=400)
    if err or not text:
        return 0, 'cold', '', 'No API key or error', 'none'
    try:
        # Extract JSON from response
        m = re.search(r'\{.*\}', text, re.DOTALL)
        data = json.loads(m.group(0)) if m else {}
        return (
            int(data.get('score', 0)),
            data.get('stage', 'cold'),
            data.get('summary', ''),
            data.get('next_action', ''),
            data.get('next_action_type', 'none'),
            int(data.get('offer_readiness', 0)),
        )
    except Exception:
        return 0, 'cold', text[:200], '', 'none', 0


# ── AI: Generate message ───────────────────────────────────────────────────────
def ai_generate_message(contact, message_type='nurture', messages=None):
    """
    Generate a brand-aligned message for a contact.
    Returns (message_body, reasoning).
    """
    name = (contact.get('display_name') or '').split()[0] or 'there'
    headline = contact.get('headline') or contact.get('bio', '')
    stage = contact.get('relationship_stage', 'cold')
    score = contact.get('relationship_score', 0)
    platform = contact.get('platform', 'linkedin')

    recent = ''
    if messages:
        for m in messages[-5:]:
            d = '→' if m.get('direction') == 'outbound' else '←'
            recent += f"{d} {m.get('body', '')[:150]}\n"

    char_limit = {
        'linkedin': 300,
        'instagram': 500,
        'twitter': 280,
        'tiktok': 500,
    }.get(platform, 400)

    type_instructions = {
        'nurture':    "A value-add message — share an insight, resource, or genuine observation. No pitch.",
        'offer':      f"A soft offer for your content writing/ghostwriting services. Natural, not salesy.",
        'follow_up':  "A brief, warm follow-up to continue the conversation.",
        'check_in':   "A genuine check-in — ask how they're doing with something specific.",
        'connection_note': "A LinkedIn connection request note — warm, specific to them, no pitch.",
    }.get(message_type, "A warm, brand-aligned message.")

    prompt = f"""Write a {message_type} message for this contact.

Contact: {name}
Platform: {platform}
Their headline: {headline}
Relationship stage: {stage} (score: {score}/100)
Recent conversation:
{recent or '(no previous messages)'}

Message type: {type_instructions}
Max characters: {char_limit}

Respond ONLY as JSON (no markdown):
{{
  "message": "<the message to send — personalized, natural, under {char_limit} chars>",
  "reasoning": "<why this message is right for them now>"
}}"""

    text, err = _claude(prompt, system=BRAND_VOICE, max_tokens=500)
    if err or not text:
        return None, f"Claude error: {err}"
    try:
        m = re.search(r'\{.*\}', text, re.DOTALL)
        data = json.loads(m.group(0)) if m else {}
        return data.get('message', ''), data.get('reasoning', '')
    except Exception:
        return None, f"parse error: {text[:100]}"


# ── Unified send ───────────────────────────────────────────────────────────────
def send_message(contact, message_body, test_mode=False):
    """
    Route message to correct platform service and send.
    Returns (success, detail).
    """
    name = (contact.get('display_name') or '').lower()
    platform = contact.get('platform', '')
    handle = contact.get('username', '')

    if test_mode and TEST_CONTACT not in name:
        return False, f'test_mode: skipped {name} (not {TEST_CONTACT})'

    if platform == 'linkedin':
        # Send via service; falls back gracefully if JS timeout occurs
        r, err = _http('POST', f"{PLATFORM_SERVICES['linkedin']}/api/linkedin/messages/send-to",
                       {'profileUrl': handle, 'text': message_body}, timeout=60)
        if err:
            return False, f'linkedin: {err}'
        return r.get('success', False), r.get('message', str(r))

    elif platform == 'instagram':
        r, err = _http('POST', f"{PLATFORM_SERVICES['instagram']}/api/messages/send-to",
                       {'username': handle, 'message': message_body}, timeout=60)
        if err:
            return False, f'instagram: {err}'
        return r.get('success', False), r.get('message', str(r))

    elif platform == 'twitter':
        r, err = _http('POST', f"{PLATFORM_SERVICES['twitter']}/api/twitter/messages/send-to",
                       {'username': handle, 'text': message_body}, timeout=60)
        if err:
            return False, f'twitter: {err}'
        return r.get('success', False), r.get('message', str(r))

    elif platform == 'tiktok':
        r, err = _http('POST', f"{PLATFORM_SERVICES['tiktok']}/api/tiktok/messages/send-to",
                       {'username': handle, 'text': message_body}, timeout=60)
        if err:
            return False, f'tiktok: {err}'
        return r.get('success', False), r.get('message', str(r))

    return False, f'unknown platform: {platform}'


# ── Pipeline: score all contacts ───────────────────────────────────────────────
def run_score(limit=50, verbose=False):
    if not ANTHROPIC_API_KEY:
        print("  ⚠️  ANTHROPIC_API_KEY not set — skipping AI scoring")
        return 0
    contacts = _sb_get('crm_contacts', **{'limit': limit, 'order': 'updated_at.desc'})
    print(f"\n  🧠 Scoring {len(contacts)} contacts with Claude...")
    updated = 0
    for c in contacts:
        cid = c['id']
        # Fetch recent messages
        msgs_raw = _sb_get('crm_messages',
                            **{'contact_id': f'eq.{cid}',
                               'order': 'sent_at.desc',
                               'limit': 10})
        result = ai_score_contact(c, msgs_raw)
        if len(result) == 6:
            score, stage, summary, next_action, action_type, offer_readiness = result
        else:
            score, stage, summary, next_action, action_type, offer_readiness = 0, 'cold', '', '', 'none', 0

        # Update contact
        _sb('PATCH', 'crm_contacts',
            {'relationship_score': score,
             'relationship_stage': stage,
             'ai_summary': summary,
             'next_action': next_action,
             'offer_readiness': offer_readiness,
             'updated_at': utcnow()},
            params={'id': f'eq.{cid}'})

        # Log score history
        _sb('POST', 'crm_score_history',
            {'contact_id': cid, 'score': score, 'stage': stage, 'reason': summary[:200]})

        if verbose or score >= 40:
            flag = '🔥' if score >= 60 else ('✅' if score >= 40 else '·')
            print(f"    {flag} [{score:3d}] {c.get('display_name','?')[:30]:30s} | {stage:8s} | {next_action[:50]}")
        updated += 1
    return updated


# ── Pipeline: generate messages ────────────────────────────────────────────────
def run_generate(limit=20, min_score=20):
    if not ANTHROPIC_API_KEY:
        print("  ⚠️  ANTHROPIC_API_KEY not set — skipping generation")
        return 0
    # Get contacts that need outreach (warm/engaged/hot, no recent outbound)
    contacts = _sb_get('crm_contacts',
                        **{'relationship_score': f'gte.{min_score}',
                           'limit': limit,
                           'order': 'relationship_score.desc'})
    # Filter those without a pending queue item
    queued_cids = {q['contact_id']
                   for q in _sb_get('crm_message_queue',
                                    **{'status': 'eq.pending', 'select': 'contact_id'})}
    to_generate = [c for c in contacts if c['id'] not in queued_cids]

    print(f"\n  ✍️  Generating messages for {len(to_generate)} contacts...")
    queued = 0
    for c in to_generate:
        cid = c['id']
        stage = c.get('relationship_stage', 'cold')
        offer_readiness = c.get('offer_readiness', 0)
        score = c.get('relationship_score', 0)

        # Determine message type
        if offer_readiness >= 70 and stage in ('hot', 'engaged'):
            msg_type = 'offer'
        elif stage in ('warm', 'engaged', 'hot'):
            msg_type = 'follow_up' if c.get('last_outbound_at') else 'nurture'
        else:
            msg_type = 'nurture'

        msgs = _sb_get('crm_messages',
                       **{'contact_id': f'eq.{cid}',
                          'order': 'sent_at.desc',
                          'limit': 5})
        message, reasoning = ai_generate_message(c, msg_type, msgs)
        if not message:
            continue

        # Schedule 1–3 days out with some spread
        delay_hours = random.randint(2, 72)
        scheduled = (datetime.now(timezone.utc) + timedelta(hours=delay_hours)).isoformat()

        _sb('POST', 'crm_message_queue',
            {'contact_id':   cid,
             'platform':     c.get('platform', 'linkedin'),
             'message_body': message,
             'message_type': msg_type,
             'scheduled_for': scheduled,
             'status':       'pending',
             'ai_reasoning': reasoning,
             'priority':     score // 10})

        print(f"    📝 [{score:3d}] {c.get('display_name','?')[:30]:30s} | {msg_type:10s} | {message[:60]}...")
        queued += 1

    return queued


# ── Pipeline: send queued messages ────────────────────────────────────────────
def run_send(limit=10, test_mode=False):
    now = utcnow()
    queue = _sb_get('crm_message_queue',
                    **{'status':        'eq.pending',
                       'scheduled_for': f'lte.{now}',
                       'order':         'priority.desc,scheduled_for.asc',
                       'limit':         limit})
    if not queue:
        print("  No messages ready to send.")
        return 0

    mode = "TEST MODE" if test_mode else "LIVE"
    print(f"\n  📤 Sending {len(queue)} queued messages ({mode})...")
    sent = 0
    for item in queue:
        cid = item['contact_id']
        contacts = _sb_get('crm_contacts', **{'id': f'eq.{cid}', 'select': '*', 'limit': 1})
        if not contacts:
            continue
        contact = contacts[0]
        name = contact.get('display_name', '?')
        platform = item.get('platform', '')
        body = item.get('message_body', '')

        print(f"\n  → {name[:35]} [{platform}]")
        print(f"     {body[:80]}...")

        # Mark as sending
        _sb('PATCH', 'crm_message_queue', {'status': 'sending'},
            params={'id': f'eq.{item["id"]}'})

        ok, detail = send_message(contact, body, test_mode=test_mode)
        status = '✅' if ok else '❌'
        print(f"     {status} {detail[:80]}")

        new_status = 'sent' if ok else 'failed'
        _sb('PATCH', 'crm_message_queue',
            {'status': new_status, 'sent_at': utcnow()},
            params={'id': f'eq.{item["id"]}'})

        if ok:
            # Log to crm_messages
            conv = _sb_get('crm_conversations',
                           **{'contact_id': f'eq.{cid}',
                              'platform': f'eq.{platform}',
                              'select': 'id',
                              'limit': 1})
            conv_id = conv[0]['id'] if conv else None
            _sb('POST', 'crm_messages',
                {'contact_id':     cid,
                 'conversation_id': conv_id,
                 'platform':       platform,
                 'direction':      'outbound',
                 'body':           body,
                 'ai_generated':   True,
                 'message_type':   item.get('message_type', 'conversation'),
                 'sent_at':        utcnow()})
            # Update contact stats
            _sb('PATCH', 'crm_contacts',
                {'total_messages_sent': (contact.get('total_messages_sent') or 0) + 1,
                 'last_outbound_at':    utcnow(),
                 'messages_sent':       (contact.get('messages_sent') or 0) + 1},
                params={'id': f'eq.{cid}'})
            sent += 1

        time.sleep(random.uniform(2, 5))  # rate limit between sends

    return sent


# ── Sync all platforms ─────────────────────────────────────────────────────────
def run_sync(platforms=None):
    if platforms is None:
        platforms = ['instagram', 'twitter', 'tiktok', 'linkedin']

    alive = _check_services()
    print(f"\n  🔌 Service status: {', '.join(f'{p}:{'✅' if up else '❌'}' for p, up in alive.items())}")

    collectors = {
        'instagram': _collect_instagram,
        'twitter':   _collect_twitter,
        'tiktok':    _collect_tiktok,
        'linkedin':  _collect_linkedin,
    }
    total = 0
    for p in platforms:
        if not alive.get(p):
            print(f"    {p}: service down, skipping")
            continue
        print(f"    {p}: collecting...", end=' ', flush=True)
        convos = collectors[p]()
        n = sync_platform_contacts(p, convos)
        total += n
        print(f"{len(convos)} conversations → {n} contacts upserted")

    return total


# ── Status dashboard ──────────────────────────────────────────────────────────
def show_status():
    print("\n" + "═" * 65)
    print("  CRM BRAIN — STATUS DASHBOARD")
    print("═" * 65)

    # Service health
    alive = _check_services()
    svc_line = "  Services: " + "  ".join(
        f"{'✅' if up else '❌'} {p}" for p, up in alive.items())
    print(svc_line)

    # Contact breakdown by stage
    stages = ['cold', 'warm', 'engaged', 'hot', 'client', 'churned']
    print("\n  CONTACTS BY STAGE:")
    all_contacts = _sb_get('crm_contacts', **{'limit': 500})
    stage_counts = {}
    for c in all_contacts:
        s = c.get('relationship_stage') or 'cold'
        stage_counts[s] = stage_counts.get(s, 0) + 1
    for s in stages:
        n = stage_counts.get(s, 0)
        if n:
            bar = '█' * min(n, 30)
            print(f"    {s:10s}  {n:4d}  {bar}")

    # Queue status
    queue = _sb_get('crm_message_queue', **{'limit': 100})
    pending = sum(1 for q in queue if q.get('status') == 'pending')
    sent_today = sum(1 for q in queue
                     if q.get('status') == 'sent' and
                     (q.get('sent_at') or '') >= datetime.now(timezone.utc).strftime('%Y-%m-%d'))
    print(f"\n  MESSAGE QUEUE: {pending} pending | {sent_today} sent today")

    # Top contacts by score
    top = sorted(all_contacts, key=lambda c: c.get('relationship_score') or 0, reverse=True)[:8]
    if top:
        print("\n  TOP CONTACTS:")
        for c in top:
            score = c.get('relationship_score') or 0
            stage = c.get('relationship_stage') or 'cold'
            platform = c.get('platform', '')
            action = (c.get('next_action') or '')[:45]
            print(f"    [{score:3d}] {c.get('display_name','?')[:28]:28s} | {stage:8s} | {platform:9s} | {action}")

    # Platform breakdown
    platform_counts = {}
    for c in all_contacts:
        p = c.get('platform', 'unknown')
        platform_counts[p] = platform_counts.get(p, 0) + 1
    print(f"\n  BY PLATFORM: {dict(platform_counts)}")
    print("═" * 65)


# ── Contact deep review ───────────────────────────────────────────────────────
def review_contact(name_query):
    contacts = _sb_get('crm_contacts', **{'limit': 200})
    matches = [c for c in contacts if name_query.lower() in (c.get('display_name') or '').lower()]
    if not matches:
        print(f"  No contact found matching '{name_query}'")
        return
    c = matches[0]
    cid = c['id']
    msgs = _sb_get('crm_messages',
                   **{'contact_id': f'eq.{cid}', 'order': 'sent_at.asc', 'limit': 20})
    queue = _sb_get('crm_message_queue',
                    **{'contact_id': f'eq.{cid}', 'status': 'eq.pending', 'limit': 5})
    history = _sb_get('crm_score_history',
                      **{'contact_id': f'eq.{cid}', 'order': 'created_at.desc', 'limit': 5})

    print(f"\n{'═'*65}")
    print(f"  {c.get('display_name')} | {c.get('platform')} | @{c.get('username','')}")
    print(f"  {c.get('headline') or c.get('bio','')}")
    print(f"  Score: {c.get('relationship_score',0)} | Stage: {c.get('relationship_stage','cold')} | Offer Readiness: {c.get('offer_readiness',0)}")
    if c.get('ai_summary'):
        print(f"\n  AI Summary: {c.get('ai_summary')}")
    if c.get('next_action'):
        print(f"  Next Action: {c.get('next_action')}")
    if msgs:
        print(f"\n  Message History ({len(msgs)} messages):")
        for m in msgs[-8:]:
            d = '→' if m.get('direction') == 'outbound' else '←'
            ts = (m.get('sent_at') or '')[:10]
            print(f"    {d} [{ts}] {m.get('body','')[:80]}")
    if queue:
        print(f"\n  Pending Queue ({len(queue)} items):")
        for q in queue:
            print(f"    📅 [{q.get('message_type')}] {q.get('message_body','')[:70]}...")
    if history:
        print(f"\n  Score History: " + ' → '.join(str(h['score']) for h in reversed(history)))
    print('═' * 65)


# ── CLI ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    args = sys.argv[1:]

    if not args or '--help' in args:
        print(__doc__)
        sys.exit(0)

    test_mode = '--send-test' in args or '--test' in args

    if '--status' in args:
        show_status()

    if '--review' in args:
        idx = args.index('--review')
        name = args[idx + 1] if idx + 1 < len(args) else ''
        review_contact(name)

    if '--sync-linkedin' in args:
        print("\n  📥 Syncing LinkedIn prospects → crm_contacts...")
        n = sync_linkedin_prospects()
        print(f"  ✅ {n} LinkedIn prospects synced")

    if '--sync' in args or '--pipeline' in args:
        print("\n  🔄 SYNCING ALL PLATFORMS")
        print("  ─" * 30)
        n = run_sync()
        print(f"\n  ✅ Synced {n} contacts total")

    if '--score' in args or '--pipeline' in args:
        limit_arg = next((int(a.split('=')[1]) for a in args if a.startswith('--limit=')), 50)
        print("\n  🧠 SCORING CONTACTS")
        print("  ─" * 30)
        n = run_score(limit=limit_arg, verbose='--verbose' in args)
        print(f"\n  ✅ Scored {n} contacts")

    if '--generate' in args or '--pipeline' in args:
        min_score = next((int(a.split('=')[1]) for a in args if a.startswith('--min-score=')), 20)
        print("\n  ✍️  GENERATING MESSAGES")
        print("  ─" * 30)
        n = run_generate(limit=20, min_score=min_score)
        print(f"\n  ✅ {n} messages queued")

    if '--send' in args or '--send-test' in args or '--pipeline' in args:
        limit_arg = next((int(a.split('=')[1]) for a in args if a.startswith('--limit=')), 10)
        print("\n  📤 SENDING MESSAGES")
        print("  ─" * 30)
        n = run_send(limit=limit_arg, test_mode=test_mode)
        print(f"\n  ✅ {n} messages sent")

    if not any(a in args for a in ('--sync', '--score', '--generate', '--send',
                                    '--send-test', '--pipeline', '--status',
                                    '--review', '--sync-linkedin')):
        print(__doc__)
        sys.exit(1)

    show_status()
