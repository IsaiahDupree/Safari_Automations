-- ============================================================
-- DemandRadar: Facebook Ad Library Safari Automation
-- ============================================================
-- SETUP (one-time):
--   1. In Safari: Develop menu > "Allow JavaScript from Apple Events"
--      (If Develop menu is hidden: Safari > Settings > Advanced > Show Develop menu)
--   2. Fill in YOUR_API_KEY and BASE_URL below
--   3. Open Script Editor (Applications > Utilities > Script Editor)
--   4. Paste this script and click Run (or save as .app to run anytime)
-- ============================================================

-- ── Configuration ────────────────────────────────────────────
property BASE_URL : "http://localhost:3001"
property API_KEY : "YOUR_API_KEY_HERE"

-- ── Search Parameters ─────────────────────────────────────────
-- Edit these to control what ads you search for
property SEARCH_QUERY : "fitness supplements"
property COUNTRY : "US"
property AD_STATUS : "active"
property MEDIA_TYPE : "all"
property PLATFORMS : "facebook,instagram"
property LANGUAGE : "en"
property START_DATE_MIN : ""
property START_DATE_MAX : ""
property AD_TYPE : "all"
property PAGE_ID : ""
property SCROLL_PASSES : 3

-- ── Main Script ───────────────────────────────────────────────
on run
	-- Step 1: Get the Ad Library URL + extraction script from DemandRadar API
	set apiParams to "q=" & urlEncode(SEARCH_QUERY) & ¬
		"&country=" & COUNTRY & ¬
		"&status=" & AD_STATUS & ¬
		"&media=" & MEDIA_TYPE & ¬
		"&platforms=" & PLATFORMS & ¬
		"&mode=url_only"
	
	if LANGUAGE is not "" then
		set apiParams to apiParams & "&language=" & LANGUAGE
	end if
	if START_DATE_MIN is not "" then
		set apiParams to apiParams & "&startDateMin=" & START_DATE_MIN
	end if
	if START_DATE_MAX is not "" then
		set apiParams to apiParams & "&startDateMax=" & START_DATE_MAX
	end if
	if AD_TYPE is not "all" then
		set apiParams to apiParams & "&adType=" & AD_TYPE
	end if
	if PAGE_ID is not "" then
		set apiParams to apiParams & "&pageId=" & PAGE_ID
	end if
	
	set apiURL to BASE_URL & "/api/v1/facebook-ads?" & apiParams
	
	-- Fetch URL + extraction script from DemandRadar
	set curlGetCmd to "curl -s -H 'Authorization: Bearer " & API_KEY & "' '" & apiURL & "'"
	set apiResponse to do shell script curlGetCmd
	
	-- Extract the adLibraryUrl from JSON response
	set adLibraryURL to extractJSONValue(apiResponse, "adLibraryUrl")
	
	if adLibraryURL is "" then
		display dialog "Error: Could not get Ad Library URL from DemandRadar API." & return & return & ¬
			"Response: " & text 1 thru (min(300, length of apiResponse)) of apiResponse ¬
			buttons {"OK"} default button "OK" with icon stop
		return
	end if
	
	-- Step 2: Open Facebook Ad Library in Safari
	tell application "Safari"
		activate
		open location adLibraryURL
	end tell
	
	-- Wait for page to load
	delay 4
	
	-- Step 3: Scroll to load more ads
	tell application "Safari"
		repeat SCROLL_PASSES times
			do JavaScript "window.scrollTo(0, document.body.scrollHeight);" in document 1
			delay 2
		end repeat
		
		-- Extra wait after last scroll
		delay 1
		
		-- Step 4: Run extraction script in the page
		set extractionScript to "(function() {
  var bodyText = document.body.innerText;
  var libraryIds = (bodyText.match(/Library ID:\\s*\\d+/g) || []).map(function(m) { return m.replace('Library ID:', '').trim(); });
  var startDates = (bodyText.match(/Started running on\\s+[A-Za-z]+ \\d+, \\d+/g) || []).map(function(m) { return m.replace('Started running on', '').trim(); });
  var lines = bodyText.split('\\n');
  var advertisers = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'Sponsored' && i > 0) {
      var name = lines[i-1].trim();
      if (name.length > 1 && name.length < 80 && name.indexOf('See ad') === -1 && name.indexOf('results') === -1) advertisers.push(name);
    }
  }
  advertisers = advertisers.filter(function(v, i, a) { return a.indexOf(v) === i; });
  var adCopyPattern = /Sponsored\\n([\\s\\S]*?)(?=Library ID:|Started running|$)/g;
  var copies = []; var match;
  while ((match = adCopyPattern.exec(bodyText)) !== null) {
    var block = match[1].trim();
    if (block.length > 10 && block.length < 2000) copies.push(block);
  }
  var activeStatuses = (bodyText.match(/\\n(Active|Inactive)\\n/g) || []).map(function(s) { return s.trim(); });
  var ctaTerms = ['Shop now','Shop Now','Learn more','Learn More','Sign up','Sign Up','Get offer','Get Offer','Book now','Book Now','Download','Contact us','Contact Us','Apply now','Apply Now','Subscribe','Order now','Order Now'];
  var ctaResults = []; var allDS = document.querySelectorAll('div, span');
  for (var d = 0; d < allDS.length; d++) {
    var txt = (allDS[d].innerText || '').trim();
    if (txt.length > 2 && txt.length < 30 && ctaTerms.indexOf(txt) !== -1 && (ctaResults.length === 0 || ctaResults[ctaResults.length-1] !== txt)) ctaResults.push(txt);
  }
  var adLinks = []; var anchors = document.querySelectorAll('a[href*=\"l.facebook.com\"], a[href*=\"fb.me\"]');
  for (var a = 0; a < anchors.length; a++) { var href = anchors[a].href; if (href && href.indexOf('ads/library') === -1) adLinks.push(href); }
  return JSON.stringify({
    query: '" & SEARCH_QUERY & "',
    country: '" & COUNTRY & "',
    totalResults: (bodyText.match(/~?([\\d,]+)\\s+results?/i) || ['','0'])[1],
    libraryIds: libraryIds.slice(0, 100),
    startDates: startDates.slice(0, 100),
    advertisers: advertisers.slice(0, 100),
    sampleAdCopy: copies.slice(0, 100),
    activeStatuses: activeStatuses.slice(0, 100),
    ctaButtons: ctaResults.slice(0, 100),
    landingLinks: adLinks.slice(0, 100),
    scrapedAt: new Date().toISOString()
  });
})();"
		
		set rawJSON to do JavaScript extractionScript in document 1
	end tell
	
	-- Step 5: POST scraped data back to DemandRadar API
	set postEndpoint to BASE_URL & "/api/v1/facebook-ads"
	set postBody to "{\"rawData\": " & rawJSON & "}"
	
	-- Write body to temp file to avoid shell escaping issues
	set tmpFile to "/tmp/demandradar_fb_ads.json"
	do shell script "echo " & quoted form of postBody & " > " & tmpFile
	
	set curlPostCmd to "curl -s -X POST '" & postEndpoint & "' " & ¬
		"-H 'Authorization: Bearer " & API_KEY & "' " & ¬
		"-H 'Content-Type: application/json' " & ¬
		"-d @" & tmpFile
	
	set postResponse to do shell script curlPostCmd
	
	-- Step 6: Extract summary from response
	set adsExtracted to extractJSONValue(postResponse, "adsExtracted")
	set totalResults to extractJSONValue(postResponse, "totalResults")
	
	-- Show result summary
	set summaryMsg to "Facebook Ad Scrape Complete!" & return & return & ¬
		"Query: " & SEARCH_QUERY & return & ¬
		"Country: " & COUNTRY & return & ¬
		"Total results on page: " & totalResults & return & ¬
		"Ads extracted & saved: " & adsExtracted & return & return & ¬
		"Data sent to DemandRadar API ✓"
	
	display dialog summaryMsg buttons {"View Raw JSON", "Done"} default button "Done"
	
	if button returned of result is "View Raw JSON" then
		set shortResponse to text 1 thru (min(2000, length of postResponse)) of postResponse
		display dialog shortResponse buttons {"OK"} default button "OK"
	end if
	
	-- Clean up temp file
	do shell script "rm -f " & tmpFile
	
	return postResponse
end run

-- ── Helper: Extract a string value from flat JSON ─────────────
on extractJSONValue(jsonStr, keyName)
	set searchKey to "\"" & keyName & "\":"
	set keyPos to offset of searchKey in jsonStr
	if keyPos is 0 then return ""
	
	set afterKey to text (keyPos + (length of searchKey)) thru -1 of jsonStr
	-- Trim leading whitespace
	set afterKey to trimLeft(afterKey)
	
	if afterKey starts with "\"" then
		-- String value
		set afterKey to text 2 thru -1 of afterKey
		set endPos to offset of "\"" in afterKey
		if endPos > 0 then
			return text 1 thru (endPos - 1) of afterKey
		end if
	else
		-- Number or boolean value
		set endPos1 to offset of "," in afterKey
		set endPos2 to offset of "}" in afterKey
		set endPos to endPos1
		if endPos2 > 0 and (endPos2 < endPos1 or endPos1 is 0) then set endPos to endPos2
		if endPos > 0 then
			return trimRight(text 1 thru (endPos - 1) of afterKey)
		end if
	end if
	return ""
end extractJSONValue

-- ── Helper: URL-encode a string (basic) ──────────────────────
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
