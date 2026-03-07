import { SoraFullAutomation } from './sora-full-automation.js';
const username = process.argv[2] || 'memexpert';
const limit = parseInt(process.argv[3] || '5', 10);
const sora = new SoraFullAutomation();
sora.getCreatorPrompts(username, limit)
  .then(r => { console.log(JSON.stringify(r, null, 2)); })
  .catch(e => { console.error(JSON.stringify({ error: e.message })); process.exit(1); });
