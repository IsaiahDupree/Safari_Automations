
import { SoraFullAutomation } from './sora-full-automation.js';
const sora = new SoraFullAutomation();
sora.getPlatformLeaderboard().then(r => { console.log(JSON.stringify(r)); }).catch(e => { console.error(JSON.stringify({ error: e.message })); process.exit(1); });
