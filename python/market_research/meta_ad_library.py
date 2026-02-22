#!/usr/bin/env python3
"""
Meta Ad Library Scraper — Safari Automation

Scrapes the public Meta Ad Library (facebook.com/ads/library) for competitor
ads related to our keywords and offers. No login required.

Extracts: ad text, advertiser, start date, platforms, CTA, landing URL, media.
"""
import subprocess
import time
import json
import re
import os
import hashlib
import requests
import uuid
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict
from urllib.parse import quote_plus
from loguru import logger

from market_research.storage import ResearchStorage

RESEARCH_BASE = os.path.expanduser("~/market-research")

AD_LIBRARY_BASE = "https://www.facebook.com/ads/library/"


def build_ad_library_url(keyword: str, country: str = "US", active_only: bool = True, ad_type: str = "all") -> str:
    status = "active" if active_only else "all"
    kw = quote_plus(keyword)
    return (
        f"{AD_LIBRARY_BASE}?active_status={status}&ad_type={ad_type}"
        f"&country={country}&q={kw}&search_type=keyword_unordered&media_type=all"
    )


JS_EXTRACT_ADS = r"""
(function() {
    var ads = [];

    // The Ad Library renders each ad as a block containing:
    //   "Active\nLibrary ID: XXXXXX\nStarted running on DATE\n..."
    // We identify ad blocks by finding all elements whose direct text contains "Library ID:"
    // then walking up to find the containing card.

    // Strategy: find all "Library ID:" text nodes, then walk up to the card boundary.
    // The card is the smallest ancestor that contains both the Library ID text AND
    // an advertiser profile link AND the ad body text. We bound text length tightly
    // to avoid grabbing the entire page container.
    function findAdCards() {
        var cards = [];
        var seen = new Set();

        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        var node;
        while ((node = walker.nextNode())) {
            if (node.nodeValue && node.nodeValue.includes('Library ID:')) {
                var el = node.parentElement;
                var bestCard = null;
                // Walk up max 12 levels; pick the SMALLEST element that has
                // a profile link AND text between 200–4000 chars
                for (var i = 0; i < 12 && el && el !== document.body; i++) {
                    var textLen = (el.innerText || '').length;
                    var profileLink = el.querySelector('a[href*="facebook.com/"]:not([href*="/ads/library"]):not([href*="l.facebook.com"]):not([href*="/policies"]):not([href*="/privacy"])');
                    if (profileLink && textLen >= 150 && textLen <= 4000) {
                        bestCard = el; // keep going up to find smallest valid
                        break;
                    }
                    el = el.parentElement;
                }
                if (bestCard) {
                    var key = (bestCard.innerText || '').substring(0, 60);
                    if (!seen.has(key)) {
                        seen.add(key);
                        cards.push(bestCard);
                    }
                }
            }
        }
        return cards;
    }

    var adCards = findAdCards();

    // Fallback: data-testid
    if (adCards.length === 0) {
        adCards = Array.from(document.querySelectorAll('div[data-testid="ad-archive-renderer"]'));
    }

    adCards.forEach(function(card, idx) {
        try {
            var ad = { index: idx };
            var text = card.innerText || '';

            // ── Advertiser name ──
            // The advertiser link is a facebook.com profile link (not ads/library)
            var advLink = null;
            var allLinks = Array.from(card.querySelectorAll('a[href*="facebook.com/"]'));
            for (var i = 0; i < allLinks.length; i++) {
                var href = allLinks[i].href || '';
                var linkText = (allLinks[i].innerText || '').trim();
                // Skip nav links, ad library links, l.facebook.com redirects
                if (
                    !href.includes('/ads/library') &&
                    !href.includes('l.facebook.com') &&
                    !href.includes('/policies') &&
                    !href.includes('/privacy') &&
                    linkText.length > 1 &&
                    linkText.length < 80 &&
                    !/^\d+$/.test(linkText) &&           // skip pure numbers
                    !/^\d+ ads?$/.test(linkText)          // skip "2 ads" badges
                ) {
                    advLink = allLinks[i];
                    break;
                }
            }
            ad.advertiser_name = advLink ? (advLink.innerText || '').trim().split('\n')[0] : '';
            ad.advertiser_url  = advLink ? (advLink.href || '') : '';

            // ── Library ID ──
            var libMatch = text.match(/Library ID:\s*(\d+)/);
            ad.ad_id = libMatch ? libMatch[1] : '';

            // ── Start date ──
            var sm = text.match(/Started running on ([A-Za-z]+ \d+, \d{4}|\d{4}-\d{2}-\d{2})/);
            ad.started_running = sm ? sm[1] : '';

            // ── Ad body text ──
            // The Ad Library does NOT use dir="auto". Instead, extract the card's full
            // innerText and strip out the known metadata lines to isolate the ad copy.
            var metaLinePattern = /^(\u200b|Active|Inactive|Library ID[:\s]|Started running|Platforms|Sponsored|See ad details|Open Dropdown|Sign up now|Learn more|Sign up|Shop now|Get quote|Contact us|Book now|Apply now|Download|Watch more|Get offer|Subscribe|Listen now|Send message|Donate now|See menu|Get started|Order now|Install now|\s*)$/i;
            var cardLines = text.split('\n');
            var bodyLines = [];
            var pastSponsor = false;
            for (var li = 0; li < cardLines.length; li++) {
                var line = cardLines[li].trim();
                if (line === 'Sponsored') { pastSponsor = true; continue; }
                if (!pastSponsor) continue;
                if (metaLinePattern.test(line)) continue;
                if (line.length === 0) continue;
                bodyLines.push(line);
            }
            ad.ad_text = bodyLines.join('\n').trim();

            // ── Platforms ──
            ad.platforms = [];
            // Platform icons have aria-labels or are in a specific section
            var platformSection = text.substring(text.indexOf('Platforms'), text.indexOf('Platforms') + 200);
            ['Facebook','Instagram','Messenger','Audience Network','WhatsApp'].forEach(function(p) {
                if (
                    card.querySelector('[aria-label*="' + p + '"]') ||
                    platformSection.includes(p)
                ) {
                    ad.platforms.push(p);
                }
            });

            // ── CTA button ──
            // CTA buttons are typically links with short text like "Learn more", "Shop now"
            var ctaPatterns = /^(Learn more|Shop now|Sign up|Get quote|Contact us|Book now|Apply now|Download|Watch more|Get offer|Subscribe|Listen now|Send message|Donate now|See menu|Get started|Order now|Request time|Install now)$/i;
            ad.cta_text = '';
            Array.from(card.querySelectorAll('a[href], div[role="button"]')).forEach(function(el) {
                var t = (el.innerText || '').trim().split('\n')[0];
                if (ctaPatterns.test(t)) {
                    ad.cta_text = t;
                }
            });

            // ── Landing URL ──
            ad.landing_url = '';
            Array.from(card.querySelectorAll('a[href]')).forEach(function(link) {
                var href = link.href || '';
                if (href.includes('l.facebook.com/l.php')) {
                    // Extract the actual URL from the redirect
                    var uMatch = href.match(/[?&]u=([^&]+)/);
                    ad.landing_url = uMatch ? decodeURIComponent(uMatch[1]) : href;
                }
            });

            // ── Media ──
            ad.media_urls = [];
            ad.has_video = false;
            ad.has_image = false;
            Array.from(card.querySelectorAll('video')).forEach(function(v) {
                ad.has_video = true;
                if (v.src) ad.media_urls.push(v.src);
            });
            Array.from(card.querySelectorAll('img[src*="scontent"], img[src*="fbcdn"]')).forEach(function(img) {
                if ((img.width > 80 || img.naturalWidth > 80) && img.src) {
                    ad.has_image = true;
                    ad.media_urls.push(img.src);
                }
            });

            // ── Active status ──
            ad.is_active = text.includes('Active') && !text.startsWith('Inactive');

            // ── Estimated reach ──
            var rm = text.match(/(\d[\d,.]+[kKmM]?)\s*(?:people|accounts)\s*reached/i);
            ad.estimated_reach = rm ? rm[1] : '';

            if (ad.advertiser_name || ad.ad_text || ad.ad_id) {
                ads.push(ad);
            }
        } catch(e) {}
    });

    return JSON.stringify({
        ads: ads,
        cardCount: adCards.length,
        bodySnippet: (document.body||{innerText:''}).innerText.substring(0, 400)
    });
})();
"""

JS_WAIT_CHECK = """
(function() {
    var t = (document.body||{innerText:''}).innerText;
    var cards = document.querySelectorAll('div[data-testid="ad-archive-renderer"]').length;
    var started = (t.match(/Started running/g)||[]).length;
    return JSON.stringify({ cards: cards, started: started, loaded: cards > 0 || started > 0, snippet: t.substring(0,200) });
})();
"""


class MetaAdLibraryScraper:
    """Scrapes Meta Ad Library — no login required."""

    def __init__(self, delay: float = 3.5, scroll_pause: float = 3.0, max_scrolls: int = 15, country: str = "US"):
        self.delay = delay
        self.scroll_pause = scroll_pause
        self.max_scrolls = max_scrolls
        self.country = country
        self.storage = ResearchStorage()

    def _run_applescript(self, script: str, timeout: int = 30) -> str:
        try:
            r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
            return r.stdout.strip() if r.returncode == 0 else ""
        except Exception:
            return ""

    def _execute_js(self, js_code: str, timeout: int = 30) -> str:
        js_escaped = js_code.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        script = f'''
tell application "Safari"
    if (count of windows) > 0 then
        return do JavaScript "{js_escaped}" in front document
    end if
    return ""
end tell'''
        return self._run_applescript(script, timeout=timeout)

    def _navigate(self, url: str):
        script = f'''
tell application "Safari"
    activate
    if (count of windows) = 0 then make new document
    set URL of front document to "{url}"
end tell'''
        self._run_applescript(script)
        time.sleep(self.delay)

    def _get_current_url(self) -> str:
        return self._run_applescript('tell application "Safari"\nif (count of windows) > 0 then return URL of front document\nreturn ""\nend tell')

    def _scroll_down(self):
        self._execute_js("window.scrollBy(0, window.innerHeight * 0.85);")
        time.sleep(self.scroll_pause)

    def _wait_for_ads(self, max_wait: int = 20) -> bool:
        for _ in range(max_wait):
            raw = self._execute_js(JS_WAIT_CHECK)
            if raw:
                try:
                    state = json.loads(raw)
                    if state.get("loaded"):
                        logger.debug(f"  Loaded: {state.get('cards')} cards, {state.get('started')} 'Started running'")
                        return True
                    logger.debug(f"  Waiting... snippet: {state.get('snippet','')[:80]}")
                except Exception:
                    pass
            time.sleep(1)
        return False

    def _generate_ad_id(self, item: dict, keyword: str) -> str:
        if item.get("ad_id"):
            return f"meta_ad_{item['ad_id']}"
        content = f"{item.get('advertiser_name','')}|{item.get('ad_text','')[:80]}|{item.get('started_running','')}"
        return f"meta_{hashlib.md5(content.encode()).hexdigest()[:12]}"

    def search(self, keyword: str, max_ads: int = 50, active_only: bool = True, country: str = None, ad_type: str = "all") -> List[dict]:
        """Search Meta Ad Library for a keyword. No login required."""
        country = country or self.country
        url = build_ad_library_url(keyword, country=country, active_only=active_only, ad_type=ad_type)
        logger.info(f"🔍 Meta Ad Library: '{keyword}' [{country}] active={active_only}")
        logger.debug(f"  URL: {url}")

        self._navigate(url)
        loaded = self._wait_for_ads(max_wait=15)
        if not loaded:
            logger.warning(f"  No ads loaded for '{keyword}' — may be no results or slow load")

        all_ads: List[dict] = []
        seen_ids: set = set()
        no_new_count = 0
        prev_count = 0

        for scroll_num in range(self.max_scrolls):
            raw = self._execute_js(JS_EXTRACT_ADS)
            if not raw:
                self._scroll_down()
                continue

            try:
                result = json.loads(raw)
                extracted = result.get("ads", [])
                logger.debug(f"  Scroll {scroll_num+1}: extracted {len(extracted)} from {result.get('cardCount',0)} cards")
            except json.JSONDecodeError:
                self._scroll_down()
                continue

            for item in extracted:
                ad_id = self._generate_ad_id(item, keyword)
                if ad_id in seen_ids:
                    continue
                seen_ids.add(ad_id)
                ad = {
                    "id": ad_id,
                    "keyword": keyword,
                    "platform": "meta_ad_library",
                    "advertiser_name": item.get("advertiser_name", ""),
                    "advertiser_url": item.get("advertiser_url", ""),
                    "ad_text": item.get("ad_text", ""),
                    "started_running": item.get("started_running", ""),
                    "platforms": item.get("platforms", []),
                    "cta_text": item.get("cta_text", ""),
                    "landing_url": item.get("landing_url", ""),
                    "media_urls": item.get("media_urls", []),
                    "has_video": item.get("has_video", False),
                    "has_image": item.get("has_image", False),
                    "is_active": item.get("is_active", True),
                    "estimated_reach": item.get("estimated_reach", ""),
                    "ad_id": item.get("ad_id", ""),
                    "country": country,
                    "scraped_at": datetime.now().isoformat(),
                    "local_media_paths": [],
                }
                all_ads.append(ad)

            logger.info(f"  Scroll {scroll_num+1}/{self.max_scrolls}: {len(all_ads)} ads total")

            if len(all_ads) >= max_ads:
                logger.info(f"  ✅ Reached max ({max_ads})")
                break

            if len(all_ads) == prev_count:
                no_new_count += 1
                if no_new_count >= 4:
                    logger.info(f"  ⏹️  No new ads after {no_new_count} scrolls")
                    break
            else:
                no_new_count = 0
                prev_count = len(all_ads)

            self._scroll_down()

        logger.info(f"✅ Found {len(all_ads)} ads for '{keyword}'")
        return all_ads[:max_ads]

    def batch_search(self, keywords: List[str], max_per_keyword: int = 30, active_only: bool = True, download_top: int = 5, country: str = "US") -> dict:
        logger.info(f"\n{'═'*60}\n📊 META AD LIBRARY BATCH — {len(keywords)} keywords\n{'═'*60}\n")
        results = {}
        total_ads = 0

        for i, keyword in enumerate(keywords):
            logger.info(f"\n── [{i+1}/{len(keywords)}] '{keyword}' ──")
            ads = self.search(keyword, max_ads=max_per_keyword, active_only=active_only, country=country)
            if ads:
                self.download_media(ads, keyword, top_n=download_top)
                self.save_ads(ads, keyword)
                results[keyword] = {
                    "ads_found": len(ads),
                    "top_advertiser": ads[0]["advertiser_name"] if ads else "",
                    "advertisers": list({a["advertiser_name"] for a in ads if a["advertiser_name"]})[:10],
                }
                total_ads += len(ads)
            if i < len(keywords) - 1:
                time.sleep(self.delay * 2)

        summary = {"keywords": keywords, "total_ads": total_ads, "results": results, "completed_at": datetime.now().isoformat()}
        self._print_summary(summary)
        return summary

    def download_media(self, ads: List[dict], keyword: str, top_n: int = 5) -> int:
        media_dir = self.storage.base_dir / "meta-ad-library" / "media" / keyword.lower().replace(" ", "-")
        media_dir.mkdir(parents=True, exist_ok=True)
        downloaded = 0
        for ad in ads[:top_n]:
            for i, url in enumerate(ad.get("media_urls", [])):
                if not url or url.startswith("blob:"):
                    continue
                ext = ".mp4" if ad.get("has_video") else ".jpg"
                filepath = media_dir / f"{ad['id']}_{i}{ext}"
                if filepath.exists():
                    ad["local_media_paths"].append(str(filepath))
                    continue
                try:
                    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"}
                    resp = requests.get(url, headers=headers, timeout=60, stream=True)
                    if resp.status_code == 200:
                        with open(filepath, "wb") as f:
                            for chunk in resp.iter_content(8192):
                                f.write(chunk)
                        ad["local_media_paths"].append(str(filepath))
                        downloaded += 1
                except Exception as e:
                    logger.debug(f"Download failed: {e}")
                time.sleep(0.3)
        logger.info(f"📥 Downloaded {downloaded} ad media files")
        return downloaded

    def save_ads(self, ads: List[dict], keyword: str):
        slug = keyword.lower().replace(" ", "-")
        ads_dir = self.storage.base_dir / "meta-ad-library" / "ads" / slug
        ads_dir.mkdir(parents=True, exist_ok=True)
        ads_file = ads_dir / "ads.json"
        existing = json.load(open(ads_file)) if ads_file.exists() else []
        existing_ids = {a["id"] for a in existing}
        new_ads = [a for a in ads if a["id"] not in existing_ids]
        merged = existing + new_ads
        with open(ads_file, "w") as f:
            json.dump(merged, f, indent=2)
        logger.info(f"💾 Saved {len(new_ads)} new ads ({len(merged)} total) → {ads_dir}")

    def load_ads(self, keyword: str) -> List[dict]:
        slug = keyword.lower().replace(" ", "-")
        ads_file = self.storage.base_dir / "meta-ad-library" / "ads" / slug / "ads.json"
        return json.load(open(ads_file)) if ads_file.exists() else []

    def analyze_ads(self, keyword: str) -> dict:
        ads = self.load_ads(keyword)
        if not ads:
            return {}

        advertisers: Dict[str, int] = {}
        for ad in ads:
            n = ad.get("advertiser_name", "")
            if n:
                advertisers[n] = advertisers.get(n, 0) + 1

        hooks = []
        for ad in ads:
            text = ad.get("ad_text", "")
            if text:
                first = text.split("\n")[0].strip()[:120]
                if len(first) > 10:
                    hooks.append(first)

        ctas: Dict[str, int] = {}
        for ad in ads:
            cta = ad.get("cta_text", "").strip()
            if cta:
                ctas[cta] = ctas.get(cta, 0) + 1

        has_video = sum(1 for a in ads if a.get("has_video"))
        has_image = sum(1 for a in ads if a.get("has_image") and not a.get("has_video"))

        platform_counts: Dict[str, int] = {}
        for ad in ads:
            for p in ad.get("platforms", []):
                platform_counts[p] = platform_counts.get(p, 0) + 1

        return {
            "keyword": keyword,
            "total_ads": len(ads),
            "unique_advertisers": len(advertisers),
            "top_advertisers": sorted(advertisers.items(), key=lambda x: x[1], reverse=True)[:10],
            "top_hooks": hooks[:10],
            "top_ctas": sorted(ctas.items(), key=lambda x: x[1], reverse=True)[:5],
            "media_breakdown": {"video": has_video, "image": has_image, "text_only": len(ads) - has_video - has_image},
            "platform_distribution": platform_counts,
            "analyzed_at": datetime.now().isoformat(),
        }

    def generate_report(self, keyword: str) -> str:
        ads = self.load_ads(keyword)
        if not ads:
            logger.warning(f"No ads for '{keyword}'. Run a search first.")
            return ""

        analysis = self.analyze_ads(keyword)
        report_dir = self.storage.base_dir / "meta-ad-library" / "reports"
        report_dir.mkdir(parents=True, exist_ok=True)
        date_str = datetime.now().strftime("%Y-%m-%d")
        slug = keyword.lower().replace(" ", "-")
        report_path = report_dir / f"{date_str}-{slug}.md"

        lines = [
            f"# Meta Ad Library Report: \"{keyword}\"",
            f"**Date:** {date_str} | **Ads:** {len(ads)} | **Advertisers:** {analysis.get('unique_advertisers',0)}",
            "", "---", "",
            "## Top Advertisers", "",
        ]
        for name, count in analysis.get("top_advertisers", []):
            lines.append(f"- **{name}** — {count} ad{'s' if count > 1 else ''}")

        lines += ["", "## Winning Ad Hooks", "", "*First lines of competitor ads:*", ""]
        for i, hook in enumerate(analysis.get("top_hooks", []), 1):
            lines.append(f"{i}. {hook}")

        lines += ["", "## CTA Distribution", ""]
        for cta, count in analysis.get("top_ctas", []):
            lines.append(f"- **{cta}** ({count}x)")

        media = analysis.get("media_breakdown", {})
        total = max(sum(media.values()), 1)
        lines += [
            "", "## Media Format Breakdown", "",
            "| Format | Count | % |", "|--------|-------|---|",
            f"| Video | {media.get('video',0)} | {media.get('video',0)*100//total}% |",
            f"| Image | {media.get('image',0)} | {media.get('image',0)*100//total}% |",
            f"| Text only | {media.get('text_only',0)} | {media.get('text_only',0)*100//total}% |",
            "", "## Platform Distribution", "",
        ]
        for p, c in sorted(analysis.get("platform_distribution", {}).items(), key=lambda x: x[1], reverse=True):
            lines.append(f"- **{p}**: {c} ads")

        lines += ["", "---", "", "## All Ads", ""]
        for i, ad in enumerate(ads[:30], 1):
            lines += [
                f"### Ad #{i} — {ad.get('advertiser_name','Unknown')}",
                f"**Started:** {ad.get('started_running','?')} | **Platforms:** {', '.join(ad.get('platforms',['?']))} | **CTA:** {ad.get('cta_text','?')} | {'🎥' if ad.get('has_video') else '🖼️' if ad.get('has_image') else '📝'}",
                "", f"> {(ad.get('ad_text','') or '')[:400]}", "",
                f"[Landing Page]({ad.get('landing_url','')})" if ad.get("landing_url") else "",
                "", "---", "",
            ]

        with open(report_path, "w") as f:
            f.write("\n".join(lines))
        logger.info(f"📝 Ad Library report → {report_path}")
        return str(report_path)

    def _print_summary(self, summary: dict):
        print(f"\n{'═'*60}\n📊 META AD LIBRARY COMPLETE\n{'═'*60}")
        print(f"  Total ads: {summary['total_ads']}")
        for kw, r in summary["results"].items():
            print(f"\n  📌 '{kw}': {r['ads_found']} ads | Top: {r['top_advertiser']}")
            if r.get("advertisers"):
                print(f"     Advertisers: {', '.join(r['advertisers'][:5])}")
        print(f"{'═'*60}")

    def show_status(self):
        base = self.storage.base_dir / "meta-ad-library" / "ads"
        if not base.exists():
            print("No Ad Library data yet. Run a search first.")
            return
        print(f"\n{'═'*60}\n📊 META AD LIBRARY STATUS\n{'═'*60}")
        total = 0
        for kw_dir in sorted(base.iterdir()):
            ads_file = kw_dir / "ads.json"
            if ads_file.exists():
                ads = json.load(open(ads_file))
                advertisers = list({a.get("advertiser_name","") for a in ads if a.get("advertiser_name")})
                print(f"\n  📌 '{kw_dir.name}' — {len(ads)} ads, {len(advertisers)} advertisers")
                print(f"     Top: {', '.join(advertisers[:4])}")
                total += len(ads)
        print(f"\n  Total: {total} ads\n{'═'*60}")
