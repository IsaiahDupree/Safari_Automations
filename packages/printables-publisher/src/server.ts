import { createPrintablesServer } from './app.js';

const port = Number.parseInt(process.env.PRINTABLES_PUBLISHER_PORT || '3112', 10);
const host = '127.0.0.1';
const token = process.env.PRINTABLES_PUBLISHER_TOKEN || '';

const { server } = createPrintablesServer({
  port,
  token,
  jobsDir: process.env.PRINTABLES_JOBS_DIR,
  stagingRoot: process.env.PRINTABLES_STAGING_ROOT,
  selectorContract: process.env.PRINTABLES_SELECTOR_CONTRACT,
});
server.listen(port, host, () => {
  console.log(`printables-publisher listening on http://${host}:${port}`);
});
