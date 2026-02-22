-- ============================================================
-- DemandRadar: Safari Ad Library Scrape TEST
-- Standalone test — no API key required.
-- Opens Facebook Ad Library in Safari, scrolls, extracts data,
-- and displays what was found.
-- ============================================================

property SEARCH_QUERY : "fitness supplements"
property COUNTRY : "US"
property SCROLL_PASSES : 3

on run
	-- Build the Ad Library URL directly
	set adLibraryURL to "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=" & COUNTRY & "&is_targeted_country=false&media_type=all&q=" & urlEncode(SEARCH_QUERY) & "&search_type=keyword_unordered"
	
	log "Opening: " & adLibraryURL
	
	-- Step 1: Open Facebook Ad Library in Safari
	tell application "Safari"
		activate
		
		-- Open in a new tab
		tell window 1
			set current tab to (make new tab with properties {URL:adLibraryURL})
		end tell
	end tell
	
	-- Step 2: Wait for page to load
	log "Waiting for page to load..."
	delay 6
	
	-- Step 3: Dismiss cookie/login dialogs if present
	tell application "Safari"
		try
			do JavaScript "
				(function() {
					const btns = document.querySelectorAll('[aria-label=\"Close\"], [aria-label=\"Decline optional cookies\"], [aria-label=\"Allow all cookies\"], [data-testid=\"cookie-policy-manage-dialog-accept-button\"]');
					btns.forEach(b => b.click());
					return btns.length;
				})();
			" in document 1
		end try
	end tell
	
	delay 1
	
	-- Step 4: Scroll to load more ads
	log "Scrolling to load ads..."
	tell application "Safari"
		repeat SCROLL_PASSES times
			do JavaScript "window.scrollTo(0, document.body.scrollHeight);" in document 1
			delay 2.5
		end repeat
	end tell
	
	delay 1
	
	-- Step 5: Run extraction script
	log "Extracting ad data..."
	tell application "Safari"
		set extractionResult to do JavaScript "
(function() {
  var bodyText = document.body.innerText;
  
  // Total results
  var totalMatch = bodyText.match(/~?([\\d,]+)\\s+results?/i);
  var totalResults = totalMatch ? totalMatch[1] : '0';
  
  // Library IDs
  var libIdMatches = bodyText.match(/Library ID:\\s*\\d+/g) || [];
  var libraryIds = libIdMatches.map(function(m) { return m.replace('Library ID:', '').trim(); });
  
  // Start dates
  var dateMatches = bodyText.match(/Started running on\\s+[A-Za-z]+ \\d+, \\d+/g) || [];
  var startDates = dateMatches.map(function(m) { return m.replace('Started running on', '').trim(); });
  
  // Advertiser names (line before 'Sponsored')
  var lines = bodyText.split('\\n');
  var advertisers = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'Sponsored' && i > 0) {
      var name = lines[i-1].trim();
      if (name.length > 1 && name.length < 80 && name.indexOf('See ad') === -1 && name.indexOf('results') === -1) {
        advertisers.push(name);
      }
    }
  }
  // Dedupe
  advertisers = advertisers.filter(function(v, i, a) { return a.indexOf(v) === i; });
  
  // Ad copy blocks (text between 'Sponsored' and 'Library ID')
  var adCopyPattern = /Sponsored\\n([\\s\\S]*?)(?=Library ID:|Started running|$)/g;
  var copies = [];
  var match;
  while ((match = adCopyPattern.exec(bodyText)) !== null) {
    var block = match[1].trim();
    if (block.length > 10 && block.length < 2000) copies.push(block);
  }
  
  // Impression levels
  var impressionMatches = bodyText.match(/(Low|Medium|High|Very High)\\s+impression/gi) || [];
  
  // CTA buttons
  var ctaButtons = [];
  var btns = document.querySelectorAll('a[role=\"button\"], button');
  var ctaList = ['Shop Now','Learn More','Sign Up','Get Offer','Book Now','Download','Contact Us','Apply Now','Subscribe','Watch More','Order Now','Try Now','Start Free Trial'];
  for (var b = 0; b < btns.length; b++) {
    var txt = btns[b].innerText ? btns[b].innerText.trim() : '';
    if (ctaList.indexOf(txt) !== -1 && ctaButtons.indexOf(txt) === -1) ctaButtons.push(txt);
  }
  
  // Landing page links
  var adLinks = [];
  var anchors = document.querySelectorAll('a[href*=\"l.facebook.com\"], a[href*=\"fb.me\"]');
  for (var a = 0; a < anchors.length; a++) {
    var href = anchors[a].href;
    if (href && href.indexOf('ads/library') === -1) adLinks.push(href);
  }
  
  // Page title and URL for verification
  var pageUrl = window.location.href;
  var pageTitle = document.title;
  
  return JSON.stringify({
    success: true,
    pageTitle: pageTitle,
    pageUrl: pageUrl,
    query: '" & SEARCH_QUERY & "',
    country: '" & COUNTRY & "',
    totalResults: totalResults,
    libraryIdsCount: libraryIds.length,
    libraryIds: libraryIds.slice(0, 20),
    advertisersCount: advertisers.length,
    advertisers: advertisers.slice(0, 20),
    startDatesCount: startDates.length,
    startDates: startDates.slice(0, 10),
    adCopyCount: copies.length,
    sampleAdCopy: copies.slice(0, 5),
    impressions: impressionMatches.slice(0, 10),
    ctaButtons: ctaButtons,
    landingLinks: adLinks.slice(0, 10),
    scrapedAt: new Date().toISOString(),
    bodyTextLength: bodyText.length
  }, null, 2);
})();
" in document 1
	end tell
	
	-- Step 6: Parse results for summary
	set totalResults to extractJSONValue(extractionResult, "totalResults")
	set libCount to extractJSONValue(extractionResult, "libraryIdsCount")
	set advCount to extractJSONValue(extractionResult, "advertisersCount")
	set adCopyCount to extractJSONValue(extractionResult, "adCopyCount")
	set bodyLen to extractJSONValue(extractionResult, "bodyTextLength")
	set pageTitle to extractJSONValue(extractionResult, "pageTitle")
	
	-- Show summary
	set summaryMsg to "Safari Ad Library Scrape Results" & return & return & ¬
		"Page Title: " & pageTitle & return & ¬
		"Query: " & SEARCH_QUERY & return & ¬
		"Country: " & COUNTRY & return & ¬
		"Total Results on Page: ~" & totalResults & return & return & ¬
		"--- Extracted Data ---" & return & ¬
		"Library IDs found: " & libCount & return & ¬
		"Unique Advertisers: " & advCount & return & ¬
		"Ad Copy Blocks: " & adCopyCount & return & ¬
		"Page Text Length: " & bodyLen & " chars" & return & return & ¬
		"Scroll passes: " & SCROLL_PASSES
	
	display dialog summaryMsg buttons {"View Full JSON", "Done"} default button "Done"
	
	if button returned of result is "View Full JSON" then
		-- Show first 3000 chars of raw JSON
		if length of extractionResult > 3000 then
			set shortResult to text 1 thru 3000 of extractionResult
		else
			set shortResult to extractionResult
		end if
		display dialog shortResult buttons {"Copy to Clipboard", "OK"} default button "OK"
		if button returned of result is "Copy to Clipboard" then
			set the clipboard to extractionResult
		end if
	end if
	
	-- Also write full JSON to a temp file for inspection
	set tmpFile to "/tmp/demandradar_safari_scrape_test.json"
	do shell script "cat > " & tmpFile & " << 'ENDJSON'\n" & extractionResult & "\nENDJSON"
	log "Full JSON written to: " & tmpFile
	
	return extractionResult
end run

-- ── Helper: Extract a string value from flat JSON ─────────────
on extractJSONValue(jsonStr, keyName)
	set searchKey to "\"" & keyName & "\":"
	set keyPos to offset of searchKey in jsonStr
	if keyPos is 0 then return "?"
	
	set afterKey to text (keyPos + (length of searchKey)) thru -1 of jsonStr
	set afterKey to trimLeft(afterKey)
	
	if afterKey starts with "\"" then
		set afterKey to text 2 thru -1 of afterKey
		set endPos to offset of "\"" in afterKey
		if endPos > 0 then
			return text 1 thru (endPos - 1) of afterKey
		end if
	else
		set endPos1 to offset of "," in afterKey
		set endPos2 to offset of "}" in afterKey
		set endPos to endPos1
		if endPos2 > 0 and (endPos2 < endPos1 or endPos1 is 0) then set endPos to endPos2
		if endPos > 0 then
			return trimRight(text 1 thru (endPos - 1) of afterKey)
		end if
	end if
	return "?"
end extractJSONValue

-- ── Helper: URL-encode a string ──────────────────────────────
on urlEncode(str)
	set encoded to do shell script "python3 -c \"import urllib.parse; print(urllib.parse.quote('" & str & "'))\""
	return encoded
end urlEncode

-- ── Helper: Trim leading whitespace ──────────────────────────
on trimLeft(str)
	set i to 1
	repeat while i ≤ (length of str) and character i of str is in {" ", tab, return, linefeed}
		set i to i + 1
	end repeat
	if i > length of str then return ""
	return text i thru -1 of str
end trimLeft

-- ── Helper: Trim trailing whitespace ─────────────────────────
on trimRight(str)
	set i to length of str
	repeat while i ≥ 1 and character i of str is in {" ", tab, return, linefeed}
		set i to i - 1
	end repeat
	if i < 1 then return ""
	return text 1 thru i of str
end trimRight
