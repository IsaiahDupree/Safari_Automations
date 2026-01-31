/**
 * Instagram DM Pattern Test Suite
 * 
 * Tests all discovered patterns to verify they work correctly.
 * Run with: npx tsx scripts/test-dm-patterns.ts
 */

const SAFARI_URL = process.env.SAFARI_API_URL || 'http://localhost:3100';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  duration: number;
}

async function exec(script: string): Promise<string> {
  try {
    const response = await fetch(`${SAFARI_URL}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    });
    const result = await response.json() as { output: string };
    return result.output || '';
  } catch (error) {
    return `ERROR: ${error}`;
  }
}

async function navigateToInbox(): Promise<boolean> {
  const response = await fetch(`${SAFARI_URL}/api/inbox/navigate`, { method: 'POST' });
  return response.ok;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<{ passed: boolean; details: string }>): Promise<void> {
  const start = Date.now();
  try {
    const { passed, details } = await fn();
    results.push({ name, passed, details, duration: Date.now() - start });
  } catch (error) {
    results.push({ name, passed: false, details: `Exception: ${error}`, duration: Date.now() - start });
  }
}

// ============== TESTS ==============

async function runTests() {
  console.log('\n🧪 Instagram DM Pattern Test Suite\n');
  console.log('=' .repeat(60));

  // Test 1: Safari API Connection
  await test('Safari API Connection', async () => {
    const result = await exec('document.title');
    return {
      passed: result.includes('Instagram'),
      details: `Title: ${result.substring(0, 50)}`
    };
  });

  // Test 2: Navigate to Inbox
  await test('Navigate to Inbox', async () => {
    const success = await navigateToInbox();
    await wait(2000);
    const url = await exec('window.location.href');
    return {
      passed: success && url.includes('/direct/'),
      details: `URL: ${url}`
    };
  });

  // Test 3: Find DM Tabs
  await test('Find DM Tabs ([role="tab"])', async () => {
    const result = await exec(`(function(){
      var tabs = document.querySelectorAll("[role=tab]");
      var names = [];
      for(var i=0; i<tabs.length; i++){
        names.push(tabs[i].innerText.trim());
      }
      return names.join(" | ");
    })()`);
    return {
      passed: result.includes('Primary') && result.includes('General'),
      details: `Tabs: ${result}`
    };
  });

  // Test 4: Get Tab Selection State
  await test('Tab Selection State (aria-selected)', async () => {
    const result = await exec(`(function(){
      var tabs = document.querySelectorAll("[role=tab]");
      for(var i=0; i<tabs.length; i++){
        if(tabs[i].getAttribute("aria-selected") === "true"){
          return "Selected: " + tabs[i].innerText.trim();
        }
      }
      return "none selected";
    })()`);
    return {
      passed: result.includes('Selected:'),
      details: result
    };
  });

  // Test 5: Switch to General Tab
  await test('Switch Tab (General)', async () => {
    const result = await exec(`(function(){
      var tabs = document.querySelectorAll("[role=tab]");
      for(var i=0; i<tabs.length; i++){
        if(tabs[i].innerText.includes("General")){
          tabs[i].click();
          return "clicked";
        }
      }
      return "not found";
    })()`);
    await wait(1500);
    return {
      passed: result === 'clicked',
      details: result
    };
  });

  // Test 6: Switch to Requests Tab
  await test('Switch Tab (Requests)', async () => {
    const result = await exec(`(function(){
      var tabs = document.querySelectorAll("[role=tab]");
      for(var i=0; i<tabs.length; i++){
        if(tabs[i].innerText.includes("Requests")){
          tabs[i].click();
          return "clicked";
        }
      }
      return "not found";
    })()`);
    await wait(1500);
    return {
      passed: result === 'clicked',
      details: result
    };
  });

  // Test 7: Find Request Count
  await test('Request Count (Delete all N)', async () => {
    const result = await exec(`(function(){
      var text = document.body.innerText;
      var match = text.match(/Delete all (\\d+)/);
      return match ? "Count: " + match[1] : "not found";
    })()`);
    return {
      passed: result.includes('Count:'),
      details: result
    };
  });

  // Test 8: Find Hidden Requests Link
  await test('Hidden Requests Link', async () => {
    const result = await exec(`(function(){
      var text = document.body.innerText;
      return text.includes("Hidden Requests") ? "found" : "not found";
    })()`);
    return {
      passed: result === 'found',
      details: result
    };
  });

  // Test 9: Switch back to Primary
  await test('Switch Tab (Primary)', async () => {
    const result = await exec(`(function(){
      var tabs = document.querySelectorAll("[role=tab]");
      for(var i=0; i<tabs.length; i++){
        if(tabs[i].innerText.includes("Primary")){
          tabs[i].click();
          return "clicked";
        }
      }
      return "not found";
    })()`);
    await wait(1500);
    return {
      passed: result === 'clicked',
      details: result
    };
  });

  // Test 10: Find Contacts in Inbox
  await test('Find Contacts (span elements)', async () => {
    const result = await exec(`(function(){
      var contacts = [];
      var text = document.body.innerText;
      var lines = text.split(String.fromCharCode(10));
      var skip = ["Primary", "General", "Requests", "Messages", "Instagram"];
      for(var i=0; i<lines.length && contacts.length<5; i++){
        var l = lines[i].trim();
        if(l.length>3 && l.length<40 && /^[A-Z]/.test(l)){
          var isSkip = false;
          for(var j=0; j<skip.length; j++){ if(l===skip[j]) isSkip=true; }
          if(!isSkip && !l.includes("·")) contacts.push(l);
        }
      }
      return contacts.join(" | ");
    })()`);
    return {
      passed: result.length > 0 && !result.includes('ERROR'),
      details: `Found: ${result.substring(0, 100)}`
    };
  });

  // Test 11: Click Contact
  await test('Click Contact (span click)', async () => {
    const result = await exec(`(function(){
      var spans = document.querySelectorAll("span");
      for(var i=0; i<spans.length; i++){
        var t = spans[i].innerText;
        if(t && /^[A-Z]/.test(t) && t.length>3 && t.length<40 && !t.includes("Primary")){
          spans[i].click();
          return "clicked: " + t;
        }
      }
      return "not found";
    })()`);
    await wait(3000);
    return {
      passed: result.includes('clicked:'),
      details: result
    };
  });

  // Test 12: Find Message Textbox
  await test('Message Textbox ([role="textbox"])', async () => {
    const result = await exec(`(function(){
      var tb = document.querySelector("[role=textbox]");
      if(tb){
        return "found, placeholder: " + (tb.getAttribute("aria-label") || tb.getAttribute("placeholder") || "none");
      }
      return "not found";
    })()`);
    return {
      passed: result.includes('found'),
      details: result
    };
  });

  // Test 13: Find Username Handle
  await test('Find Username Handle (regex pattern)', async () => {
    const result = await exec(`(function(){
      var t = document.body.innerText;
      var lines = t.split(String.fromCharCode(10));
      for(var i=0; i<lines.length; i++){
        var l = lines[i].trim();
        if(l.match(/^[a-z0-9._]+$/) && l.length>5 && l.length<25 && l!=="the_isaiah_dupree"){
          return "handle: " + l;
        }
      }
      return "not found";
    })()`);
    return {
      passed: result.includes('handle:'),
      details: result
    };
  });

  // Test 14: Find Scrollable Message Container
  await test('Scrollable Message Container', async () => {
    const result = await exec(`(function(){
      var divs = document.querySelectorAll("div");
      for(var i=0; i<divs.length; i++){
        if(divs[i].scrollHeight>1500 && divs[i].clientHeight>400){
          return "found: scrollHeight=" + divs[i].scrollHeight + ", clientHeight=" + divs[i].clientHeight;
        }
      }
      return "not found";
    })()`);
    return {
      passed: result.includes('found:'),
      details: result
    };
  });

  // Test 15: Scroll Messages Up
  await test('Scroll Messages Up (scrollBy)', async () => {
    const result = await exec(`(function(){
      var divs = document.querySelectorAll("div");
      for(var i=0; i<divs.length; i++){
        if(divs[i].scrollHeight>1500 && divs[i].clientHeight>400){
          var before = divs[i].scrollTop;
          divs[i].scrollBy(0, -1000);
          return "scrolled from " + before + " to " + divs[i].scrollTop;
        }
      }
      return "not found";
    })()`);
    return {
      passed: result.includes('scrolled'),
      details: result
    };
  });

  // Test 16: Find Conversation Actions
  await test('Conversation Actions (aria-labels)', async () => {
    const result = await exec(`(function(){
      var actions = ["Audio call", "Video call", "Add Photo or Video", "Voice Clip"];
      var found = [];
      for(var i=0; i<actions.length; i++){
        if(document.querySelector("[aria-label='" + actions[i] + "']")){
          found.push(actions[i]);
        }
      }
      return found.length > 0 ? "found: " + found.join(", ") : "none found";
    })()`);
    return {
      passed: result.includes('found:'),
      details: result
    };
  });

  // Test 17: Find Inbox Scroll Container
  await test('Inbox Scroll Container (class selector)', async () => {
    await navigateToInbox();
    await wait(2000);
    const result = await exec(`(function(){
      var c = document.querySelector("div.xb57i2i.x1q594ok.x5lxg6s");
      if(c){
        return "found: scrollHeight=" + c.scrollHeight;
      }
      return "not found";
    })()`);
    return {
      passed: result.includes('found:'),
      details: result
    };
  });

  // Test 18: Aria-label Navigation Elements
  await test('Navigation Aria-labels', async () => {
    const result = await exec(`(function(){
      var labels = ["Home", "Messages", "Search", "Explore", "Notifications"];
      var found = [];
      for(var i=0; i<labels.length; i++){
        if(document.querySelector("[aria-label='" + labels[i] + "']") || 
           document.querySelector("[aria-label*='" + labels[i] + "']")){
          found.push(labels[i]);
        }
      }
      return "found: " + found.join(", ");
    })()`);
    return {
      passed: result.includes('Messages'),
      details: result
    };
  });

  // Test 19: Timestamp Pattern Detection
  await test('Timestamp Patterns', async () => {
    const result = await exec(`(function(){
      var text = document.body.innerText;
      var patterns = {
        relative: text.match(/\\d+[wdhm]/) ? true : false,
        dayTime: text.match(/[A-Z][a-z]{2} \\d{1,2}:\\d{2} [AP]M/) ? true : false,
        fullDate: text.match(/\\d{1,2}\\/\\d{1,2}\\/\\d{2}/) ? true : false
      };
      var found = [];
      if(patterns.relative) found.push("relative");
      if(patterns.dayTime) found.push("dayTime");
      if(patterns.fullDate) found.push("fullDate");
      return found.length > 0 ? "found: " + found.join(", ") : "none";
    })()`);
    return {
      passed: result.includes('found:'),
      details: result
    };
  });

  // Test 20: Profile Pictures (img[alt])
  await test('Profile Pictures (alt attribute)', async () => {
    const result = await exec(`(function(){
      var imgs = document.querySelectorAll("img[alt]");
      var profilePics = 0;
      for(var i=0; i<imgs.length; i++){
        var alt = imgs[i].getAttribute("alt") || "";
        if(alt.includes("profile picture") || alt.includes("profile-picture")){
          profilePics++;
        }
      }
      return profilePics > 0 ? "found: " + profilePics + " profile pictures" : "none found";
    })()`);
    return {
      passed: result.includes('found:'),
      details: result
    };
  });

  // ============== RESULTS ==============
  console.log('\n' + '=' .repeat(60));
  console.log('📊 TEST RESULTS\n');

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    const status = r.passed ? 'PASS' : 'FAIL';
    console.log(`${icon} ${r.name}`);
    console.log(`   ${status} (${r.duration}ms) - ${r.details}`);
    if (r.passed) passed++;
    else failed++;
  }

  console.log('\n' + '=' .repeat(60));
  console.log(`\n📈 Summary: ${passed}/${results.length} tests passed (${Math.round(passed/results.length*100)}%)`);
  
  if (failed > 0) {
    console.log(`\n⚠️  ${failed} tests failed - review the patterns above`);
  } else {
    console.log('\n🎉 All tests passed!');
  }
}

runTests().catch(console.error);
