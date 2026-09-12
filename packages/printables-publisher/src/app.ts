import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobStore, APPROVAL_STATEMENT } from './job-store.js';
import { validateReleaseBundle } from './release-validator.js';
import { PrintablesSafari } from './safari-printables.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_JOBS = path.resolve(MODULE_DIR, '../data/jobs');
const DEFAULT_STAGING = '/Users/isaiahdupree/Documents/Software/cad-catalog/publisher-output/models';

export interface AppOptions {
  port: number;
  token: string;
  jobsDir?: string;
  stagingRoot?: string;
  selectorContract?: string;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(`${JSON.stringify(body, null, 2)}\n`);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 1024 * 1024) throw new Error('Request body exceeds 1 MiB');
    chunks.push(bytes);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object body required');
  return parsed as Record<string, unknown>;
}

function authorized(req: IncomingMessage, token: string): boolean {
  const supplied = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1] || '';
  const expectedHash = createHash('sha256').update(token).digest();
  const suppliedHash = createHash('sha256').update(supplied).digest();
  return supplied !== '' && timingSafeEqual(expectedHash, suppliedHash);
}

function publicJob(job: Awaited<ReturnType<JobStore['get']>>): Record<string, unknown> {
  const { approval, ...safe } = job;
  return { ...safe, approval: approval ? { ...approval, nonceHash: '[redacted]' } : undefined };
}

export function createPrintablesServer(options: AppOptions) {
  if (!options.token || options.token.length < 24) throw new Error('PRINTABLES_PUBLISHER_TOKEN must contain at least 24 characters');
  const store = new JobStore(options.jobsDir || DEFAULT_JOBS);
  const stagingRoot = options.stagingRoot || DEFAULT_STAGING;
  const safari = new PrintablesSafari(options.port, options.selectorContract);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(res, 200, {
          status: 'ok', service: 'printables-publisher', mode: 'draft-first',
          bindPolicy: 'loopback-only', publishRequiresSeparateApproval: true,
        });
        return;
      }
      if (!authorized(req, options.token)) {
        json(res, 401, { error: 'Bearer authentication required' });
        return;
      }
      await store.initialize();

      if (req.method === 'GET' && url.pathname === '/api/printables/browser/status') {
        json(res, 200, await safari.status());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/printables/browser/inspect') {
        json(res, 200, await safari.inspect());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/printables/selector-contract') {
        json(res, 200, await safari.contract());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/printables/jobs') {
        json(res, 200, { jobs: (await store.list()).map(publicJob) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/printables/jobs') {
        const body = await readBody(req);
        if (typeof body.bundlePath !== 'string' || !body.bundlePath) throw new Error('bundlePath is required');
        json(res, 201, publicJob(await store.create(body.bundlePath)));
        return;
      }

      const match = url.pathname.match(/^\/api\/printables\/jobs\/([0-9a-f-]{36})(?:\/(validate|prepare-draft|execute-draft|approve-publish|publish|cancel))?$/i);
      if (!match) {
        json(res, 404, { error: 'Route not found' });
        return;
      }
      const [, id, action] = match;
      if (req.method === 'GET' && !action) {
        json(res, 200, publicJob(await store.get(id)));
        return;
      }
      if (req.method !== 'POST' || !action) {
        json(res, 405, { error: 'Method not allowed' });
        return;
      }

      if (action === 'validate') {
        const job = await store.get(id);
        const release = await validateReleaseBundle(job.requestedBundlePath, stagingRoot);
        json(res, 200, publicJob(await store.validate(id, release)));
        return;
      }
      if (action === 'prepare-draft') {
        json(res, 200, publicJob(await store.transition(id, ['validated'], 'draft_prepared', 'draft.prepared')));
        return;
      }
      if (action === 'execute-draft') {
        const job = await store.get(id);
        if (job.state !== 'draft_prepared') throw new Error('Job must be draft_prepared');
        if (!job.release) throw new Error('Job has no validated release');
        const freshRelease = await validateReleaseBundle(job.requestedBundlePath, stagingRoot);
        if (freshRelease.bundleDigest !== job.release.bundleDigest) throw new Error('Release bundle changed after validation');
        const result = await safari.prepareDraft(job);
        const updated = await store.recordBrowserDraft(id, result.draftUrl);
        json(res, 200, publicJob(updated));
        return;
      }
      if (action === 'approve-publish') {
        const body = await readBody(req);
        const approved = await store.approve(id, String(body.bundleDigest || ''), String(body.statement || ''));
        json(res, 200, { job: publicJob(approved.job), approvalNonce: approved.approvalNonce, warning: 'The nonce is shown once and authorizes one exact publication attempt.' });
        return;
      }
      if (action === 'publish') {
        const body = await readBody(req);
        const job = await store.get(id);
        store.verifyApproval(job, String(body.approvalNonce || ''));
        if (!job.release) throw new Error('Job has no validated release');
        const freshRelease = await validateReleaseBundle(job.requestedBundlePath, stagingRoot);
        if (freshRelease.bundleDigest !== job.release.bundleDigest) throw new Error('Release bundle changed after publication approval');
        const result = await safari.publish(job);
        json(res, 200, result);
        return;
      }
      if (action === 'cancel') {
        json(res, 200, publicJob(await store.transition(id, ['created', 'validated', 'draft_prepared', 'browser_draft_created', 'publish_approved', 'blocked', 'failed'], 'cancelled', 'job.cancelled')));
        return;
      }
      json(res, 404, { error: 'Action not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /not found/i.test(message) ? 404
        : /SafariLanePermitError|safe Safari agent tab|Safari has no human Window 1/i.test(message) ? 503
        : /selector contract|disabled|not yet|must be|cannot|requires|required|mismatch|changed|unsafe|unsupported|approval|only a verified/i.test(message) ? 409
        : 500;
      json(res, status, { error: message });
    }
  });

  return { server, store, approvalStatement: APPROVAL_STATEMENT };
}
