/**
 * Ad Library Browser Scripts
 *
 * Self-contained JavaScript snippets executable in ANY browser context:
 *   - Playwright: page.evaluate(SCRIPTS.extractAllAds)
 *   - AppleScript: do JavaScript SCRIPTS.extractAllAds in document 1
 *   - Browser console: copy-paste
 *
 * Every export is either a string constant (for static scripts) or a
 * function that returns a string (for parameterised scripts).
 * All scripts are IIFEs that return a JSON string or a status string.
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Helper: common dialog / scroll / dismiss
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Dismiss cookie / login dialogs. */
export const DISMISS_DIALOGS = `(function(){
  var sels=['[aria-label="Close"]','[data-testid="cookie-policy-manage-dialog-accept-button"]','button[title="Close"]','[aria-label="Decline optional cookies"]'];
  var n=0;for(var s=0;s<sels.length;s++){var el=document.querySelector(sels[s]);if(el&&el.offsetHeight>0){el.click();n++;}}
  return n>0?'ok:dismissed '+n+' dialogs':'ok:no dialogs';
})();`;

/** Scroll to the bottom of the page. */
export const SCROLL_TO_BOTTOM = `(function(){
  window.scrollTo(0,document.body.scrollHeight);
  return 'ok:scrolled to '+document.body.scrollHeight;
})();`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Full ad-data extraction
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Extract all ad data from the current page. Returns JSON string. */
export const EXTRACT_ALL_ADS = `(function(){
  var bodyText=document.body.innerText;
  var totalMatch=bodyText.match(/~?([\\d,]+)\\s+results?/i);
  var totalResults=totalMatch?totalMatch[1]:'0';
  var libraryIds=(bodyText.match(/Library ID:\\s*\\d+/g)||[]).map(function(m){return m.replace('Library ID:','').trim();});
  var startDates=(bodyText.match(/Started running on\\s+[A-Za-z]+ \\d+, \\d+/g)||[]).map(function(m){return m.replace('Started running on','').trim();});
  var lines=bodyText.split('\\n');var advertisers=[];
  for(var i=0;i<lines.length;i++){if(lines[i].trim()==='Sponsored'&&i>0){var name=lines[i-1].trim();if(name.length>1&&name.length<80&&name.indexOf('See ad')===-1&&name.indexOf('results')===-1)advertisers.push(name);}}
  advertisers=advertisers.filter(function(v,i,a){return a.indexOf(v)===i;});
  var adCopyPattern=/Sponsored\\n([\\s\\S]*?)(?=Library ID:|Started running|$)/g;var copies=[];var match;
  while((match=adCopyPattern.exec(bodyText))!==null){var block=match[1].trim();if(block.length>10&&block.length<2000)copies.push(block);}
  var activeStatuses=(bodyText.match(/\\n(Active|Inactive)\\n/g)||[]).map(function(s){return s.trim();});
  var ctaTerms=['Shop now','Shop Now','Learn more','Learn More','Sign up','Sign Up','Get offer','Get Offer','Book now','Book Now','Download','Contact us','Contact Us','Apply now','Apply Now','Subscribe','Watch more','Watch More','Order now','Order Now','Try now','Try Now','Start Free Trial','Get started','Get Started','See more','See More'];
  var ctaResults=[];var allDS=document.querySelectorAll('div, span');
  for(var d=0;d<allDS.length;d++){var txt=(allDS[d].innerText||'').trim();if(txt.length>2&&txt.length<30&&ctaTerms.indexOf(txt)!==-1&&(ctaResults.length===0||ctaResults[ctaResults.length-1]!==txt))ctaResults.push(txt);}
  var adLinks=[];var anchors=document.querySelectorAll('a[href*="l.facebook.com"],a[href*="fb.me"]');
  for(var a=0;a<anchors.length;a++){var href=anchors[a].href;if(href&&href.indexOf('ads/library')===-1)adLinks.push(href);}
  var domainPattern=/\\n([A-Z][A-Z0-9-]+\\.[A-Z]{2,})\\n/g;var domains=[];
  while((match=domainPattern.exec(bodyText))!==null){var dom=match[1].trim();if(dom.length>3&&dom.length<60&&dom.indexOf(' ')===-1)domains.push(dom);}
  var headlinePattern=/[A-Z][A-Z0-9-]+\\.[A-Z]{2,}\\n(.+?)\\n(.+?)\\n(?:Shop now|Learn more|Sign up|Get offer|Book now|Download|Contact us|Apply now|Subscribe|Order now)/gi;
  var headlines=[];while((match=headlinePattern.exec(bodyText))!==null&&headlines.length<200){headlines.push({title:match[1].trim(),description:match[2].trim()});}
  var adImages=[];var imgs=document.querySelectorAll('img');
  for(var im=0;im<imgs.length;im++){var src=imgs[im].src||'';var w=imgs[im].naturalWidth||imgs[im].width||0;var h=imgs[im].naturalHeight||imgs[im].height||0;var alt=imgs[im].alt||'';if(w>=200&&h>=200&&src.indexOf('fbcdn.net')!==-1)adImages.push({src:src,alt:alt,w:w,h:h});}
  var adVideos=[];var vids=document.querySelectorAll('video');
  for(var v=0;v<vids.length;v++){adVideos.push({poster:vids[v].poster||'',src:vids[v].src||'',duration:vids[v].duration||0,width:vids[v].videoWidth||0,height:vids[v].videoHeight||0});}
  var advertiserProfiles=[];var allAnchors=document.querySelectorAll('a');var seenProfiles={};
  for(var ap=0;ap<allAnchors.length;ap++){var href2=allAnchors[ap].href||'';var txt2=(allAnchors[ap].innerText||'').trim();var pageMatch=href2.match(/facebook\\.com\\/([a-zA-Z0-9._-]+)\\/?$/);if(pageMatch&&txt2.length>1&&txt2.length<60&&!seenProfiles[href2]&&href2.indexOf('ads/library')===-1&&href2.indexOf('l.facebook.com')===-1&&txt2!=='Log in'&&txt2!=='Privacy'&&txt2!=='Terms'&&txt2!=='FAQ'&&txt2!=='Cookies'&&txt2!=='About ads and data use'){seenProfiles[href2]=true;advertiserProfiles.push({name:txt2,slug:pageMatch[1],url:href2,isNumericId:/^\\d+$/.test(pageMatch[1])});}}
  var multiVersionCount=0;var allSpans=document.querySelectorAll('span');
  for(var mv=0;mv<allSpans.length;mv++){if((allSpans[mv].innerText||'').trim()==='This ad has multiple versions')multiVersionCount++;}
  var sharedCreatives=[];for(var sc=0;sc<allSpans.length;sc++){var scMatch=(allSpans[sc].innerText||'').match(/(\\d+) ads? use this creative/);if(scMatch)sharedCreatives.push(parseInt(scMatch[1]));}
  var maskDivs=document.querySelectorAll('div[style*="mask-image"]');var platformsByY={};
  for(var pd=0;pd<maskDivs.length;pd++){var rect=maskDivs[pd].getBoundingClientRect();if(rect.width===12&&rect.height===12&&rect.y>200){var yBucket=Math.round(rect.y/10)*10;platformsByY[yBucket]=(platformsByY[yBucket]||0)+1;}}
  var platformCounts=[];for(var y in platformsByY)platformCounts.push(platformsByY[y]);
  var prices=bodyText.match(/[\\$\\u20AC\\u00A3\\u20B9]\\s*[\\d,.]+/g)||[];
  var videoDurations=bodyText.match(/\\d+:\\d+\\s*\\/\\s*\\d+:\\d+/g)||[];
  var filterChips=[];var chipPatterns=[/Active status:\\s*[^\\n]+/,/Platform:\\s*[^\\n]+/,/Language:\\s*[^\\n]+/,/Impressions by date:\\s*[^\\n]+/];
  for(var cp=0;cp<chipPatterns.length;cp++){var chipMatch=bodyText.match(chipPatterns[cp]);if(chipMatch)filterChips.push(chipMatch[0].replace(/\\s*Remove.*/,'').trim());}
  return JSON.stringify({totalResults:totalResults,libraryIds:libraryIds.slice(0,200),startDates:startDates.slice(0,200),advertisers:advertisers.slice(0,200),sampleAdCopy:copies.slice(0,200),activeStatuses:activeStatuses.slice(0,200),ctaButtons:ctaResults.slice(0,200),landingLinks:adLinks.slice(0,200),landingDomains:domains.slice(0,200),headlines:headlines.slice(0,200),creativeImages:adImages.slice(0,200),videos:adVideos.slice(0,200),advertiserProfiles:advertiserProfiles.slice(0,200),multiVersionCount:multiVersionCount,sharedCreatives:sharedCreatives.slice(0,200),platformIconCounts:platformCounts.slice(0,200),prices:prices.slice(0,200),videoDurations:videoDurations.slice(0,200),filterChips:filterChips,scrapedAt:new Date().toISOString(),pageUrl:window.location.href,pageTitle:document.title});
})();`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Filter bar state reader
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Read the top filter bar state + any active filter chips. Returns JSON. */
export const READ_FILTER_STATE = `(function(){
  var combos=document.querySelectorAll('[role="combobox"]');
  var country='',adCategory='',sortOrder='';
  for(var c=0;c<combos.length;c++){var txt=(combos[c].textContent||'').replace(/[\\u200B\\u200C\\u200D\\uFEFF]/g,'').trim();var r=combos[c].getBoundingClientRect();if(r.x<200){if(txt.indexOf('United')!==-1||txt.indexOf('States')!==-1||txt.indexOf('Kingdom')!==-1)country=txt;else if(txt.indexOf('All ads')!==-1||txt.indexOf('Issues')!==-1||txt.indexOf('Housing')!==-1)adCategory=txt;}else if(txt.indexOf('Sort by')!==-1)sortOrder=txt.replace('Sort by','').trim();}
  var searchEl=document.querySelector('input[type="search"]');var searchQuery=searchEl?searchEl.value:'';
  var bodyText=document.body.innerText;var activeFilters=[];
  var chipPatterns=[/Active status:\\s*\\S+ ads/g,/Platform:\\s*[^\\n]+?(?=\\s*Remove)/g,/Language:\\s*[^\\n]+?(?=\\s*Remove)/g,/Impressions by date:\\s*[^\\n]+?(?=\\s*Remove)/g];
  for(var p=0;p<chipPatterns.length;p++){var matches=bodyText.match(chipPatterns[p])||[];var seen={};for(var m=0;m<matches.length;m++){if(!seen[matches[m]]){seen[matches[m]]=true;activeFilters.push(matches[m].trim());}}}
  var totalMatch=bodyText.match(/~?([\\d,]+)\\s+results?/i);
  return JSON.stringify({country:country,adCategory:adCategory,searchQuery:searchQuery,sortOrder:sortOrder,activeFilters:activeFilters,totalResults:totalMatch?totalMatch[0]:''});
})();`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Top filter bar interactions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Type a new query into the search box and press Enter. */
export function changeSearch(query: string): string {
  return `(function(){
  var el=document.querySelector('input[type="search"][placeholder="Search by keyword or advertiser"]');
  if(!el)el=document.querySelector('input[placeholder*="keyword"]');
  if(!el)return 'error:search input not found';
  el.focus();
  var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(el,${JSON.stringify(query)});
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));
  return 'ok:search changed';
})();`;
}

/** Click the Clear (✕) button on the search input. */
export const CLEAR_SEARCH = `(function(){
  var btn=document.querySelector('div[role="button"][aria-label="Clear"]');
  if(btn){btn.click();return 'ok:search cleared';}
  return 'error:clear button not found';
})();`;

/** Set the ad category via URL param navigation. */
export function selectAdCategory(value: string): string {
  return `(function(){
  var url=new URL(window.location.href);url.searchParams.set('ad_type',${JSON.stringify(value)});
  window.location.href=url.toString();return 'ok:navigating to ad_type=${value}';
})();`;
}

/** Set the country via URL param navigation. */
export function selectCountry(countryCode: string): string {
  return `(function(){
  var url=new URL(window.location.href);url.searchParams.set('country',${JSON.stringify(countryCode)});
  window.location.href=url.toString();return 'ok:navigating to country=${countryCode}';
})();`;
}

/** Open the Sort combobox and select an option by label. Returns a two-step script. */
export function selectSort(label: string): string {
  return `(function(){
  var combos=document.querySelectorAll('[role="combobox"]');var clicked=false;
  for(var c=0;c<combos.length;c++){if((combos[c].innerText||'').indexOf('Sort by')!==-1){combos[c].click();clicked=true;break;}}
  if(!clicked)return 'error:sort combobox not found';
  return new Promise(function(resolve){setTimeout(function(){
    var opts=document.querySelectorAll('[role="option"]');
    for(var o=0;o<opts.length;o++){if((opts[o].innerText||'').trim()===${JSON.stringify(label)}){opts[o].click();resolve('ok:selected ${label}');return;}}
    resolve('error:option not found');
  },500);});
})();`;
}

/** Remove a specific filter chip by its text pattern. */
export function removeFilterChip(chipTextPattern: string): string {
  return `(function(){
  var allDivs=document.querySelectorAll('div');
  for(var i=0;i<allDivs.length;i++){var txt=(allDivs[i].innerText||'').trim();
    if(txt.indexOf(${JSON.stringify(chipTextPattern)})!==-1&&txt.indexOf('Remove')!==-1&&txt.length<200){
      var btns=allDivs[i].querySelectorAll('div[role="none"]');
      for(var c=0;c<btns.length;c++){if((btns[c].textContent||'').indexOf('Remove')!==-1){btns[c].click();return 'ok:removed chip';}}}}
  return 'error:chip not found';
})();`;
}

/** Click "Clear all" to remove all active filter chips. */
export const CLEAR_ALL_FILTER_CHIPS = `(function(){
  var allEls=document.querySelectorAll('div, span');
  for(var i=0;i<allEls.length;i++){var txt=(allEls[i].innerText||'').trim();var r=allEls[i].getBoundingClientRect();
    if(txt==='Clear all'&&r.y>200&&r.y<400&&r.height>10&&r.height<50){allEls[i].click();return 'ok:cleared all';}}
  return 'error:Clear all not found';
})();`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Filters Panel interactions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Open the Filters panel dialog. */
export const OPEN_FILTERS_PANEL = `(function(){
  var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null,false);
  while(walker.nextNode()){
    if(walker.currentNode.textContent.trim()==='Filters'){
      var el=walker.currentNode.parentElement;
      var target=el;
      for(var i=0;i<5;i++){if(target.parentElement)target=target.parentElement;
        var r=target.getBoundingClientRect();
        if(r.width>50&&r.height>25&&r.y>150&&r.y<300){target.click();return 'ok:opened filters panel';}}
      el.click();return 'ok:clicked filters text';}}
  return 'error:Filters button not found';
})();`;

/** Close the Filters panel dialog via the Close (✕) button. */
export const CLOSE_FILTERS_PANEL = `(function(){
  var allEls=document.querySelectorAll('*');
  for(var i=0;i<allEls.length;i++){
    if(allEls[i].getAttribute('role')==='button'&&(allEls[i].textContent||'').trim().indexOf('Close')!==-1){
      var r=allEls[i].getBoundingClientRect();
      if(r.y>150&&r.y<280&&r.x>900){allEls[i].click();return 'ok:closed panel';}}}
  return 'error:close button not found';
})();`;

/** Read the current state of all Filters panel fields. Returns JSON. */
export const READ_FILTERS_PANEL_STATE = `(function(){
  var combos=document.querySelectorAll('div[role="combobox"]');
  var state={language:'',advertiser:'',platform:'',mediaType:'',activeStatus:'',dateFrom:'',dateTo:''};
  for(var c=0;c<combos.length;c++){
    var txt=(combos[c].textContent||'').replace(/[\\u200B]/g,'').trim();
    var r=combos[c].getBoundingClientRect();
    if(r.x<400)continue;
    if(r.y>260&&r.y<320)state.language=txt;
    else if(r.y>340&&r.y<380)state.advertiser=txt;
    else if(r.y>410&&r.y<460)state.platform=txt;
    else if(r.y>490&&r.y<530)state.mediaType=txt;
    else if(r.y>560&&r.y<610)state.activeStatus=txt;
  }
  var dateInputs=document.querySelectorAll('input[placeholder="mm/dd/yyyy"]');
  if(dateInputs[0])state.dateFrom=dateInputs[0].value;
  if(dateInputs[1])state.dateTo=dateInputs[1].value;
  return JSON.stringify(state);
})();`;

/**
 * Select an option from a Filters panel combobox dropdown.
 * @param fieldLabel one of: 'language', 'advertiser', 'platform', 'mediaType', 'activeStatus'
 * @param optionLabel the visible option text to click (e.g. "English", "Facebook", "Videos")
 */
export function selectFiltersPanelOption(
  fieldLabel: 'language' | 'advertiser' | 'platform' | 'mediaType' | 'activeStatus',
  optionLabel: string
): string {
  // Map fieldLabel to approximate y-ranges for the combobox (discovered from live DOM)
  const yRanges: Record<string, [number, number]> = {
    language: [260, 320],
    advertiser: [340, 380],
    platform: [410, 460],
    mediaType: [490, 530],
    activeStatus: [560, 610],
  };
  const [yMin, yMax] = yRanges[fieldLabel];
  return `(function(){
  var combos=document.querySelectorAll('div[role="combobox"]');var clicked=false;
  for(var c=0;c<combos.length;c++){var r=combos[c].getBoundingClientRect();
    if(r.x>400&&r.y>${yMin}&&r.y<${yMax}){combos[c].click();clicked=true;break;}}
  if(!clicked)return 'error:${fieldLabel} combobox not found';
  return new Promise(function(resolve){setTimeout(function(){
    var opts=document.querySelectorAll('[role="option"]');
    for(var o=0;o<opts.length;o++){
      var txt=(opts[o].textContent||'').trim();
      if(txt===${JSON.stringify(optionLabel)}||txt.indexOf(${JSON.stringify(optionLabel)})===0){
        opts[o].click();resolve('ok:selected ${optionLabel} in ${fieldLabel}');return;}}
    resolve('error:option ${optionLabel} not found in ${fieldLabel}');
  },600);});
})();`;
}

/**
 * Type a search term in the Advertiser combobox search input.
 * After calling this, the advertiser list will filter. Then call
 * selectFiltersPanelOption('advertiser', 'AdvertiserName') to pick one.
 */
export function searchFiltersPanelAdvertiser(searchTerm: string): string {
  return `(function(){
  var combos=document.querySelectorAll('div[role="combobox"]');
  for(var c=0;c<combos.length;c++){var r=combos[c].getBoundingClientRect();var txt=(combos[c].textContent||'').trim();
    if(r.x>400&&(txt.indexOf('advertisers')!==-1||txt.indexOf('advertiser')!==-1)){combos[c].click();break;}}
  return new Promise(function(resolve){setTimeout(function(){
    var inputs=document.querySelectorAll('input[type="text"]');var typed=false;
    for(var i=0;i<inputs.length;i++){var ir=inputs[i].getBoundingClientRect();
      if(ir.y>380&&ir.y<450&&ir.x>400){
        inputs[i].focus();
        var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        setter.call(inputs[i],${JSON.stringify(searchTerm)});
        inputs[i].dispatchEvent(new Event('input',{bubbles:true}));
        typed=true;break;}}
    resolve(typed?'ok:typed ${searchTerm} in advertiser search':'error:advertiser search input not found');
  },600);});
})();`;
}

/**
 * Set the "From" date in the Filters panel.
 * @param dateStr Date in mm/dd/yyyy format (e.g. "01/01/2025")
 */
export function setFiltersPanelDateFrom(dateStr: string): string {
  return `(function(){
  var inputs=document.querySelectorAll('input[placeholder="mm/dd/yyyy"]');
  if(!inputs[0])return 'error:From date input not found';
  var el=inputs[0];el.focus();el.select();
  var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(el,${JSON.stringify(dateStr)});
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));
  return 'ok:set From date to ${dateStr}';
})();`;
}

/**
 * Set the "To" date in the Filters panel.
 * @param dateStr Date in mm/dd/yyyy format (e.g. "12/31/2025")
 */
export function setFiltersPanelDateTo(dateStr: string): string {
  return `(function(){
  var inputs=document.querySelectorAll('input[placeholder="mm/dd/yyyy"]');
  if(!inputs[1])return 'error:To date input not found';
  var el=inputs[1];el.focus();el.select();
  var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(el,${JSON.stringify(dateStr)});
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));
  return 'ok:set To date to ${dateStr}';
})();`;
}

/** Click "Apply N filter(s)" in the Filters panel. */
export const APPLY_FILTERS_PANEL = `(function(){
  var allDivs=document.querySelectorAll('div[role="none"]');
  for(var a=0;a<allDivs.length;a++){var t=(allDivs[a].innerText||'').trim();
    if(t.indexOf('Apply')!==-1&&t.indexOf('filter')!==-1){allDivs[a].click();return 'ok:applied filters ('+t+')';}}
  return 'error:Apply button not found';
})();`;

/** Click "Clear all" inside the Filters panel (resets all fields). */
export const CLEAR_FILTERS_PANEL = `(function(){
  var allDivs=document.querySelectorAll('div[role="none"]');
  for(var a=0;a<allDivs.length;a++){var t=(allDivs[a].innerText||'').trim();var r=allDivs[a].getBoundingClientRect();
    if(t==='Clear all'&&r.y>700){allDivs[a].click();return 'ok:cleared panel filters';}}
  return 'error:panel Clear all not found';
})();`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  URL-based filter navigation (most reliable)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Set active status via URL param. */
export function setActiveStatus(status: 'active' | 'inactive' | 'all'): string {
  return `(function(){var url=new URL(window.location.href);url.searchParams.set('active_status',${JSON.stringify(status)});window.location.href=url.toString();return 'ok:navigating';})();`;
}

/** Set media type via URL param. */
export function setMediaType(mediaType: 'all' | 'image' | 'video' | 'meme' | 'none'): string {
  return `(function(){var url=new URL(window.location.href);url.searchParams.set('media_type',${JSON.stringify(mediaType)});window.location.href=url.toString();return 'ok:navigating';})();`;
}

/** Set publisher platforms via URL params. */
export function setPlatforms(platforms: string[]): string {
  return `(function(){var url=new URL(window.location.href);
  var keys=[];url.searchParams.forEach(function(v,k){if(k.indexOf('publisher_platforms')!==-1)keys.push(k);});
  keys.forEach(function(k){url.searchParams.delete(k);});
  var p=${JSON.stringify(platforms)};for(var i=0;i<p.length;i++)url.searchParams.set('publisher_platforms['+i+']',p[i]);
  window.location.href=url.toString();return 'ok:navigating';})();`;
}

/** Set content language via URL param. */
export function setLanguage(langCode: string): string {
  return `(function(){var url=new URL(window.location.href);url.searchParams.set('content_languages[0]',${JSON.stringify(langCode)});window.location.href=url.toString();return 'ok:navigating';})();`;
}

/** Set date range via URL params. */
export function setDateRange(minDate: string, maxDate: string): string {
  return `(function(){var url=new URL(window.location.href);
  ${minDate ? `url.searchParams.set('start_date[min]',${JSON.stringify(minDate)});` : `url.searchParams.delete('start_date[min]');`}
  ${maxDate ? `url.searchParams.set('start_date[max]',${JSON.stringify(maxDate)});` : `url.searchParams.delete('start_date[max]');`}
  window.location.href=url.toString();return 'ok:navigating';})();`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Convenience bundle
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const AD_LIBRARY_SCRIPTS = {
  // Extraction
  EXTRACT_ALL_ADS,
  READ_FILTER_STATE,

  // Utility
  DISMISS_DIALOGS,
  SCROLL_TO_BOTTOM,

  // Top bar interactions
  changeSearch,
  CLEAR_SEARCH,
  selectAdCategory,
  selectCountry,
  selectSort,
  removeFilterChip,
  CLEAR_ALL_FILTER_CHIPS,

  // Filters panel
  OPEN_FILTERS_PANEL,
  CLOSE_FILTERS_PANEL,
  READ_FILTERS_PANEL_STATE,
  selectFiltersPanelOption,
  searchFiltersPanelAdvertiser,
  setFiltersPanelDateFrom,
  setFiltersPanelDateTo,
  APPLY_FILTERS_PANEL,
  CLEAR_FILTERS_PANEL,

  // URL-based navigation
  setActiveStatus,
  setMediaType,
  setPlatforms,
  setLanguage,
  setDateRange,
} as const;
