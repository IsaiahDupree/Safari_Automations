#!/usr/bin/env python3
"""
Ad Intelligence Pipeline — Market Research → Ad Creation

Analyzes top-ranked scraped posts to extract winning patterns,
then generates ad briefs and Sora video prompts for our products/offers.
"""
import json
import re
import os
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from collections import Counter
from loguru import logger

from market_research.storage import ResearchStorage

RESEARCH_BASE = os.path.expanduser("~/market-research")

# ── Our Products & Offers ──

PRODUCTS = {
    "everreach-app-kit": {
        "name": "EverReach App Kit",
        "tagline": "Launch your mobile app in days, not months",
        "keywords": ["app templates", "mobile app starter", "react native template", "app development kit"],
        "pain_points": ["slow app development", "expensive developers", "starting from scratch"],
        "cta": "Get the App Kit",
        "url": "everreachappkit.com",
        "bullets": [
            "React Native + Expo starter templates",
            "Auth, payments & backend included",
            "Ship to iOS & Android in days",
        ],
    },
    "steadyletters": {
        "name": "SteadyLetters",
        "tagline": "AI-powered handwritten mail that converts",
        "keywords": ["direct mail marketing", "handwritten letters", "mail automation", "physical mail"],
        "pain_points": ["low email open rates", "digital ad fatigue", "standing out"],
        "cta": "Start Sending",
        "url": "steadyletters.com",
        "bullets": [
            "AI writes the letter, we mail it for you",
            "Real handwriting styles — not printed fonts",
            "98% open rate vs 20% for email",
        ],
    },
    "velvethold": {
        "name": "VelvetHold",
        "tagline": "Stop no-shows with deposit-based reservations",
        "keywords": ["no-show prevention", "booking deposits", "reservation system", "appointment no shows"],
        "pain_points": ["no-show clients", "lost revenue", "wasted time slots"],
        "cta": "Eliminate No-Shows",
        "url": "velvethold.com",
        "bullets": [
            "Collect deposits at booking — no more ghosting",
            "Automated reminders reduce no-shows by 80%",
            "Works with any service business",
        ],
    },
    "mediaposter": {
        "name": "MediaPoster",
        "tagline": "Automate your social media across every platform",
        "keywords": ["social media automation", "content scheduling", "multi-platform posting"],
        "pain_points": ["manual posting", "inconsistent posting", "managing multiple accounts"],
        "cta": "Automate Now",
        "url": "mediaposter.app",
        "bullets": [
            "Post to TikTok, Instagram, YouTube & more",
            "Safari-based automation — no API limits",
            "Schedule weeks of content in minutes",
        ],
    },
    "vellopad": {
        "name": "VelloPad",
        "tagline": "Write, publish, and sell your book on autopilot",
        "keywords": ["book publishing", "print on demand", "self publishing platform"],
        "pain_points": ["complex publishing process", "expensive publishing", "distribution"],
        "cta": "Publish Your Book",
        "url": "vellopad.com",
        "bullets": [
            "AI-assisted writing & editing",
            "Print-on-demand with no upfront cost",
            "Sell on Amazon, Barnes & Noble, and more",
        ],
    },
    "everreach": {
        "name": "EverReach",
        "tagline": "A personal CRM that turns care into a repeatable rhythm",
        "keywords": [
            "personal crm app", "relationship tracker app", "contact reminder app",
            "follow up app", "stay in touch app", "friendship tracker",
            "personal relationship management", "networking follow up",
        ],
        "pain_points": [
            "friendships drifting apart",
            "forgetting to follow up",
            "relationships fading when life gets busy",
            "not knowing what to say after a long silence",
            "losing touch with people you care about",
        ],
        "cta": "Start Free Trial",
        "url": "everreach.app",
        "bullets": [
            "Top people list + warmth score — see who needs attention",
            "Gentle reminders so no one slips through the cracks",
            "Message starters when your brain goes blank",
        ],
        # Schwartz awareness-stage hooks (used by brief generator)
        "awareness_hooks": {
            "unaware":         "most friendships don't end — they drift",
            "problem_aware":   "the longer you wait, the more awkward it feels",
            "solution_aware":  "stop doing relationships from memory",
            "product_aware":   "if you want to stay close without overthinking, this is the tool",
            "most_aware":      "this is not spammy — it's a reminder to be human",
        },
        # FATE framework for this product
        "fate": {
            "familiarity": "You care. You just get busy and time disappears.",
            "authority":   "I built a simple system for that.",
            "trust":       "Show: list → reminder → message starter → send",
            "emotion":     "Relief + identity: 'I'm the type of person who shows up for people.'",
        },
    },
    "everreach-expo-crm": {
        "name": "EverReach Expo CRM",
        "tagline": "Mobile CRM with built-in Meta attribution — know exactly which ads convert",
        "keywords": ["mobile crm", "meta pixel attribution", "sales crm app", "lead tracking mobile"],
        "pain_points": ["not knowing which ads convert", "manual lead tracking", "losing leads"],
        "cta": "Track Your Leads",
        "url": "everreachcrm.com",
        "bullets": [
            "Meta Pixel + CAPI attribution built in",
            "Track leads from ad click to close",
            "Works on iOS & Android",
        ],
    },
    "snapmix": {
        "name": "SnapMix",
        "tagline": "Share your tracks like stories — Snapchat-style for DJs and producers",
        "keywords": ["dj app", "music sharing app", "producer tools", "beat sharing platform"],
        "pain_points": ["getting music heard", "low engagement on music posts", "no platform for DJs"],
        "cta": "Share Your Mix",
        "url": "snapmix.app",
        "bullets": [
            "Disappearing track previews like Snapchat stories",
            "Built for DJs, producers & beatmakers",
            "Grow your fanbase with viral sharing",
        ],
    },
    "gapradar": {
        "name": "GapRadar",
        "tagline": "Find untapped market gaps before your competitors do",
        "keywords": ["market research tool", "competitor analysis", "product opportunity finder", "niche research"],
        "pain_points": ["not knowing what to build next", "saturated markets", "wasted product development"],
        "cta": "Find Your Gap",
        "url": "gapradar.com",
        "bullets": [
            "AI-powered market gap detection",
            "Competitor blind spot analysis",
            "Validate ideas before you build",
        ],
    },
}

# ── Hook Templates (derived from top-performing content patterns) ──

HOOK_TEMPLATES = {
    "question": "Are you still {pain_point}?",
    "bold_claim": "I {result} in {timeframe} without {objection}.",
    "stat": "{stat}% of {audience} struggle with {pain_point}.",
    "story": "I used to {pain_point} until I found {solution}.",
    "contrast": "Stop {bad_thing}. Start {good_thing}.",
    "curiosity": "The {adjective} way to {desired_outcome} (most people don't know this).",
    "social_proof": "{number} {audience} already use this to {desired_outcome}.",
    "urgency": "If you're not {doing_thing} yet, you're leaving money on the table.",
}


class PatternAnalyzer:
    """Analyzes scraped posts to extract winning content patterns."""

    def analyze(self, posts: List[dict], keyword: str) -> dict:
        """Extract patterns from top-ranked posts."""
        if not posts:
            return {}

        top = posts[:20]  # Analyze top 20

        patterns = {
            "keyword": keyword,
            "analyzed_at": datetime.now().isoformat(),
            "post_count": len(top),

            # Hook patterns
            "top_hooks": self._extract_hooks(top),
            "hook_formats": self._classify_hooks(top),
            "avg_hook_length": self._avg_hook_length(top),

            # Caption patterns
            "avg_caption_length": self._avg_caption_length(top),
            "top_hashtags": self._top_hashtags(top),
            "cta_patterns": self._extract_ctas(top),
            "emoji_usage_rate": self._emoji_rate(top),

            # Engagement patterns
            "best_content_types": self._content_type_ranking(top),
            "avg_reactions": int(sum(p.get("reactions", p.get("likes", 0)) for p in top) / max(len(top), 1)),
            "avg_comments": int(sum(p.get("comments", 0) for p in top) / max(len(top), 1)),
            "avg_shares": int(sum(p.get("shares", 0) for p in top) / max(len(top), 1)),
            "avg_views": int(sum(p.get("views", 0) or 0 for p in top) / max(len(top), 1)),

            # Top performing posts (reference)
            "top_posts": [
                {
                    "url": p.get("url", ""),
                    "author": p.get("author_name", p.get("author_username", "")),
                    "reactions": p.get("reactions", p.get("likes", 0)),
                    "content_type": p.get("content_type", ""),
                    "hook": self._get_hook(p),
                    "overall_rank": p.get("overall_rank", 0),
                }
                for p in top[:5]
            ],
        }

        return patterns

    def _get_hook(self, post: dict) -> str:
        """Extract first line of post text as the hook."""
        text = post.get("text_content", post.get("caption", "")) or ""
        lines = [l.strip() for l in text.split("\n") if l.strip()]
        return lines[0][:120] if lines else ""

    def _extract_hooks(self, posts: List[dict]) -> List[str]:
        hooks = []
        for p in posts:
            h = self._get_hook(p)
            if h and len(h) > 10:
                hooks.append(h)
        return hooks[:10]

    def _classify_hooks(self, posts: List[dict]) -> Dict[str, int]:
        formats: Dict[str, int] = Counter()
        for p in posts:
            h = self._get_hook(p).lower()
            if not h:
                continue
            if h.endswith("?"):
                formats["question"] += 1
            elif any(h.startswith(w) for w in ["i ", "we ", "my "]):
                formats["personal_story"] += 1
            elif re.search(r"\d+%|\d+x|\$\d+", h):
                formats["stat_or_number"] += 1
            elif any(w in h for w in ["stop ", "don't ", "never "]):
                formats["contrast"] += 1
            elif any(w in h for w in ["how to", "the secret", "the truth"]):
                formats["curiosity"] += 1
            else:
                formats["statement"] += 1
        return dict(formats)

    def _avg_hook_length(self, posts: List[dict]) -> float:
        hooks = [self._get_hook(p) for p in posts]
        lengths = [len(h.split()) for h in hooks if h]
        return sum(lengths) / max(len(lengths), 1)

    def _avg_caption_length(self, posts: List[dict]) -> float:
        texts = [post.get("text_content", post.get("caption", "")) or "" for post in posts]
        lengths = [len(t.split()) for t in texts if t]
        return sum(lengths) / max(len(lengths), 1)

    def _top_hashtags(self, posts: List[dict]) -> List[str]:
        all_tags: Counter = Counter()
        for p in posts:
            # Use hashtags list if available
            for tag in (p.get("hashtags") or []):
                all_tags[tag.lower()] += 1
            # Also extract from text_content (Ad Library ads embed hashtags in body)
            text = p.get("text_content", p.get("caption", "")) or ""
            for tag in re.findall(r"#[\w\u00C0-\u024F]+", text):
                all_tags[tag.lower()] += 1
        return [tag for tag, _ in all_tags.most_common(15)]

    def _extract_ctas(self, posts: List[dict]) -> List[str]:
        cta_patterns = [
            "link in bio", "comment below", "dm me", "click the link",
            "save this", "share this", "follow for more", "tag a friend",
            "drop a", "let me know", "sign up", "get started",
        ]
        found: Counter = Counter()
        for p in posts:
            # Check cta_text field (from Ad Library)
            cta_field = (p.get("cta_text") or "").strip()
            if cta_field:
                found[cta_field] += 1
            # Also scan body text
            text = (p.get("text_content", p.get("caption", "")) or "").lower()
            for cta in cta_patterns:
                if cta in text:
                    found[cta] += 1
        return [cta for cta, _ in found.most_common(5)]

    def _emoji_rate(self, posts: List[dict]) -> float:
        emoji_pattern = re.compile(
            "[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF"
            "\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF]+",
            flags=re.UNICODE,
        )
        with_emoji = sum(
            1 for p in posts
            if emoji_pattern.search(p.get("text_content", p.get("caption", "")) or "")
        )
        return with_emoji / max(len(posts), 1)

    def _content_type_ranking(self, posts: List[dict]) -> List[str]:
        type_scores: Dict[str, List[float]] = {}
        for p in posts:
            ct = p.get("content_type", "unknown")
            score = p.get("overall_rank", 0)
            type_scores.setdefault(ct, []).append(score)
        avg_by_type = {ct: sum(scores) / len(scores) for ct, scores in type_scores.items()}
        return [ct for ct, _ in sorted(avg_by_type.items(), key=lambda x: x[1], reverse=True)]


class AdBriefGenerator:
    """Generates ad briefs and Sora prompts from research patterns."""

    def __init__(self):
        self.storage = ResearchStorage()
        self.analyzer = PatternAnalyzer()

    def generate(
        self,
        keyword: str,
        product_key: str,
        platform: str = "facebook",
        top_n: int = 20,
    ) -> dict:
        """
        Generate an ad brief for a product based on keyword research.

        Args:
            keyword: The researched keyword
            product_key: Key from PRODUCTS dict
            platform: facebook or instagram
            top_n: How many top posts to analyze

        Returns:
            Ad brief dict with hooks, captions, Sora prompt, etc.
        """
        product = PRODUCTS.get(product_key)
        if not product:
            logger.error(f"Unknown product: {product_key}. Available: {list(PRODUCTS.keys())}")
            return {}

        # Load top posts
        posts = self._load_posts(keyword, platform, top_n)
        if not posts:
            logger.warning(f"No posts found for '{keyword}' on {platform}. Run a search first.")
            return {}

        # Analyze patterns
        patterns = self.analyzer.analyze(posts, keyword)

        # Generate brief
        brief = self._build_brief(keyword, product, patterns, posts)

        # Save
        self._save_brief(brief, keyword, product_key)

        return brief

    def _load_posts(self, keyword: str, platform: str, top_n: int) -> List[dict]:
        """Load ranked posts from storage. Falls back to Meta Ad Library data."""
        slug = keyword.lower().replace(" ", "-").replace("/", "-").lstrip("#")

        # 1. Facebook/Instagram organic posts
        ranked_file = Path(RESEARCH_BASE) / platform / "posts" / slug / "ranked.json"
        if ranked_file.exists():
            with open(ranked_file) as f:
                return json.load(f)[:top_n]

        # 2. SQLite (organic)
        posts = self.storage.get_top_posts(keyword, platform, limit=top_n)
        if posts:
            return posts

        # 3. Meta Ad Library — normalize fields to match pattern analyzer
        ad_lib_file = Path(RESEARCH_BASE) / "meta-ad-library" / "ads" / slug / "ads.json"
        if ad_lib_file.exists():
            with open(ad_lib_file) as f:
                ads = json.load(f)
            # Normalize Ad Library fields → organic post shape
            normalized = []
            for ad in ads[:top_n]:
                normalized.append({
                    "id": ad.get("id", ""),
                    "url": ad.get("advertiser_url", ""),
                    "platform": "facebook",
                    "author_name": ad.get("advertiser_name", ""),
                    "author_url": ad.get("advertiser_url", ""),
                    "text_content": ad.get("ad_text", ""),
                    "caption": ad.get("ad_text", ""),
                    "content_type": "video" if ad.get("has_video") else "image" if ad.get("has_image") else "text",
                    "media_urls": ad.get("media_urls", []),
                    "hashtags": [],
                    "reactions": 0,
                    "comments": 0,
                    "shares": 0,
                    "views": 0,
                    "engagement_score": 0,
                    "virality_score": 0,
                    "relevance_score": 0,
                    "overall_rank": 0,
                    "posted_at": ad.get("started_running", ""),
                    "scraped_at": ad.get("scraped_at", ""),
                    "keyword": ad.get("keyword", keyword),
                    # Ad Library extras
                    "cta_text": ad.get("cta_text", ""),
                    "landing_url": ad.get("landing_url", ""),
                    "platforms": ad.get("platforms", []),
                    "source": "meta_ad_library",
                })
            logger.info(f"Loaded {len(normalized)} ads from Meta Ad Library for '{keyword}'")
            return normalized

        return []

    def _build_brief(
        self,
        keyword: str,
        product: dict,
        patterns: dict,
        posts: List[dict],
    ) -> dict:
        """Build the full ad brief."""
        # Pick best hook format from patterns
        hook_formats = patterns.get("hook_formats", {})
        best_format = max(hook_formats, key=hook_formats.get) if hook_formats else "question"

        # Generate hooks based on winning format + product
        hooks = self._generate_hooks(product, best_format, patterns, posts)

        # Generate caption
        caption = self._generate_caption(product, patterns, hooks[0] if hooks else "")

        # Determine best format
        content_types = patterns.get("best_content_types", ["video", "reel"])
        best_format_type = content_types[0] if content_types else "reel"

        # Generate Sora prompt for video
        sora_prompt = self._generate_sora_prompt(product, hooks[0] if hooks else "", best_format_type)

        # Top reference posts
        top_refs = [p.get("url", "") for p in posts[:3] if p.get("url")]

        brief = {
            "id": f"brief-{keyword.replace(' ', '-')}-{product['name'].replace(' ', '-').lower()}",
            "generated_at": datetime.now().isoformat(),
            "keyword": keyword,
            "product": product["name"],
            "product_key": next((k for k, v in PRODUCTS.items() if v == product), ""),
            "target_audience": f"People searching for '{keyword}'",

            # Content strategy
            "recommended_format": best_format_type,
            "recommended_platform": "instagram_reels" if best_format_type in ("reel", "video") else "facebook_feed",

            # Hooks (multiple options)
            "hooks": hooks,
            "primary_hook": hooks[0] if hooks else "",

            # Caption
            "suggested_caption": caption,
            "suggested_hashtags": patterns.get("top_hashtags", [])[:10],
            "suggested_cta": product["cta"],

            # Patterns from research
            "winning_hook_format": best_format,
            "avg_caption_length": int(patterns.get("avg_caption_length", 50)),
            "emoji_usage_rate": round(patterns.get("emoji_usage_rate", 0.5), 2),
            "top_cta_patterns": patterns.get("cta_patterns", []),

            # Sora video prompt
            "sora_prompt": sora_prompt,
            "sora_duration": "6s",
            "sora_aspect_ratio": "9:16",

            # Reference content
            "inspiration_posts": top_refs,
            "avg_engagement": patterns.get("avg_reactions", 0),

            # Competitor insights
            "competitor_insights": self._generate_insights(patterns, keyword),
        }

        return brief

    def _generate_hooks(self, product: dict, best_format: str, patterns: dict, posts: List[dict] = None) -> List[str]:
        """Generate multiple hook options using competitor patterns + product context."""
        hooks = []
        pain = product["pain_points"][0] if product["pain_points"] else "this problem"
        pain2 = product["pain_points"][1] if len(product["pain_points"]) > 1 else pain
        pain3 = product["pain_points"][2] if len(product["pain_points"]) > 2 else pain2
        name = product["name"]
        tagline = product["tagline"]

        # ── Competitor-inspired hooks (highest quality — use real patterns) ──
        top_hooks = patterns.get("top_hooks", [])
        # Build competitor brand word set from ALL posts (author names + capitalized words in hooks)
        # This ensures every hook gets filtered, not just those from top_posts
        competitor_names = set()
        _common_words = {
            "the", "this", "that", "when", "what", "with", "from", "your", "here",
            "stop", "just", "have", "been", "they", "will", "more", "most", "some",
            "into", "over", "after", "every", "still", "even", "only", "also", "then",
            "than", "their", "there", "these", "those", "about", "which", "while",
            "business", "people", "time", "work", "free", "best", "rest", "learn",
            "digital", "marketing", "online", "program", "week", "weeks", "month",
        }
        for p in (posts or []):
            # Author name words
            author = p.get("author_name", p.get("author", ""))
            if author:
                for word in re.split(r"[\s\-_/&]+", author):
                    w = word.lower().strip(".,!?")
                    if len(w) > 3 and w not in _common_words:
                        competitor_names.add(w)
            # Capitalized words in ad text (brand names, product names)
            text = p.get("text_content", p.get("caption", "")) or ""
            for word in re.findall(r"\b[A-Z][a-z]{2,}\b", text):
                w = word.lower()
                if w not in _common_words and len(w) > 3:
                    competitor_names.add(w)
        for raw_hook in top_hooks[:8]:
            adapted = self._adapt_hook(raw_hook, product, competitor_names)
            if adapted and adapted not in hooks:
                hooks.append(adapted)

        # ── Format-specific original hooks ──
        if best_format == "question":
            hooks.extend([
                f"Why do the top creators never deal with {pain}?",
                f"What if you could eliminate {pain} in the next 24 hours?",
                f"Are you still manually dealing with {pain}?",
            ])
        elif best_format == "personal_story":
            hooks.extend([
                f"I used to lose hours every week to {pain}. Then I found this.",
                f"We built {name} because we were sick of {pain}.",
                f"My business was stuck because of {pain} — until this changed everything.",
            ])
        elif best_format == "stat_or_number":
            hooks.extend([
                f"80% of creators waste 10+ hours/week on {pain}. You don't have to.",
                f"3x your output by eliminating {pain} — here's the exact system.",
                f"In 24 hours, you can go from {pain} to fully automated.",
            ])
        elif best_format == "contrast":
            hooks.extend([
                f"Stop wasting time on {pain}. There's a smarter way.",
                f"Don't let {pain} kill your momentum. Fix it today.",
                f"Everyone else is still stuck with {pain}. You don't have to be.",
            ])
        else:  # statement / curiosity
            hooks.extend([
                f"{tagline}",
                f"The {name} system that eliminates {pain} — permanently.",
                f"This is how serious creators solve {pain} without burning out.",
            ])

        # ── Universal fallbacks ──
        hooks.extend([
            f"I eliminated {pain} completely — here's how.",
            f"If you're not solving {pain} yet, you're leaving money on the table.",
            f"Thousands of creators use this to solve {pain2} — and it works.",
        ])

        # Deduplicate while preserving order
        seen = set()
        unique = []
        for h in hooks:
            if h and h not in seen and len(h) > 15:
                seen.add(h)
                unique.append(h)

        return unique[:8]

    def _adapt_hook(self, hook: str, product: dict, competitor_names: set = None) -> str:
        """
        Adapt a real competitor hook to our product by:
        1. Keeping the emotional/structural pattern
        2. Filtering out competitor-branded content
        3. Keeping it under 120 chars
        """
        if not hook or len(hook) < 10:
            return ""

        hook_lower = hook.lower()

        # Skip video metadata artifacts and known junk
        skip_always = [
            "sorry, we're having trouble", "0:00 /", "log in", "to see this content",
            "confirm your age", "sponsored", "library id", "http", "www.", "@",
        ]
        if any(p in hook_lower for p in skip_always):
            return ""

        # Skip hooks containing URLs or domain extensions
        if re.search(r"\b\w+\.(com|io|co|net|org|app|ai)\b", hook_lower):
            return ""

        # Skip hooks containing competitor brand names (dynamic)
        if competitor_names:
            for brand_word in competitor_names:
                if brand_word in hook_lower:
                    return ""

        # Skip hooks with hashtags (competitor-branded)
        if "#" in hook:
            return ""

        # Skip hooks that are too long — trim to first sentence
        if len(hook) > 150:
            first_sentence = re.split(r"[.!?\n]", hook)[0].strip()
            if len(first_sentence) < 15:
                return ""
            hook = first_sentence

        adapted = hook.strip()

        # Structural rewrites based on hook pattern
        pain = product["pain_points"][0] if product["pain_points"] else ""
        name = product["name"]
        tagline = product["tagline"]

        # Question hooks → reframe around our pain point
        if adapted.endswith("?") and len(adapted) < 100:
            # Keep the question structure, swap subject matter
            question_words = ["why", "what if", "how", "are you", "do you", "have you"]
            if any(adapted.lower().startswith(w) for w in question_words):
                # Return as-is if it's short and punchy — competitor questions are gold
                return adapted[:120]

        # Stat/number hooks → keep the number pattern
        stat_match = re.search(r"(\d+[\d,.]*\s*(?:%|x|hours?|minutes?|days?|months?|years?|people|million|billion|\$[\d,]+))", adapted, re.I)
        if stat_match:
            # Keep the stat hook as-is — numbers are universally compelling
            return adapted[:120]

        # Story hooks starting with "I" → keep personal voice
        if adapted.lower().startswith(("i ", "we ", "my ")):
            return adapted[:120]

        # Bold claim hooks → keep as inspiration note
        if len(adapted) <= 120:
            return adapted

        # Long hooks → take just the first sentence
        first_sentence = re.split(r"[.!?\n]", adapted)[0].strip()
        if len(first_sentence) > 15:
            return first_sentence[:120]

        return ""

    def _generate_caption(self, product: dict, patterns: dict, hook: str) -> str:
        """Generate a full caption using product-specific bullets and competitor CTA patterns."""
        emoji_rate = patterns.get("emoji_usage_rate", 0.5)
        use_emoji = emoji_rate > 0.4

        e1 = "🚀" if use_emoji else ""
        e2 = "✅" if use_emoji else ""
        e3 = "👇" if use_emoji else ""

        # Use product-specific bullets if available, else generic
        bullets = product.get("bullets") or [
            f"Built for {product['name']} users",
            "No technical experience needed",
            "Results in days, not months",
        ]
        bullet_lines = "\n".join(f"{e2} {b}" for b in bullets)

        # Pick CTA verb from competitor patterns if available
        cta_patterns = patterns.get("cta_patterns", [])
        # Prefer action-oriented CTAs from competitors
        action_ctas = [c for c in cta_patterns if c.lower() not in ("learn more", "see more")]
        top_competitor_cta = action_ctas[0] if action_ctas else ""

        # Build hashtags from product name + top competitor hashtags
        product_tag = f"#{product['name'].lower().replace(' ', '')}"
        top_tags = patterns.get("top_hashtags", [])[:4]
        hashtag_line = " ".join([product_tag] + top_tags) if top_tags else f"{product_tag} #entrepreneur #saas"

        caption = f"""{hook}

{e1} {product['tagline']}

{bullet_lines}

{e3} {product['cta']} → {product['url']}

{hashtag_line}"""

        return caption.strip()

    def _generate_sora_prompt(self, product: dict, hook: str, content_type: str) -> str:
        """Generate a Sora video prompt based on the ad brief."""
        is_vertical = content_type in ("reel", "video", "short")

        prompt = (
            f"@isaiahdupree standing confidently in a modern, well-lit studio space, "
            f"speaking directly to camera with energy and authenticity. "
            f"He's wearing his signature casual hoodie and gold chain. "
            f"The background shows a clean workspace with subtle tech elements. "
            f"He opens with: \"{hook[:80]}\" — gesturing naturally as he speaks. "
            f"The camera starts with a close-up on his face, then pulls back to reveal "
            f"a screen behind him showing {product['name']}. "
            f"Warm, natural lighting. Vertical {'9:16' if is_vertical else '16:9'} format. "
            f"Cinematic but authentic, like a high-quality social media video."
        )

        return prompt

    def _generate_insights(self, patterns: dict, keyword: str) -> str:
        """Generate human-readable competitor insights."""
        avg_reactions = patterns.get("avg_reactions", 0)
        avg_comments = patterns.get("avg_comments", 0)
        top_types = patterns.get("best_content_types", [])
        top_hooks_fmt = patterns.get("hook_formats", {})
        top_hashtags = patterns.get("top_hashtags", [])[:5]

        best_type = top_types[0] if top_types else "video"
        best_hook = max(top_hooks_fmt, key=top_hooks_fmt.get) if top_hooks_fmt else "question"

        return (
            f"For '{keyword}': Top posts average {avg_reactions:,} reactions and {avg_comments:,} comments. "
            f"{best_type.title()} content performs best. "
            f"Most effective hook format: {best_hook.replace('_', ' ')}. "
            f"Key hashtags: {', '.join(top_hashtags)}."
        )

    def _save_brief(self, brief: dict, keyword: str, product_key: str):
        """Save ad brief to file."""
        briefs_dir = Path(RESEARCH_BASE) / "ad-briefs"
        briefs_dir.mkdir(parents=True, exist_ok=True)

        date_str = datetime.now().strftime("%Y-%m-%d")
        slug = keyword.lower().replace(" ", "-").lstrip("#")
        filename = f"{date_str}-{slug}-{product_key}.json"
        filepath = briefs_dir / filename

        with open(filepath, "w") as f:
            json.dump(brief, f, indent=2)

        logger.info(f"💡 Ad brief saved → {filepath}")

        # Also generate a readable markdown version
        self._save_brief_md(brief, briefs_dir, filename.replace(".json", ".md"))

    def _save_brief_md(self, brief: dict, directory: Path, filename: str):
        """Save a human-readable markdown version of the brief."""
        lines = [
            f"# Ad Brief: {brief['product']} × \"{brief['keyword']}\"",
            f"**Generated:** {brief['generated_at'][:10]}  ",
            f"**Format:** {brief['recommended_format']} | **Platform:** {brief['recommended_platform']}",
            "",
            "---",
            "",
            "## Hooks (pick one)",
            "",
        ]
        for i, hook in enumerate(brief.get("hooks", []), 1):
            lines.append(f"{i}. {hook}")

        lines.extend([
            "",
            "## Suggested Caption",
            "",
            "```",
            brief.get("suggested_caption", ""),
            "```",
            "",
            "## Sora Video Prompt",
            "",
            "```",
            brief.get("sora_prompt", ""),
            "```",
            "",
            "## Hashtags",
            "",
            " ".join(brief.get("suggested_hashtags", [])),
            "",
            "## Competitor Insights",
            "",
            brief.get("competitor_insights", ""),
            "",
            "## Inspiration Posts",
            "",
        ])
        for url in brief.get("inspiration_posts", []):
            lines.append(f"- {url}")

        with open(directory / filename, "w") as f:
            f.write("\n".join(lines))


class ResearchPipeline:
    """
    Full end-to-end pipeline:
    keywords → scrape → rank → analyze → ad brief → Sora prompt
    """

    def __init__(self):
        self.storage = ResearchStorage()
        self.brief_gen = AdBriefGenerator()

    def run(
        self,
        keywords: List[str],
        product_key: str,
        platforms: List[str] = None,
        max_per_keyword: int = 50,
        download_top: int = 10,
        skip_scrape: bool = False,
    ) -> List[dict]:
        """
        Full pipeline run.

        Args:
            keywords: Search terms to research
            product_key: Product to generate briefs for
            platforms: ['facebook', 'instagram'] or subset
            max_per_keyword: Max posts per keyword per platform
            download_top: Download media for top N posts
            skip_scrape: Skip scraping, use existing data

        Returns:
            List of generated ad briefs
        """
        if platforms is None:
            platforms = ["facebook", "instagram"]

        briefs = []

        if not skip_scrape:
            # Scrape Facebook
            if "facebook" in platforms:
                from market_research.facebook_scraper import FacebookResearchScraper
                fb = FacebookResearchScraper()
                fb.batch_search(keywords, max_per_keyword=max_per_keyword, download_top=download_top)

            # Scrape Instagram
            if "instagram" in platforms:
                from market_research.instagram_scraper import InstagramResearchScraper
                ig = InstagramResearchScraper()
                ig.batch_search(keywords, search_type="hashtag", max_per_keyword=max_per_keyword, download_top=download_top)

        # Generate ad briefs for each keyword × platform
        for keyword in keywords:
            for platform in platforms:
                logger.info(f"\n💡 Generating ad brief: '{keyword}' × {product_key} [{platform}]")
                brief = self.brief_gen.generate(keyword, product_key, platform=platform)
                if brief:
                    briefs.append(brief)
                    self._print_brief_summary(brief)

        return briefs

    def _print_brief_summary(self, brief: dict):
        print(f"\n{'─' * 60}")
        print(f"💡 AD BRIEF: {brief['product']} × '{brief['keyword']}'")
        print(f"{'─' * 60}")
        print(f"  Format:  {brief['recommended_format']}")
        print(f"  Hook:    {brief['primary_hook'][:80]}")
        print(f"  CTA:     {brief['suggested_cta']}")
        print(f"  Hashtags: {' '.join(brief['suggested_hashtags'][:5])}")
        print(f"  Insights: {brief['competitor_insights'][:100]}...")
        print()


# ── CLI ──

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Ad Intelligence Pipeline")
    sub = parser.add_subparsers(dest="command")

    # generate brief
    g = sub.add_parser("brief", help="Generate ad brief from research data")
    g.add_argument("keyword", help="Researched keyword")
    g.add_argument("--product", required=True, choices=list(PRODUCTS.keys()), help="Product to create brief for")
    g.add_argument("--platform", default="facebook", choices=["facebook", "instagram"])
    g.add_argument("--top", type=int, default=20)

    # full pipeline
    p = sub.add_parser("pipeline", help="Full research + brief pipeline")
    p.add_argument("--keywords", required=True, help="Comma-separated keywords")
    p.add_argument("--product", required=True, choices=list(PRODUCTS.keys()))
    p.add_argument("--platforms", default="facebook,instagram")
    p.add_argument("--max-per-keyword", type=int, default=50)
    p.add_argument("--skip-scrape", action="store_true", help="Use existing data, skip scraping")

    # list products
    sub.add_parser("products", help="List available products")

    # list briefs
    sub.add_parser("briefs", help="List generated ad briefs")

    args = parser.parse_args()

    if args.command == "brief":
        gen = AdBriefGenerator()
        brief = gen.generate(args.keyword, args.product, platform=args.platform, top_n=args.top)
        if brief:
            print(f"\n✅ Brief generated: {brief['id']}")
            print(f"   Hook: {brief['primary_hook']}")
            print(f"   Sora prompt: {brief['sora_prompt'][:100]}...")
            print(f"\n   Saved to ~/market-research/ad-briefs/")

    elif args.command == "pipeline":
        keywords = [k.strip() for k in args.keywords.split(",")]
        platforms = [p.strip() for p in args.platforms.split(",")]
        pipeline = ResearchPipeline()
        briefs = pipeline.run(
            keywords=keywords,
            product_key=args.product,
            platforms=platforms,
            skip_scrape=args.skip_scrape,
        )
        print(f"\n✅ Generated {len(briefs)} ad briefs")

    elif args.command == "products":
        print("\nAvailable products:")
        for key, prod in PRODUCTS.items():
            print(f"  {key:<25} {prod['name']}")
            print(f"  {'':25} {prod['tagline']}")
            print()

    elif args.command == "briefs":
        briefs_dir = Path(RESEARCH_BASE) / "ad-briefs"
        if not briefs_dir.exists():
            print("No briefs generated yet.")
            return
        briefs = sorted(briefs_dir.glob("*.json"), reverse=True)
        print(f"\n{len(briefs)} ad briefs:\n")
        for b in briefs:
            with open(b) as f:
                data = json.load(f)
            print(f"  {b.name}")
            print(f"    {data.get('product', '?')} × '{data.get('keyword', '?')}'")
            print(f"    Hook: {data.get('primary_hook', '')[:70]}")
            print()

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
