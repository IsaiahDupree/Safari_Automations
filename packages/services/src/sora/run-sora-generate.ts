
import { SoraFullAutomation } from './sora-full-automation';
const prompt = process.argv[2];
if (!prompt) { console.error('No prompt'); process.exit(1); }
const sora = new SoraFullAutomation();
sora.fullRun(prompt).then(r => { console.log(JSON.stringify(r)); }).catch(e => { console.error(JSON.stringify({ error: e.message })); process.exit(1); });
