#!/usr/bin/env python3
"""
Creative Radar — Offer-Agnostic Market Research Engine

Architecture (from the GPT conversation):
  1. OfferSpec config drives everything
  2. Discovery layer (Ad Library, FB organic, IG hashtags)
  3. Content tagger (awareness stage, hook type, pain point, CTA)
  4. Multi-objective ranking (FitScore, PerformanceScore, FormatScore, RepeatabilityScore)
  5. Pattern miner → extract reusable primitives
  6. Awareness-stage brief generator (5 Schwartz stages)

Usage:
  from market_research.creative_radar import CreativeRadar
  radar = CreativeRadar("everreach")
  radar.discover()          # scrape all keywords
  radar.tag_and_rank()      # classify + score
  radar.mine_patterns()     # extract primitives
  radar.generate_briefs()   # 5-stage briefs
  radar.report()            # full dashboard
"""
import json
import re
import os
import time
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from collections import Counter
from loguru import logger

RESEARCH_BASE = Path(os.path.expanduser("~/market-research"))

# ═══════════════════════════════════════════════════════════════
# 1. OFFER SPECS — offer-agnostic product configs
# ═══════════════════════════════════════════════════════════════

OFFER_SPECS: Dict[str, dict] = {
    "everreach": {
        "name": "EverReach",
        "tagline": "A personal CRM that turns care into a repeatable rhythm",
        "url": "everreach.app",
        "cta": "Start Free Trial",

        # ICP — who is this for
        "icp": [
            "Adults 22-45 who feel guilty about losing touch",
            "People with ADHD who struggle with follow-through on relationships",
            "Solopreneurs/creators whose pipeline leaks from no follow-up system",
            "Networkers who want relationship capital without feeling spammy",
        ],

        # Job-to-be-done — what they're trying to accomplish
        "jtbd": [
            "Stay close to people I care about without it feeling forced",
            "Remember to follow up before it's awkward",
            "Turn relationships into a sustainable rhythm, not a guilt cycle",
        ],

        # Pains & objections — what stops them
        "pains": [
            "friendships drifting apart",
            "forgetting to follow up",
            "not knowing what to say after a long silence",
            "relationships fading when life gets busy",
            "DMs/texts are a graveyard of good intentions",
            "ADHD makes consistency feel impossible",
        ],
        "objections": [
            "this feels spammy / corporate",
            "I don't need an app to be a good friend",
            "I'll just use reminders / my calendar",
            "sounds like too much work",
            "another subscription I won't use",
        ],

        # Desired transformation — the 'after' state
        "transformation": [
            "I'm the type of person who shows up for people",
            "My relationships have a rhythm, not a guilt cycle",
            "I reconnected with 8 people I love and 2 became opportunities",
        ],

        # Core mechanism — the unique 'how'
        "mechanism": "Top people list + warmth score + gentle reminders + message starters",
        "mechanism_short": "rhythm > motivation",

        # Product features (for proof beats)
        "features": [
            "Top people list + warmth score — see who needs attention",
            "Gentle reminders so no one slips through the cracks",
            "Message starters when your brain goes blank",
        ],

        # Creative constraints
        "formats_preferred": ["UGC vertical video", "founder-to-camera", "screen recording demo", "carousel"],
        "formats_avoid": ["stock footage", "corporate B-roll", "listicle without emotion"],
        "brand_safety": ["no shaming language", "no 'you're a bad friend' framing", "warm not preachy"],

        # Discovery keywords — what the ICP searches for
        "search_keywords": {
            "guilt_overwhelm": [
                "how to stop ghosting people",
                "I forget to text back",
                "overwhelmed socially",
                "reconnect with friends",
                "what to say when you disappeared",
                "unghosting scripts",
            ],
            "adult_friendships": [
                "how to maintain friendships as an adult",
                "adult friendship",
                "check in on friends",
                "staying connected",
                "friendship habits",
            ],
            "networking_followup": [
                "networking follow up",
                "follow up message after meeting",
                "personal CRM",
                "relationship building networking",
                "relationship capital",
            ],
            "solopreneur_pipeline": [
                "client follow up system",
                "CRM for freelancers",
                "warm leads nurture",
                "creator outreach",
            ],
            "tools_systems": [
                "personal crm app",
                "relationship tracker app",
                "contact reminder app",
                "follow up app",
                "stay in touch app",
                "friendship tracker",
            ],
        },

        # Hashtags the ICP follows
        "hashtags": [
            "#adultfriendships", "#socialanxiety", "#adhd", "#peoplepleasing",
            "#selfimprovement", "#communicationtips", "#networking", "#careeradvice",
            "#personalgrowth", "#relationshipbuilding", "#professionaldevelopment",
            "#intentionalliving", "#personalcrm",
        ],

        # Schwartz awareness-stage hooks
        "awareness_hooks": {
            "unaware": {
                "hook": "most friendships don't end — they drift",
                "goal": "create emotional recognition, no product",
                "cta": "save / comment (NOT download)",
                "script": [
                    "most friendships don't end they drift",
                    "you care you just get busy and time disappears",
                    "the goal isn't to catch up it's to make the next message normal again",
                    "that takes a rhythm not motivation",
                    "i built a simple system for that — link in bio",
                ],
            },
            "problem_aware": {
                "hook": "the longer you wait, the more awkward it feels",
                "goal": "name the enemy, agitate, hint at relief",
                "cta": "comment keyword for templates",
                "script": [
                    "the longer you wait the more awkward it feels",
                    "then you overthink then you send nothing",
                    "and months turn into distance",
                    "so here's the fix — a tiny check in rhythm plus message starters",
                    "i use a personal crm that reminds me who to check in on",
                ],
            },
            "solution_aware": {
                "hook": "stop doing relationships from memory",
                "goal": "introduce mechanism (rhythm + list + starters)",
                "cta": "comment for the method / follow",
                "script": [
                    "stop doing relationships from memory",
                    "memory fails when life gets loud",
                    "here's the rhythm — top people list, weekly rotation, and starters",
                    "download everreach — start your free trial",
                ],
            },
            "product_aware": {
                "hook": "if you want to stay close without overthinking, this is the tool",
                "goal": "demo 3 features → 1 outcome",
                "cta": "download / start trial",
                "script": [
                    "if you want to stay close without overthinking this is the tool",
                    "feature one — top people list and warmth score",
                    "feature two — last touch and gentle reminders",
                    "feature three — message starters when your brain is blank",
                    "the goal isn't to catch up — it's to make the next message normal again",
                    "start free trial",
                ],
            },
            "most_aware": {
                "hook": "this is not spammy — it's a reminder to be human",
                "goal": "kill objections directly",
                "cta": "start free trial, no pressure",
                "script": [
                    "this is not spammy it's a reminder to be human",
                    "you choose your circle and how often you want to check in",
                    "it gives you starters so it never feels awkward",
                    "cancel anytime no pressure",
                    "start the free trial and see if it fits",
                ],
            },
        },

        # FATE framework
        "fate": {
            "familiarity": "You care. You just get busy and time disappears.",
            "authority": "I built a simple system for that.",
            "trust": "Show: list → reminder → message starter → send",
            "emotion": "Relief + identity: 'I'm the type of person who shows up for people.'",
        },
    },

    # ───────────────────────────────────────────────────────────
    # SteadyLetters — Physical mail SaaS
    # ───────────────────────────────────────────────────────────
    "steadyletters": {
        "name": "SteadyLetters",
        "tagline": "Send real letters that actually get opened",
        "url": "steadyletters.com",
        "cta": "Send Your First Letter Free",

        "icp": [
            "Small business owners who want to stand out in a digital-first world",
            "Real estate agents / insurance brokers who rely on repeat + referral",
            "E-commerce brands wanting to boost retention with a personal touch",
            "Creators / coaches who want a premium touchpoint with VIP clients",
        ],

        "jtbd": [
            "Send personalized physical mail without going to the post office",
            "Automate thank-you cards, follow-ups, and holiday mailers at scale",
            "Convert digital relationships into tangible, memorable moments",
        ],

        "pains": [
            "email open rates are dying",
            "digital ads feel impersonal and get ignored",
            "no time to handwrite cards or go to the post office",
            "mailchimp / email fatigue — everyone is in the inbox",
            "losing clients to competitors who feel more personal",
            "want to send thank-you notes but never follow through",
        ],
        "objections": [
            "physical mail is dead / outdated",
            "too expensive per piece vs email",
            "I don't have time to design mailers",
            "my customers don't check their mailbox",
            "sounds like junk mail",
        ],

        "transformation": [
            "My clients tell me 'that letter made my day'",
            "I send 50 thank-you cards a month without lifting a pen",
            "My retention rate jumped because people remember physical mail",
        ],

        "mechanism": "AI letter generation + handwriting fonts + voice-to-letter + Thanks.io print & mail API",
        "mechanism_short": "type it → we print & mail it",

        "features": [
            "AI letter writer — describe what you want to say, get a perfect letter",
            "Voice-to-letter — record a voice memo, we turn it into a handwritten card",
            "Handwriting styles — pick from realistic handwriting fonts",
            "Postcards, letters, and greeting cards — all formats",
            "Bulk send — upload a CSV and mail 500 letters in one click",
        ],

        "formats_preferred": ["before/after demos", "unboxing reaction videos", "screen recording walkthrough", "testimonial UGC"],
        "formats_avoid": ["corporate B2B style", "stock photo mailers", "hard-sell infomercial"],
        "brand_safety": ["no spam framing", "no 'junk mail' language", "warm and premium tone"],

        "search_keywords": {
            "mail_marketing": [
                "direct mail marketing",
                "send handwritten letters",
                "physical mail marketing",
                "direct mail for small business",
                "handwritten note service",
            ],
            "retention": [
                "customer retention strategies",
                "thank you card for clients",
                "client appreciation ideas",
                "how to stand out as a business",
                "personal touch marketing",
            ],
            "real_estate": [
                "real estate farming letters",
                "real estate mailer ideas",
                "just sold postcards",
                "real estate thank you note",
            ],
            "ecommerce": [
                "ecommerce retention",
                "post purchase experience",
                "unboxing experience ideas",
                "handwritten note in package",
            ],
        },

        "hashtags": [
            "#directmail", "#handwrittennotes", "#smallbusinesstips", "#clientappreciation",
            "#realestatemark", "#customerretention", "#personaltouchmarketing",
            "#thankyoucards", "#mailmarketing", "#businessgrowth",
        ],

        "awareness_hooks": {
            "unaware": {
                "hook": "your customers remember a letter longer than 100 emails",
                "goal": "pattern interrupt — physical > digital",
                "cta": "save / share",
                "script": [
                    "your customers remember a letter longer than 100 emails",
                    "in a world of inboxes and notifications a real letter stops people cold",
                    "it's not about being old school it's about being unforgettable",
                    "the businesses winning right now are the ones that feel personal",
                ],
            },
            "problem_aware": {
                "hook": "your emails are getting ignored — here's what actually gets opened",
                "goal": "agitate email fatigue, tease physical mail",
                "cta": "comment LETTER for the strategy",
                "script": [
                    "email open rates are at 20 percent and falling",
                    "your best customers are drowning in digital noise",
                    "but a handwritten letter? 99 percent open rate",
                    "because nobody throws away a real letter without reading it",
                ],
            },
            "solution_aware": {
                "hook": "I send 50 personalized letters a month without touching a pen",
                "goal": "reveal mechanism — AI + handwriting + auto-mail",
                "cta": "follow for the full walkthrough",
                "script": [
                    "I send 50 personalized letters a month without touching a pen",
                    "I type what I want to say or just record a voice memo",
                    "AI writes the letter in a handwriting font that looks real",
                    "it prints and mails automatically — my clients love it",
                ],
            },
            "product_aware": {
                "hook": "this app sends real handwritten letters for you",
                "goal": "demo the product — voice to letter + preview + send",
                "cta": "send your first letter free",
                "script": [
                    "this app sends real handwritten letters for you",
                    "step one record what you want to say",
                    "step two pick a handwriting style and card type",
                    "step three preview and send — it arrives in 3 to 5 days",
                    "send your first letter free right now",
                ],
            },
            "most_aware": {
                "hook": "yes real mail still works — here's the proof",
                "goal": "testimonials + objection killing",
                "cta": "try free — no subscription required for first letter",
                "script": [
                    "yes real mail still works — here's the proof",
                    "98 percent of direct mail gets opened versus 20 percent for email",
                    "our users see 3x higher response rates on thank you letters",
                    "it's not junk mail when it's personal and handwritten",
                    "try it free — send your first letter today",
                ],
            },
        },

        "fate": {
            "familiarity": "Your inbox is full. Your mailbox isn't.",
            "authority": "We've sent 10,000+ letters for small businesses.",
            "trust": "Show: voice memo → AI letter → handwriting preview → arrives at door",
            "emotion": "Delight: 'my client called me just to say thank you for the letter.'",
        },
    },

    # ───────────────────────────────────────────────────────────
    # VelvetHold — Deposit-based date reservation
    # ───────────────────────────────────────────────────────────
    "velvethold": {
        "name": "VelvetHold",
        "tagline": "Stop no-shows with a simple deposit link",
        "url": "velvethold.com",
        "cta": "Create Your First Hold",

        "icp": [
            "Hairstylists / barbers / lash techs / nail artists who lose money to no-shows",
            "Personal trainers / coaches / consultants who need commitment before booking",
            "Tattoo artists / photographers / event planners who need deposits",
            "Any service provider tired of wasted time slots",
        ],

        "jtbd": [
            "Collect a deposit before confirming a booking so clients show up",
            "Send a simple link — no app download, no friction for the client",
            "Eliminate the awkwardness of asking for money upfront",
        ],

        "pains": [
            "clients book and don't show up",
            "losing $200+ per no-show",
            "feel awkward asking for deposits",
            "current booking tools are too complicated",
            "Venmo/Zelle deposits feel unprofessional",
            "calendly doesn't collect deposits",
        ],
        "objections": [
            "my clients won't pay a deposit",
            "I'll lose bookings if I charge upfront",
            "I already use Square / Calendly",
            "sounds too complicated to set up",
            "what if the client wants a refund",
        ],

        "transformation": [
            "My no-show rate went from 30% to 2%",
            "I stopped losing $800/month to people who don't show up",
            "Clients actually respect my time now because they have skin in the game",
        ],

        "mechanism": "Custom deposit link + automatic hold + Stripe checkout + confirmation flow",
        "mechanism_short": "link → deposit → confirmed",

        "features": [
            "Create a deposit link in 30 seconds — set amount, expiry, refund policy",
            "Client pays via Stripe — no app download needed",
            "Automatic confirmation + reminder emails",
            "Refund or apply deposit to final bill with one click",
        ],

        "formats_preferred": ["rant-to-camera about no-shows", "before/after revenue screenshots", "tutorial walkthrough", "client reaction"],
        "formats_avoid": ["corporate SaaS demo", "generic booking tool comparison"],
        "brand_safety": ["no client-shaming", "empathetic to both sides", "professional tone"],

        "search_keywords": {
            "no_shows": [
                "how to stop no shows",
                "client no show policy",
                "no show fee",
                "how to deal with no shows",
                "cancellation policy for small business",
            ],
            "deposits": [
                "how to collect deposits",
                "deposit for appointments",
                "booking deposit",
                "require deposit before booking",
            ],
            "service_providers": [
                "hairstylist no show",
                "tattoo artist deposit",
                "personal trainer cancellation",
                "photographer booking deposit",
                "lash tech no shows",
            ],
        },

        "hashtags": [
            "#noshow", "#bookingdeposit", "#hairstylistlife", "#smallbusinesstips",
            "#beautyindustry", "#serviceprovidertips", "#barbershop", "#lashtechlife",
            "#tattooartist", "#cancellationpolicy",
        ],

        "awareness_hooks": {
            "unaware": {
                "hook": "you lost $200 today because someone didn't show up",
                "goal": "emotional gut punch — normalize the problem",
                "cta": "save / tag a friend who needs this",
                "script": [
                    "you lost $200 today because someone didn't show up",
                    "and you probably didn't say anything because you didn't want to be rude",
                    "but your time is worth money",
                    "and there's a simple way to make sure people show up",
                ],
            },
            "problem_aware": {
                "hook": "no-shows are costing you more than you think",
                "goal": "agitate with math — monthly loss calculation",
                "cta": "comment NO SHOW if this is you",
                "script": [
                    "if you get 3 no-shows a week at $80 each",
                    "that's $960 a month you're just giving away",
                    "and it's not just money it's the time you blocked off",
                    "the fix isn't a cancellation policy nobody reads",
                    "the fix is getting money on the table before the appointment",
                ],
            },
            "solution_aware": {
                "hook": "the one change that dropped my no-shows to zero",
                "goal": "reveal the deposit link mechanism",
                "cta": "follow for the setup walkthrough",
                "script": [
                    "the one change that dropped my no-shows to zero",
                    "I started sending a deposit link before confirming",
                    "it takes 30 seconds to create and the client pays in one tap",
                    "when they have $25 on the line they show up",
                ],
            },
            "product_aware": {
                "hook": "this tool lets you collect deposits with a single link",
                "goal": "demo the flow — create link → client pays → confirmed",
                "cta": "create your first hold free",
                "script": [
                    "this tool lets you collect deposits with a single link",
                    "set your amount set your refund policy",
                    "send the link via text or DM",
                    "client pays in one tap — you get a confirmation",
                    "no app download no friction",
                ],
            },
            "most_aware": {
                "hook": "if you're still dealing with no-shows you're choosing to lose money",
                "goal": "direct close — social proof + urgency",
                "cta": "create your first hold — it's free",
                "script": [
                    "if you're still dealing with no-shows you're choosing to lose money",
                    "500 plus service providers already use this",
                    "average no-show rate drops from 25 percent to under 3 percent",
                    "create your first hold right now — it's free to start",
                ],
            },
        },

        "fate": {
            "familiarity": "You've been ghosted by a client before. We all have.",
            "authority": "Built by a service provider who was tired of losing money.",
            "trust": "Show: create link → send via DM → client pays → confirmation ping",
            "emotion": "Relief: 'I stopped losing $800/month and my schedule is full of people who actually show up.'",
        },
    },

    # ───────────────────────────────────────────────────────────
    # SnapMix — Snapchat-style track sharing for DJs/producers
    # ───────────────────────────────────────────────────────────
    "snapmix": {
        "name": "SnapMix",
        "tagline": "Share your mixes like stories — here today, gone tomorrow",
        "url": "snapmix.app",
        "cta": "Drop Your First Mix",

        "icp": [
            "DJs who want to share live sets without copyright takedowns",
            "Bedroom producers who want feedback before releasing",
            "Music curators who share playlists with their community",
            "Artists who want to tease unreleased tracks with a time limit",
        ],

        "jtbd": [
            "Share a DJ mix or unreleased track that auto-expires so I don't get DMCA'd",
            "Get real-time reactions from my audience on new music",
            "Build hype for releases with disappearing previews",
        ],

        "pains": [
            "SoundCloud / Mixcloud take down mixes for copyright",
            "can't share DJ sets anywhere without getting flagged",
            "unreleased tracks leak when shared permanently",
            "no good way to tease new music with urgency",
            "social media compresses audio quality",
        ],
        "objections": [
            "why not just use SoundCloud private links",
            "my audience won't download another app",
            "disappearing content is gimmicky",
            "I just DM tracks to people",
        ],

        "transformation": [
            "I drop a set every Friday and my audience shows up because it disappears Monday",
            "I preview unreleased tracks with zero leak risk",
            "My engagement doubled because urgency creates action",
        ],

        "mechanism": "Upload mix → set expiry timer → share link → listeners react in real-time → track auto-deletes",
        "mechanism_short": "drop → expire → repeat",

        "features": [
            "Upload any audio file — mixes, sets, unreleased tracks",
            "Set expiry: 24h, 48h, 1 week, or custom",
            "Shareable link — no app download needed for listeners",
            "Real-time reactions — listeners emoji-react as they listen",
            "Play count + listen-through rate analytics",
        ],

        "formats_preferred": ["behind-the-decks footage", "studio session clips", "countdown hype reels", "reaction videos"],
        "formats_avoid": ["corporate music industry content", "generic SaaS demos"],
        "brand_safety": ["no piracy encouragement", "respect artist rights", "underground culture tone"],

        "search_keywords": {
            "dj_sharing": [
                "how to share DJ mixes online",
                "DJ mix copyright",
                "share DJ set without takedown",
                "best platform for DJ mixes",
                "SoundCloud mix taken down",
            ],
            "music_preview": [
                "preview unreleased music",
                "tease new song",
                "share music privately",
                "send beats to clients",
                "music feedback platform",
            ],
            "music_community": [
                "DJ community app",
                "share mixes with friends",
                "underground music sharing",
                "producer collaboration",
            ],
        },

        "hashtags": [
            "#djlife", "#djmix", "#producerlife", "#unreleased", "#newmusic",
            "#beatmaker", "#musicproducer", "#djset", "#undergroundmusic",
            "#mixcloud", "#soundcloud",
        ],

        "awareness_hooks": {
            "unaware": {
                "hook": "the best DJ sets never make it online because of copyright",
                "goal": "call out the shared frustration",
                "cta": "save if you've ever had a mix taken down",
                "script": [
                    "the best DJ sets never make it online because of copyright",
                    "you spend hours mixing and one claim kills it",
                    "so the best mixes just live on a hard drive",
                    "that's about to change",
                ],
            },
            "problem_aware": {
                "hook": "SoundCloud just took down my best set — again",
                "goal": "agitate copyright pain, hint at solution",
                "cta": "comment if this has happened to you",
                "script": [
                    "SoundCloud just took down my best set again",
                    "2 hours of mixing gone because of one flagged track",
                    "private links still get caught",
                    "there has to be a better way to share mixes",
                ],
            },
            "solution_aware": {
                "hook": "what if your mixes disappeared before copyright bots found them",
                "goal": "introduce the ephemeral sharing concept",
                "cta": "follow for the drop",
                "script": [
                    "what if your mixes disappeared before copyright bots found them",
                    "drop a set — it's live for 48 hours then it's gone",
                    "your audience shows up because urgency creates action",
                    "no permanent link means no takedown",
                ],
            },
            "product_aware": {
                "hook": "this app lets you share mixes that self-destruct",
                "goal": "demo: upload → timer → share → reactions → poof",
                "cta": "drop your first mix free",
                "script": [
                    "this app lets you share mixes that self-destruct",
                    "upload any audio set a timer and share the link",
                    "listeners react in real time with emoji",
                    "when the timer hits zero — gone",
                    "drop your first mix right now",
                ],
            },
            "most_aware": {
                "hook": "DJs are already dropping exclusive sets on here every week",
                "goal": "social proof + FOMO",
                "cta": "drop your first mix — it's free",
                "script": [
                    "DJs are already dropping exclusive sets on here every week",
                    "the 48 hour window creates FOMO that drives real engagement",
                    "your listen-through rate will be higher than any platform",
                    "drop your first mix free",
                ],
            },
        },

        "fate": {
            "familiarity": "You've had a mix taken down. Everyone has.",
            "authority": "Built by a DJ who was tired of losing sets to copyright bots.",
            "trust": "Show: upload → set timer → share link → real-time reactions → auto-delete",
            "emotion": "Excitement: 'My audience actually shows up now because they know it won't last.'",
        },
    },
}


# ═══════════════════════════════════════════════════════════════
# 2. CONTENT TAGGER — classify posts by awareness stage, hook
#    type, pain point, CTA pattern
# ═══════════════════════════════════════════════════════════════

class ContentTagger:
    """Tags posts/ads with awareness stage, hook type, pain point, and CTA."""

    # Hook type classifiers
    HOOK_PATTERNS = {
        "question":       re.compile(r"^(why|what if|how|are you|do you|have you|is your|can you)", re.I),
        "personal_story": re.compile(r"^(i |we |my |i've |i'm |our )", re.I),
        "stat_number":    re.compile(r"\d+[\d,.]*\s*(%|x|hours?|minutes?|days?|months?|people|million)", re.I),
        "contrast":       re.compile(r"^(stop |don't |never |quit |forget |instead of)", re.I),
        "curiosity":      re.compile(r"(secret|truth|nobody|most people|hidden|surprising|you won't)", re.I),
        "command":        re.compile(r"^(do this|try this|use this|here's|start |get |download)", re.I),
        "social_proof":   re.compile(r"(\d+[\d,]*\+?\s*(people|users|clients|creators|businesses))", re.I),
        "emotional":      re.compile(r"(feel|felt|guilt|overwhelm|anxiety|lonely|miss |afraid|scared)", re.I),
    }

    # Pain point detectors (EverReach-specific + general)
    PAIN_SIGNALS = {
        "drift":           ["drift", "drifting", "growing apart", "lost touch", "fell off"],
        "guilt":           ["guilt", "guilty", "bad friend", "bad texter", "ghost", "ghosting"],
        "overwhelm":       ["overwhelm", "too busy", "no time", "forget to", "ADHD"],
        "awkward_silence":  ["awkward", "don't know what to say", "brain goes blank", "overthink"],
        "no_system":       ["no system", "from memory", "need a system", "need a method", "no process"],
        "missed_opportunity": ["missed", "opportunity", "pipeline", "follow up", "lead", "prospect"],
    }

    # CTA pattern detectors
    CTA_PATTERNS = {
        "download":   re.compile(r"(download|get the app|install|app store|google play)", re.I),
        "trial":      re.compile(r"(free trial|try free|start trial|try it free)", re.I),
        "link_bio":   re.compile(r"(link in bio|link in profile|click link)", re.I),
        "comment":    re.compile(r"(comment|drop a|type .{1,20} below)", re.I),
        "save_share": re.compile(r"(save this|share this|bookmark)", re.I),
        "follow":     re.compile(r"(follow for|follow me|follow us)", re.I),
        "learn_more": re.compile(r"(learn more|find out|discover)", re.I),
        "sign_up":    re.compile(r"(sign up|subscribe|join|register)", re.I),
    }

    def tag(self, post: dict, offer_spec: dict) -> dict:
        """Tag a single post with awareness stage, hook type, pain points, CTA, fit score."""
        text = (post.get("ad_text") or post.get("text_content") or post.get("caption") or "").strip()
        hook_line = text.split("\n")[0].strip() if text else ""

        tags = {
            "hook_type": self._classify_hook(hook_line),
            "hook_line": hook_line[:120],
            "awareness_stage": self._detect_awareness_stage(text, offer_spec),
            "pain_points": self._detect_pains(text),
            "cta_type": self._detect_cta(text),
            "content_type": self._detect_content_type(post),
            "word_count": len(text.split()),
            "has_emoji": bool(re.search(r"[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF]", text)),
            "fit_score": self._compute_fit_score(text, offer_spec),
        }
        return tags

    def _classify_hook(self, hook: str) -> str:
        if not hook:
            return "unknown"
        for hook_type, pattern in self.HOOK_PATTERNS.items():
            if pattern.search(hook):
                return hook_type
        return "statement"

    def _detect_awareness_stage(self, text: str, offer_spec: dict) -> str:
        """Classify which Schwartz stage this content targets."""
        text_lower = text.lower()
        product_name = offer_spec.get("name", "").lower()

        # Stage 5: Most aware — mentions product + objections
        objection_words = ["cancel", "no pressure", "not spammy", "free trial", "risk-free"]
        if product_name in text_lower and any(w in text_lower for w in objection_words):
            return "most_aware"

        # Stage 4: Product aware — mentions product + features/demo
        feature_words = ["feature", "how it works", "screen", "demo", "warmth score", "reminder"]
        if product_name in text_lower and any(w in text_lower for w in feature_words):
            return "product_aware"

        # Stage 3: Solution aware — mentions mechanism/system
        mechanism_words = ["system", "method", "rhythm", "routine", "framework", "process", "crm", "tracker", "app"]
        solution_count = sum(1 for w in mechanism_words if w in text_lower)
        if solution_count >= 2:
            return "solution_aware"

        # Stage 2: Problem aware — names the pain explicitly
        pain_words = ["drift", "ghost", "overwhelm", "forget", "awkward", "guilt", "busy", "losing touch", "no system"]
        pain_count = sum(1 for w in pain_words if w in text_lower)
        if pain_count >= 2:
            return "problem_aware"

        # Stage 1: Unaware — emotional/truth content, no product/solution
        emotion_words = ["feel", "care", "love", "friend", "relationship", "human", "connect", "life"]
        emotion_count = sum(1 for w in emotion_words if w in text_lower)
        if emotion_count >= 2 and solution_count == 0:
            return "unaware"

        return "unclassified"

    def _detect_pains(self, text: str) -> List[str]:
        text_lower = text.lower()
        detected = []
        for pain_name, signals in self.PAIN_SIGNALS.items():
            if any(s in text_lower for s in signals):
                detected.append(pain_name)
        return detected

    def _detect_cta(self, text: str) -> str:
        for cta_type, pattern in self.CTA_PATTERNS.items():
            if pattern.search(text):
                return cta_type
        return "none"

    def _detect_content_type(self, post: dict) -> str:
        if post.get("has_video"):
            return "video"
        if post.get("has_image"):
            return "image"
        return "text"

    def _compute_fit_score(self, text: str, offer_spec: dict) -> float:
        """0.0–1.0 score for how well this post matches the offer's ICP/pains/jtbd."""
        if not text:
            return 0.0

        text_lower = text.lower()
        score = 0.0
        max_score = 0.0

        # Pain match
        for pain in offer_spec.get("pains", []):
            max_score += 1.0
            pain_words = [w for w in pain.lower().split() if len(w) > 3]
            if any(w in text_lower for w in pain_words):
                score += 1.0

        # JTBD match
        for jtbd in offer_spec.get("jtbd", []):
            max_score += 0.5
            jtbd_words = [w for w in jtbd.lower().split() if len(w) > 3]
            if sum(1 for w in jtbd_words if w in text_lower) >= 2:
                score += 0.5

        # Keyword match
        for category, keywords in offer_spec.get("search_keywords", {}).items():
            for kw in keywords:
                max_score += 0.3
                if kw.lower() in text_lower:
                    score += 0.3

        # Transformation match
        for t in offer_spec.get("transformation", []):
            max_score += 0.5
            t_words = [w for w in t.lower().split() if len(w) > 3]
            if sum(1 for w in t_words if w in text_lower) >= 2:
                score += 0.5

        return round(score / max(max_score, 1.0), 3)


# ═══════════════════════════════════════════════════════════════
# 3. MULTI-OBJECTIVE RANKING ENGINE
# ═══════════════════════════════════════════════════════════════

class RankingEngine:
    """Multi-objective scorer: FitScore, PerformanceScore, FormatScore, RepeatabilityScore."""

    def __init__(self, weights: dict = None):
        self.weights = weights or {
            "fit": 0.35,
            "performance": 0.25,
            "format": 0.15,
            "repeatability": 0.15,
            "risk": -0.10,
        }

    def score(self, post: dict, tags: dict, offer_spec: dict) -> dict:
        """Score a post on multiple objectives. Returns component scores + total."""
        fit = tags.get("fit_score", 0.0)
        performance = self._performance_score(post)
        format_score = self._format_score(post, tags, offer_spec)
        repeatability = self._repeatability_score(post, tags)
        risk = self._risk_score(post, tags, offer_spec)

        total = (
            self.weights["fit"] * fit +
            self.weights["performance"] * performance +
            self.weights["format"] * format_score +
            self.weights["repeatability"] * repeatability +
            self.weights["risk"] * risk
        )

        confidence = self._confidence(post, tags)
        reuse_style = self._reuse_style(fit, repeatability, risk, post)
        why = self._why_it_ranked(fit, performance, format_score, repeatability, risk, tags, post)

        return {
            "fit_score": round(fit, 3),
            "performance_score": round(performance, 3),
            "format_score": round(format_score, 3),
            "repeatability_score": round(repeatability, 3),
            "risk_score": round(risk, 3),
            "total_score": round(max(total, 0.0), 3),
            "confidence": confidence,
            "reuse_style": reuse_style,
            "why_it_ranked": why,
        }

    def _performance_score(self, post: dict) -> float:
        """Engagement proxy from available signals."""
        reactions = post.get("reactions") or post.get("likes") or 0
        comments = post.get("comments") or 0
        shares = post.get("shares") or 0
        views = post.get("views") or 0

        # For Ad Library posts we don't have engagement, but we have longevity
        started = post.get("started_running") or post.get("posted_at") or ""
        longevity_bonus = 0.0
        if started:
            try:
                from dateutil.parser import parse as parse_date
                start_date = parse_date(started)
                days_running = (datetime.now() - start_date).days
                if days_running > 90:
                    longevity_bonus = 0.3
                elif days_running > 30:
                    longevity_bonus = 0.2
                elif days_running > 7:
                    longevity_bonus = 0.1
            except Exception:
                pass

        # Engagement score (normalized)
        eng = reactions + comments * 2 + shares * 3
        if eng > 10000:
            eng_score = 1.0
        elif eng > 1000:
            eng_score = 0.7
        elif eng > 100:
            eng_score = 0.4
        elif eng > 0:
            eng_score = 0.2
        else:
            eng_score = longevity_bonus  # Ad Library fallback

        return min(eng_score, 1.0)

    def _format_score(self, post: dict, tags: dict, offer_spec: dict) -> float:
        """Does format match offer's preferred production constraints?"""
        preferred = [f.lower() for f in offer_spec.get("formats_preferred", [])]
        content_type = tags.get("content_type", "text")

        score = 0.3  # baseline
        if content_type == "video" and any("video" in p for p in preferred):
            score += 0.4
        if content_type == "image" and any("carousel" in p or "image" in p for p in preferred):
            score += 0.3
        if tags.get("word_count", 0) > 20:
            score += 0.1  # has substantial copy to learn from
        if tags.get("has_emoji"):
            score += 0.1

        return min(score, 1.0)

    def _repeatability_score(self, post: dict, tags: dict) -> float:
        """Can we recreate this as a template consistently?"""
        score = 0.3

        hook_type = tags.get("hook_type", "unknown")
        if hook_type in ("question", "personal_story", "contrast", "command"):
            score += 0.3  # these are highly templatable
        if hook_type in ("emotional", "curiosity"):
            score += 0.2

        # Longer captions = more reusable structure
        wc = tags.get("word_count", 0)
        if 20 < wc < 200:
            score += 0.2
        elif wc >= 200:
            score += 0.1

        # Has CTA = production-ready format
        if tags.get("cta_type") and tags["cta_type"] != "none":
            score += 0.2

        return min(score, 1.0)

    def _risk_score(self, post: dict, tags: dict, offer_spec: dict) -> float:
        """Higher = riskier. Checks brand safety, competitor mentions."""
        text = (post.get("ad_text") or post.get("text_content") or "").lower()
        risk = 0.0

        # Brand safety violations
        for rule in offer_spec.get("brand_safety", []):
            # Extract key phrase from rule
            phrases = [w for w in rule.lower().split() if len(w) > 3]
            if any(p in text for p in phrases):
                risk += 0.3

        # Competitor brand name in text (can't clone directly)
        advertiser = (post.get("advertiser_name") or "").lower()
        if advertiser and advertiser in text:
            risk += 0.2

        return min(risk, 1.0)

    def _confidence(self, post: dict, tags: dict) -> float:
        """How trustworthy is this ranking? Composite of data completeness + metric reliability + fit strength."""
        score = 0.1  # base

        # Data completeness (do we have text, author, engagement?)
        if post.get("ad_text") or post.get("text_content"):
            score += 0.15
        if post.get("advertiser_name") or post.get("author_name"):
            score += 0.1
        if post.get("reactions") or post.get("likes") or post.get("shares"):
            score += 0.15  # has real engagement data
        if post.get("url") or post.get("permalink"):
            score += 0.05

        # Metric reliability (organic > ad library for engagement)
        source = post.get("_source", "")
        if source == "facebook_organic":
            score += 0.15  # real engagement numbers
        elif source == "instagram":
            score += 0.1
        elif source == "meta_ad_library":
            score += 0.05  # no engagement, just longevity

        # Fit strength
        fit = tags.get("fit_score", 0)
        if fit > 0.2:
            score += 0.15
        elif fit > 0.1:
            score += 0.1
        elif fit > 0:
            score += 0.05

        # Classification quality
        if tags.get("awareness_stage") != "unclassified":
            score += 0.1

        return min(round(score, 2), 1.0)

    def _reuse_style(self, fit: float, repeatability: float, risk: float, post: dict) -> str:
        """Recommend how to reuse this creative: structure_remix / angle_clone / not_recommended."""
        source = post.get("_source", "")

        # High risk = not recommended
        if risk > 0.5:
            return "not_recommended"

        # Very distinctive / branded content
        advertiser = (post.get("advertiser_name") or post.get("author_name") or "").strip()
        text = (post.get("ad_text") or post.get("text_content") or "")
        if advertiser and advertiser.lower() in text.lower() and len(advertiser) > 3:
            if repeatability < 0.4:
                return "not_recommended"

        # High fit + high repeatability = angle clone (same angle, new surface)
        if fit > 0.15 and repeatability > 0.5:
            return "angle_clone"

        # Decent fit + any repeatability = structure remix (same skeleton, different topic)
        if fit > 0.05 and repeatability > 0.3:
            return "structure_remix"

        # Low fit but high performance = structure remix only
        if repeatability > 0.5:
            return "structure_remix"

        return "reference_only"

    def _why_it_ranked(self, fit: float, performance: float, format_score: float,
                       repeatability: float, risk: float, tags: dict, post: dict) -> str:
        """Human-readable explanation of why this post scored well."""
        reasons = []

        # Fit reasons
        if fit > 0.2:
            pains = tags.get("pain_points", [])
            pain_str = f" ({', '.join(pains[:2])})" if pains else ""
            reasons.append(f"Strong offer fit{pain_str}")
        elif fit > 0.1:
            reasons.append("Moderate offer fit")

        # Performance reasons
        reactions = post.get("reactions") or post.get("likes") or 0
        shares = post.get("shares") or 0
        comments = post.get("comments") or 0
        if shares > 1000:
            reasons.append(f"Viral shares ({shares:,})")
        elif shares > 100:
            reasons.append(f"High shares ({shares:,})")
        if comments > 100:
            reasons.append(f"High engagement ({comments:,} comments)")
        if performance > 0.5 and not reasons:
            reasons.append("Strong engagement signals")

        # Awareness stage
        stage = tags.get("awareness_stage", "unclassified")
        if stage != "unclassified":
            reasons.append(f"{stage.replace('_', ' ').title()} stage content")

        # Hook type
        hook_type = tags.get("hook_type", "unknown")
        if hook_type not in ("unknown",):
            reasons.append(f"{hook_type.replace('_', ' ').title()} hook")

        # Format match
        if format_score > 0.6:
            ct = tags.get("content_type", "text")
            reasons.append(f"Good format ({ct})")

        # Repeatability
        if repeatability > 0.6:
            reasons.append("Highly templatable")

        # Risk flag
        if risk > 0.3:
            reasons.append("⚠️ Some brand safety flags")

        # Source context
        source = post.get("_source", "unknown")
        if source == "facebook_organic":
            reasons.append("FB organic discovery")
        elif source == "instagram":
            reasons.append("IG hashtag discovery")
        elif source == "meta_ad_library":
            reasons.append("Active ad (Ad Library)")

        if not reasons:
            return "Low signal — reference only"

        return " + ".join(reasons[:5])


# ═══════════════════════════════════════════════════════════════
# 4. PATTERN MINER — extract reusable primitives
# ═══════════════════════════════════════════════════════════════

class PatternMiner:
    """Extracts reusable hook templates, proof styles, CTA patterns from ranked posts."""

    def mine(self, scored_posts: List[dict], top_n: int = 30) -> dict:
        """Extract creative primitives from top-ranked posts."""
        top = sorted(scored_posts, key=lambda p: p.get("scores", {}).get("total_score", 0), reverse=True)[:top_n]

        if not top:
            return {}

        patterns = {
            "total_analyzed": len(top),
            "hook_templates": self._extract_hook_templates(top),
            "hook_type_distribution": self._hook_type_dist(top),
            "awareness_stage_distribution": self._awareness_dist(top),
            "pain_point_frequency": self._pain_frequency(top),
            "cta_distribution": self._cta_dist(top),
            "format_distribution": self._format_dist(top),
            "top_advertisers": self._top_advertisers(top),
            "avg_word_count": self._avg_word_count(top),
            "scroll_stoppers": self._extract_scroll_stoppers(top),
            "proof_styles": self._extract_proof_styles(top),
        }
        return patterns

    def _extract_hook_templates(self, posts: List[dict]) -> List[dict]:
        hooks = []
        seen = set()
        for p in posts:
            tags = p.get("tags", {})
            hook = tags.get("hook_line", "")
            if hook and hook not in seen and len(hook) > 15:
                seen.add(hook)
                hooks.append({
                    "hook": hook,
                    "type": tags.get("hook_type", "?"),
                    "stage": tags.get("awareness_stage", "?"),
                    "fit": tags.get("fit_score", 0),
                    "advertiser": p.get("advertiser_name", ""),
                })
        return hooks[:20]

    def _hook_type_dist(self, posts: List[dict]) -> Dict[str, int]:
        c = Counter(p.get("tags", {}).get("hook_type", "?") for p in posts)
        return dict(c.most_common(10))

    def _awareness_dist(self, posts: List[dict]) -> Dict[str, int]:
        c = Counter(p.get("tags", {}).get("awareness_stage", "?") for p in posts)
        return dict(c.most_common(10))

    def _pain_frequency(self, posts: List[dict]) -> Dict[str, int]:
        c: Counter = Counter()
        for p in posts:
            for pain in p.get("tags", {}).get("pain_points", []):
                c[pain] += 1
        return dict(c.most_common(10))

    def _cta_dist(self, posts: List[dict]) -> Dict[str, int]:
        c = Counter(p.get("tags", {}).get("cta_type", "?") for p in posts)
        return dict(c.most_common(10))

    def _format_dist(self, posts: List[dict]) -> Dict[str, int]:
        c = Counter(p.get("tags", {}).get("content_type", "?") for p in posts)
        return dict(c.most_common(5))

    def _top_advertisers(self, posts: List[dict]) -> List[Tuple[str, int]]:
        c = Counter(p.get("advertiser_name", "?") for p in posts if p.get("advertiser_name"))
        return c.most_common(10)

    def _avg_word_count(self, posts: List[dict]) -> int:
        wcs = [p.get("tags", {}).get("word_count", 0) for p in posts]
        return int(sum(wcs) / max(len(wcs), 1))

    def _extract_scroll_stoppers(self, posts: List[dict]) -> List[str]:
        """Extract the most compelling opening lines."""
        stoppers = []
        for p in posts:
            tags = p.get("tags", {})
            hook = tags.get("hook_line", "")
            fit = tags.get("fit_score", 0)
            if hook and fit >= 0.1 and len(hook) > 15:
                stoppers.append(hook)
        return stoppers[:15]

    def _extract_proof_styles(self, posts: List[dict]) -> Dict[str, int]:
        """What proof methods do top posts use?"""
        styles: Counter = Counter()
        for p in posts:
            text = (p.get("ad_text") or p.get("text_content") or "").lower()
            if re.search(r"screen|demo|recording|walkthrough", text):
                styles["screen_recording"] += 1
            if re.search(r"testimonial|review|said|told me", text):
                styles["testimonial"] += 1
            if re.search(r"\d+[\d,]*\s*(people|users|downloads|installs|clients)", text):
                styles["social_proof_number"] += 1
            if re.search(r"before.*after|transformation|result", text):
                styles["before_after"] += 1
            if re.search(r"step \d|how to|tutorial|guide", text):
                styles["tutorial"] += 1
        return dict(styles.most_common(5))


# ═══════════════════════════════════════════════════════════════
# 5. CREATIVE RADAR — the main orchestrator
# ═══════════════════════════════════════════════════════════════

class CreativeRadar:
    """Orchestrates the full creative research pipeline for an offer."""

    def __init__(self, offer_key: str):
        if offer_key not in OFFER_SPECS:
            raise ValueError(f"Unknown offer: {offer_key}. Available: {list(OFFER_SPECS.keys())}")
        self.offer_key = offer_key
        self.spec = OFFER_SPECS[offer_key]
        self.tagger = ContentTagger()
        self.ranker = RankingEngine()
        self.miner = PatternMiner()
        self.output_dir = RESEARCH_BASE / "creative-radar" / offer_key
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def discover(self, max_ads: int = 30, download_top: int = 3,
                 skip_ad_library: bool = False, skip_facebook: bool = False,
                 skip_instagram: bool = False):
        """Run all discovery connectors: Ad Library + FB organic + IG hashtags."""
        results = {}

        # ── Connector A: Meta Ad Library (public, no login) ──
        if not skip_ad_library:
            from market_research.meta_ad_library import MetaAdLibraryScraper
            all_keywords = []
            for category, keywords in self.spec.get("search_keywords", {}).items():
                all_keywords.extend(keywords[:3])
            tool_keywords = self.spec["search_keywords"].get("tools_systems", [])
            all_keywords.extend(tool_keywords)
            seen = set()
            unique = [kw for kw in all_keywords if kw.lower() not in seen and not seen.add(kw.lower())]
            logger.info(f"📚 Ad Library: {len(unique)} keywords for {self.spec['name']}")
            scraper = MetaAdLibraryScraper()
            results["ad_library"] = scraper.batch_search(
                keywords=unique, max_per_keyword=max_ads,
                download_top=download_top, active_only=True, country="US",
            )

        # ── Connector B: Facebook organic search (requires Safari login) ──
        if not skip_facebook:
            try:
                from market_research.facebook_scraper import FacebookResearchScraper
                fb = FacebookResearchScraper(delay_between_actions=3.0, max_scrolls=15)
                fb_keywords = []
                for cat, kws in self.spec.get("search_keywords", {}).items():
                    if cat != "tools_systems":  # tools keywords are Ad Library only
                        fb_keywords.extend(kws[:2])  # top 2 per category for FB
                seen_fb = set()
                fb_unique = [kw for kw in fb_keywords if kw.lower() not in seen_fb and not seen_fb.add(kw.lower())]
                logger.info(f"📱 Facebook: {len(fb_unique)} keywords for {self.spec['name']}")
                results["facebook"] = fb.batch_search(
                    keywords=fb_unique, search_type="posts",
                    max_per_keyword=15, download_top=download_top,
                )
            except Exception as e:
                logger.warning(f"Facebook scrape failed: {e}")

        # ── Connector C: Instagram hashtag search (requires Safari login) ──
        if not skip_instagram:
            try:
                from market_research.instagram_scraper import InstagramResearchScraper
                ig = InstagramResearchScraper(delay=3.0, max_scrolls=10)
                ig_tags = [h.lstrip("#") for h in self.spec.get("hashtags", [])[:8]]
                logger.info(f"📸 Instagram: {len(ig_tags)} hashtags for {self.spec['name']}")
                results["instagram"] = ig.batch_search(
                    keywords=ig_tags, search_type="hashtag",
                    max_per_keyword=20, download_top=download_top,
                )
            except Exception as e:
                logger.warning(f"Instagram scrape failed: {e}")

        logger.info(f"✅ Discovery complete: {', '.join(f'{k}: done' for k in results)}")
        return results

    def load_all_posts(self) -> List[dict]:
        """Load ALL data: Ad Library ads + Facebook organic + Instagram posts."""
        ad_posts = self._load_ad_library_posts()
        fb_posts = self._load_organic_posts()
        ig_posts = self._load_instagram_posts()

        all_posts = ad_posts + fb_posts + ig_posts

        # Deduplicate by id
        seen_ids = set()
        unique = []
        for p in all_posts:
            pid = p.get("ad_id") or p.get("id") or id(p)
            if pid not in seen_ids:
                seen_ids.add(pid)
                unique.append(p)

        logger.info(f"📦 Total: {len(unique)} posts ({len(ad_posts)} ad library + {len(fb_posts)} FB organic + {len(ig_posts)} IG)")
        return unique

    def _load_ad_library_posts(self) -> List[dict]:
        """Load Ad Library data across all keywords for this offer."""
        posts = []
        ad_lib_dir = RESEARCH_BASE / "meta-ad-library" / "ads"
        if not ad_lib_dir.exists():
            return posts

        all_keywords = []
        for kws in self.spec.get("search_keywords", {}).values():
            all_keywords.extend(kws)

        loaded_dirs = set()
        for kw in all_keywords:
            slug = kw.lower().replace(" ", "-")
            kw_dir = ad_lib_dir / slug
            if kw_dir.exists() and str(kw_dir) not in loaded_dirs:
                loaded_dirs.add(str(kw_dir))
                ads_file = kw_dir / "ads.json"
                if ads_file.exists():
                    try:
                        ads = json.load(open(ads_file))
                        for ad in ads:
                            ad["_source_keyword"] = kw
                            ad["_source"] = "meta_ad_library"
                        posts.extend(ads)
                    except Exception as e:
                        logger.warning(f"Failed to load {ads_file}: {e}")

        logger.info(f"  📚 Ad Library: {len(posts)} ads from {len(loaded_dirs)} keyword dirs")
        return posts

    def _load_organic_posts(self) -> List[dict]:
        """Load Facebook organic posts from ranked.json / posts.json files."""
        posts = []
        fb_dir = RESEARCH_BASE / "facebook" / "posts"
        if not fb_dir.exists():
            return posts

        # Flatten search keywords to slugs
        all_slugs = set()
        for kws in self.spec.get("search_keywords", {}).values():
            for kw in kws:
                all_slugs.add(kw.lower().replace(" ", "-"))

        # Also scan ALL fb keyword dirs (organic searches may use different phrasing)
        loaded_dirs = set()
        for kw_dir in sorted(fb_dir.iterdir()):
            if not kw_dir.is_dir():
                continue
            # Load if slug matches our keywords OR if it's any FB search result
            slug = kw_dir.name
            data_file = kw_dir / "ranked.json"
            if not data_file.exists():
                data_file = kw_dir / "posts.json"
            if not data_file.exists():
                continue

            loaded_dirs.add(slug)
            try:
                raw_posts = json.load(open(data_file))
                for p in raw_posts:
                    # Normalize to common format
                    p["_source"] = "facebook_organic"
                    p["_source_keyword"] = slug.replace("-", " ")
                    # Map fields for tagger compatibility
                    if "text_content" not in p and "caption" in p:
                        p["text_content"] = p["caption"]
                    if "ad_text" not in p and "text_content" in p:
                        p["ad_text"] = p["text_content"]
                posts.extend(raw_posts)
            except Exception as e:
                logger.warning(f"Failed to load {data_file}: {e}")

        logger.info(f"  📱 Organic FB: {len(posts)} posts from {len(loaded_dirs)} keyword dirs")
        return posts

    def _load_instagram_posts(self) -> List[dict]:
        """Load Instagram hashtag posts from posts.json / ranked.json files."""
        posts = []
        ig_dir = RESEARCH_BASE / "instagram" / "posts"
        if not ig_dir.exists():
            return posts

        loaded_dirs = set()
        for kw_dir in sorted(ig_dir.iterdir()):
            if not kw_dir.is_dir():
                continue
            data_file = kw_dir / "ranked.json"
            if not data_file.exists():
                data_file = kw_dir / "posts.json"
            if not data_file.exists():
                continue

            loaded_dirs.add(kw_dir.name)
            try:
                raw_posts = json.load(open(data_file))
                for p in raw_posts:
                    p["_source"] = "instagram"
                    p["_source_keyword"] = kw_dir.name
                    # Normalize fields for tagger
                    if "text_content" not in p:
                        p["text_content"] = p.get("caption") or p.get("alt_text") or ""
                    if "ad_text" not in p:
                        p["ad_text"] = p.get("text_content", "")
                    if "reactions" not in p:
                        p["reactions"] = p.get("likes", 0)
                posts.extend(raw_posts)
            except Exception as e:
                logger.warning(f"Failed to load {data_file}: {e}")

        logger.info(f"  📸 Instagram: {len(posts)} posts from {len(loaded_dirs)} hashtag dirs")
        return posts

    def tag_and_rank(self, posts: List[dict] = None) -> List[dict]:
        """Tag all posts and compute multi-objective scores."""
        if posts is None:
            posts = self.load_all_posts()

        scored = []
        for post in posts:
            tags = self.tagger.tag(post, self.spec)
            scores = self.ranker.score(post, tags, self.spec)
            post["tags"] = tags
            post["scores"] = scores
            scored.append(post)

        # Sort by total score
        scored.sort(key=lambda p: p["scores"]["total_score"], reverse=True)

        # Save
        out_file = self.output_dir / "scored_posts.json"
        with open(out_file, "w") as f:
            json.dump(scored, f, indent=2, default=str)
        logger.info(f"✅ Tagged & ranked {len(scored)} posts → {out_file}")

        return scored

    def mine_patterns(self, scored_posts: List[dict] = None) -> dict:
        """Extract reusable creative primitives from ranked posts."""
        if scored_posts is None:
            f = self.output_dir / "scored_posts.json"
            if f.exists():
                scored_posts = json.load(open(f))
            else:
                scored_posts = self.tag_and_rank()

        patterns = self.miner.mine(scored_posts)

        out_file = self.output_dir / "patterns.json"
        with open(out_file, "w") as f:
            json.dump(patterns, f, indent=2, default=str)
        logger.info(f"✅ Mined {patterns.get('total_analyzed', 0)} posts → {out_file}")

        return patterns

    def generate_briefs(self, patterns: dict = None) -> dict:
        """Generate awareness-stage briefs with hooks, scripts, and shot lists."""
        if patterns is None:
            f = self.output_dir / "patterns.json"
            if f.exists():
                patterns = json.load(open(f))
            else:
                patterns = self.mine_patterns()

        briefs = {}
        for stage, stage_data in self.spec.get("awareness_hooks", {}).items():
            brief = {
                "stage": stage,
                "goal": stage_data.get("goal", ""),
                "primary_hook": stage_data.get("hook", ""),
                "script_beats": stage_data.get("script", []),
                "cta": stage_data.get("cta", ""),
                "competitor_hooks": [],
                "recommended_format": "",
                "generated_at": datetime.now().isoformat(),
            }

            # Pull competitor hooks that match this awareness stage
            for hook_data in patterns.get("hook_templates", []):
                if hook_data.get("stage") == stage:
                    brief["competitor_hooks"].append(hook_data["hook"])

            # Recommend format based on stage
            if stage in ("unaware", "problem_aware"):
                brief["recommended_format"] = "UGC founder-to-camera reel (15s)"
            elif stage == "solution_aware":
                brief["recommended_format"] = "Screen recording + face cam hybrid (25s)"
            elif stage == "product_aware":
                brief["recommended_format"] = "Screen recording demo, 3 features (30s)"
            else:
                brief["recommended_format"] = "Direct-to-camera objection killer (30s)"

            briefs[stage] = brief

        # Save
        out_file = self.output_dir / "awareness_briefs.json"
        with open(out_file, "w") as f:
            json.dump(briefs, f, indent=2, default=str)
        logger.info(f"✅ Generated {len(briefs)} awareness-stage briefs → {out_file}")

        return briefs

    def report(self, scored_posts: List[dict] = None, patterns: dict = None, briefs: dict = None):
        """Print the full Creative Radar report to terminal."""
        if scored_posts is None:
            f = self.output_dir / "scored_posts.json"
            scored_posts = json.load(open(f)) if f.exists() else []
        if patterns is None:
            f = self.output_dir / "patterns.json"
            patterns = json.load(open(f)) if f.exists() else {}
        if briefs is None:
            f = self.output_dir / "awareness_briefs.json"
            briefs = json.load(open(f)) if f.exists() else {}

        B = "\033[1m"
        R = "\033[0m"
        C = "\033[96m"
        Y = "\033[93m"
        G = "\033[92m"
        D = "\033[2m"
        M = "\033[95m"

        hr = f"{C}{'═' * 70}{R}"
        print(hr)
        print(f"{C}{B}  🎯 CREATIVE RADAR: {self.spec['name']}{R}")
        print(f"{C}  {self.spec['tagline']}{R}")
        print(hr)

        # Overview
        print(f"\n{Y}{B}── Overview ──{R}")
        print(f"  Posts analyzed:  {len(scored_posts)}")
        print(f"  Avg fit score:   {sum(p.get('scores',{}).get('fit_score',0) for p in scored_posts)/max(len(scored_posts),1):.2f}")
        top_5 = scored_posts[:5]
        if top_5:
            avg_total = sum(p.get("scores", {}).get("total_score", 0) for p in top_5) / len(top_5)
            print(f"  Top-5 avg score: {avg_total:.3f}")

        # Awareness stage distribution
        if patterns.get("awareness_stage_distribution"):
            print(f"\n{Y}{B}── Awareness Stage Distribution ──{R}")
            for stage, count in patterns["awareness_stage_distribution"].items():
                bar = "█" * min(count, 30)
                print(f"  {stage:<18} {bar} {count}")

        # Top ranked posts with full scoring
        if scored_posts:
            print(f"\n{Y}{B}── Top Ranked Posts (with confidence + reuse style) ──{R}")
            for i, p in enumerate(scored_posts[:12]):
                scores = p.get("scores", {})
                tags = p.get("tags", {})
                author = p.get("author_name") or p.get("advertiser_name") or "?"
                text = (p.get("text_content") or p.get("ad_text") or "")[:90]
                source = p.get("_source", "?")
                conf = scores.get("confidence", 0)
                reuse = scores.get("reuse_style", "?")
                why = scores.get("why_it_ranked", "")
                total = scores.get("total_score", 0)

                # Color-code reuse style
                reuse_color = G if reuse == "angle_clone" else Y if reuse == "structure_remix" else D
                conf_bar = "●" * int(conf * 5) + "○" * (5 - int(conf * 5))

                print(f"\n  {B}#{i+1}{R} {Y}{author}{R}  {D}[{source}]{R}  score={total:.3f}  conf={conf_bar}")
                print(f"  {reuse_color}  Reuse: {reuse.replace('_', ' ').upper()}{R}")
                print(f"    {D}Why: {why}{R}")
                print(f"    {M}→ {text}{R}")

        # Top hooks
        hooks = patterns.get("hook_templates", [])
        if hooks:
            print(f"\n{Y}{B}── Top Competitor Hooks (by fit) ──{R}")
            for h in sorted(hooks, key=lambda x: x.get("fit", 0), reverse=True)[:10]:
                stage = h.get("stage", "?")
                fit = h.get("fit", 0)
                adv = h.get("advertiser", "")
                print(f"\n  {G}[{stage}]{R} {D}fit={fit:.2f} by {adv}{R}")
                print(f"  {Y}→ {h['hook'][:100]}{R}")

        # Pain point frequency
        if patterns.get("pain_point_frequency"):
            print(f"\n{Y}{B}── Pain Points Detected ──{R}")
            for pain, count in patterns["pain_point_frequency"].items():
                bar = "█" * min(count, 20)
                print(f"  {pain:<22} {bar} {count}")

        # Scroll stoppers
        stoppers = patterns.get("scroll_stoppers", [])
        if stoppers:
            print(f"\n{Y}{B}── Scroll Stoppers (highest fit) ──{R}")
            for s in stoppers[:8]:
                print(f"  {M}→ {s[:100]}{R}")

        # Awareness-stage briefs
        if briefs:
            print(f"\n{Y}{B}── Awareness-Stage Briefs ──{R}")
            for stage_name, brief in briefs.items():
                print(f"\n  {G}{B}STAGE: {stage_name.upper()}{R}")
                print(f"  Hook:   {Y}{brief.get('primary_hook', '?')}{R}")
                print(f"  Format: {brief.get('recommended_format', '?')}")
                print(f"  CTA:    {brief.get('cta', '?')}")
                comp_hooks = brief.get("competitor_hooks", [])[:3]
                if comp_hooks:
                    print(f"  Competitor hooks at this stage:")
                    for ch in comp_hooks:
                        print(f"    {D}→ {ch[:90]}{R}")

        # FATE check
        fate = self.spec.get("fate", {})
        if fate:
            print(f"\n{Y}{B}── FATE Framework ──{R}")
            for key, val in fate.items():
                print(f"  {B}{key.upper():<13}{R} {val}")

        print(f"\n{hr}")
        print(f"  {D}Data at: {self.output_dir}{R}")
        print(hr)

    # ── Safari-based media downloader for top posts ──

    def download_top_media(self, top_n: int = 25, skip_existing: bool = True):
        """
        Download images + videos for top-ranked posts via Safari automation.

        For FB organic posts: navigate to author page or post URL → extract scontent media
        For IG posts: navigate to post page → extract images/videos
        For Ad Library: media already downloaded during scrape
        """
        import subprocess as _sp
        import requests as _req

        media_dir = self.output_dir / "media"
        media_dir.mkdir(parents=True, exist_ok=True)

        scored_file = self.output_dir / "scored_posts.json"
        if not scored_file.exists():
            logger.error("No scored_posts.json — run tag_and_rank first")
            return

        scored = json.load(open(scored_file))[:top_n]
        logger.info(f"📥 Downloading media for top {len(scored)} posts → {media_dir}")

        downloaded_count = 0
        skipped = 0

        for i, post in enumerate(scored):
            post_id = post.get("id") or post.get("ad_id") or f"post_{i}"
            source = post.get("_source", "unknown")
            author = (post.get("author_name") or post.get("advertiser_name") or "unknown")[:30]
            score = post.get("scores", {}).get("total_score", 0)

            # Check if we already have media for this post
            existing = list(media_dir.glob(f"{post_id}*"))
            if skip_existing and existing:
                skipped += 1
                continue

            logger.info(f"  [{i+1}/{len(scored)}] {author} ({source}) score={score:.3f}")

            media_urls = []

            # Try existing media_urls first
            if post.get("media_urls"):
                media_urls = post["media_urls"]

            # For FB organic: navigate to post/author page via Safari and extract media
            if not media_urls and source == "facebook_organic":
                url = post.get("url") or ""
                author_url = post.get("author_url") or ""
                target = url if url and "/photo" not in url else author_url
                if target:
                    media_urls = self._safari_extract_media(target, "facebook")

            # For IG: navigate to post page and extract media
            if not media_urls and source == "instagram":
                shortcode = post.get("shortcode", "")
                if shortcode:
                    ig_url = f"https://www.instagram.com/p/{shortcode}/"
                    media_urls = self._safari_extract_media(ig_url, "instagram")

            # Download each media URL
            for j, url in enumerate(media_urls[:5]):  # max 5 per post
                if not url or url.startswith("blob:") or "emoji" in url:
                    continue

                ext = ".mp4" if any(v in url for v in ["video", ".mp4", "mp4"]) else ".jpg"
                filename = f"{post_id}_{j}{ext}"
                filepath = media_dir / filename

                if filepath.exists():
                    continue

                try:
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
                        "Referer": "https://www.facebook.com/" if "facebook" in source else "https://www.instagram.com/",
                    }
                    resp = _req.get(url, headers=headers, timeout=60, stream=True)
                    if resp.status_code == 200:
                        with open(filepath, "wb") as f:
                            for chunk in resp.iter_content(8192):
                                f.write(chunk)
                        size_kb = filepath.stat().st_size // 1024
                        logger.debug(f"    📥 {filename} ({size_kb}KB)")
                        downloaded_count += 1
                    else:
                        logger.debug(f"    ⚠️ HTTP {resp.status_code} for {url[:50]}")
                except Exception as e:
                    logger.debug(f"    ⚠️ Download failed: {e}")

                time.sleep(0.3)

            time.sleep(1)  # delay between posts

        logger.info(f"✅ Downloaded {downloaded_count} media files ({skipped} posts already had media)")
        return downloaded_count

    def _safari_extract_media(self, url: str, platform: str) -> List[str]:
        """Navigate Safari to a URL and extract all image/video media URLs."""
        import subprocess as _sp

        # Navigate
        nav_script = f'''
tell application "Safari"
    activate
    if (count of windows) = 0 then make new document
    set URL of front document to "{url}"
end tell'''
        try:
            _sp.run(["osascript", "-e", nav_script], capture_output=True, text=True, timeout=20)
        except Exception:
            logger.debug(f"    Safari nav timeout for {url[:50]}")
            return []
        time.sleep(4)

        # Extract media
        js_code = """
(function() {
    var urls = [];
    var seen = new Set();

    // Images (scontent CDN)
    var imgs = document.querySelectorAll('img[src*="scontent"]');
    imgs.forEach(function(img) {
        if (img.width > 100 && img.height > 100 && !seen.has(img.src)) {
            seen.add(img.src);
            urls.push(img.src);
        }
    });

    // Videos
    var vids = document.querySelectorAll('video[src], video source[src]');
    vids.forEach(function(v) {
        var src = v.src || v.getAttribute('src') || '';
        if (src && !src.startsWith('blob:') && !seen.has(src)) {
            seen.add(src);
            urls.push(src);
        }
    });

    // Video poster images
    var posters = document.querySelectorAll('video[poster]');
    posters.forEach(function(v) {
        var p = v.getAttribute('poster') || '';
        if (p && p.includes('scontent') && !seen.has(p)) {
            seen.add(p);
            urls.push(p);
        }
    });

    return JSON.stringify(urls);
})();
"""
        js_escaped = js_code.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        extract_script = f'''
tell application "Safari"
    if (count of windows) > 0 then
        return do JavaScript "{js_escaped}" in front document
    end if
    return "[]"
end tell'''

        try:
            result = _sp.run(["osascript", "-e", extract_script], capture_output=True, text=True, timeout=30)
            if result.returncode == 0 and result.stdout.strip():
                return json.loads(result.stdout.strip())
        except Exception as e:
            logger.debug(f"    Safari media extract failed: {e}")

        return []

    def run_full(self, max_ads: int = 30, skip_discover: bool = False, download_media: bool = False):
        """Run the entire Creative Radar pipeline."""
        start = datetime.now()
        logger.info(f"🚀 Creative Radar: {self.spec['name']} — {start.strftime('%H:%M')}")

        if not skip_discover:
            self.discover(max_ads=max_ads)

        posts = self.load_all_posts()
        scored = self.tag_and_rank(posts)
        patterns = self.mine_patterns(scored)
        briefs = self.generate_briefs(patterns)
        self.report(scored, patterns, briefs)

        if download_media:
            self.download_top_media(top_n=25)

        elapsed = (datetime.now() - start).seconds
        logger.info(f"⏱️  Creative Radar complete in {elapsed}s")
        return {"scored": len(scored), "patterns": patterns, "briefs": briefs}


# ═══════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Creative Radar — Offer-Agnostic Market Research")
    parser.add_argument("offer", help=f"Offer key: {', '.join(OFFER_SPECS.keys())}")
    parser.add_argument("--skip-discover", action="store_true", help="Skip scraping, use existing data")
    parser.add_argument("--max-ads", type=int, default=30, help="Max ads per keyword")
    parser.add_argument("--report-only", action="store_true", help="Just print the report")
    parser.add_argument("--download-media", action="store_true", help="Download media for top-ranked posts")
    parser.add_argument("--download-only", action="store_true", help="Only download media (skip analysis)")
    parser.add_argument("--top-n", type=int, default=25, help="Number of top posts to download media for")
    args = parser.parse_args()

    radar = CreativeRadar(args.offer)

    if args.download_only:
        radar.download_top_media(top_n=args.top_n)
    elif args.report_only:
        radar.report()
    else:
        radar.run_full(max_ads=args.max_ads, skip_discover=args.skip_discover, download_media=args.download_media)


if __name__ == "__main__":
    main()
