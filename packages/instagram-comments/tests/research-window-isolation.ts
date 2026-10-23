/** Real Safari read integration; no provider mocks or navigation writes. */
import assert from 'node:assert/strict';
import { InstagramResearcher } from '../src/automation/instagram-researcher.js';
const original = process.env.SAFARI_INSTAGRAM_RESEARCH_WINDOW_ID;
delete process.env.SAFARI_INSTAGRAM_RESEARCH_WINDOW_ID;
const researcher = new InstagramResearcher();
await assert.rejects((researcher as any).executeJS('location.origin'), /explicit dedicated Safari window ID/);
process.env.SAFARI_INSTAGRAM_RESEARCH_WINDOW_ID = original;
if (original) {
  const result = await (researcher as any).executeJS('JSON.stringify({origin:location.origin})');
  assert.equal(JSON.parse(result).origin, 'https://www.instagram.com');
  console.log('PASS: explicit-window Safari read; absent target refuses before browser execution');
} else {
  console.log('PASS: missing target refusal; live Safari read not requested');
}
