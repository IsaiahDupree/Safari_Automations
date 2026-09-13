import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPrintablesServer } from '../src/app.js';

const roots: string[] = [];

async function sha(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function realRelease(root: string): Promise<string> {
  const bundle = path.join(root, 'staging', 'models', 'fit-gauge-a1b2c3');
  await mkdir(path.join(bundle, 'files'), { recursive: true });
  await mkdir(path.join(bundle, 'preview'), { recursive: true });
  const cad = path.join(bundle, 'files', 'fit-gauge.stl');
  const preview = path.join(bundle, 'preview', 'fit-gauge.png');
  const readme = path.join(bundle, 'README.md');
  const worksheetPath = path.join(bundle, 'printables.json');
  await writeFile(cad, 'solid fit-gauge\nendsolid fit-gauge\n');
  await writeFile(preview, Buffer.from('89504e470d0a1a0a', 'hex'));
  await writeFile(readme, '# Fit gauge\n\nA measured fitment coupon used to verify mounting-hole spacing before printing the full enclosure.\n');
  await writeFile(worksheetPath, `${JSON.stringify({
    schema_version: 1,
    mode: 'manual-reviewed-submission',
    title: 'Measured fit gauge',
    summary: 'Measured mounting-hole fit gauge for enclosure validation.',
    files: ['files/fit-gauge.stl'],
    preview: 'preview/fit-gauge.png',
    previews: ['preview/fit-gauge.png'],
    license: 'CC BY 4.0',
    category: 'Automotive',
    tags: ['fitgauge'],
    model_origin: 'Original model — I made it',
    ai_used: false,
    public_publish_approved: false,
    github_repository_url: 'https://github.com/IsaiahDupree/3d-print-library',
    request_url: 'https://github.com/IsaiahDupree/3d-print-library/issues/new/choose',
    requires_human_review: true,
    uploaded: false,
  }, null, 2)}\n`);
  const manifest = {
    schema_version: 1,
    catalog_item_id: 'integration-fit-gauge',
    source_sha256: await sha(cad),
    network_writes_performed: false,
    files: {
      'files/fit-gauge.stl': await sha(cad),
      'preview/fit-gauge.png': await sha(preview),
      'README.md': await sha(readme),
      'printables.json': await sha(worksheetPath),
    },
  };
  await writeFile(path.join(bundle, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return bundle;
}

async function startService() {
  const root = await mkdtemp(path.join(tmpdir(), 'printables-publisher-'));
  roots.push(root);
  const token = 'integration-token-with-32-characters';
  const stagingRoot = path.join(root, 'staging', 'models');
  const bundlePath = await realRelease(root);
  const contract = path.join(root, 'selectors.json');
  await writeFile(contract, JSON.stringify({
    schemaVersion: 1, status: 'pending_live_capture', capturedAt: null, verifiedAt: null,
    host: 'www.printables.com', profileHandle: 'Isaiah_Dupre_1141044', createUrl: null,
    selectors: {}, notes: [],
  }));
  const app = createPrintablesServer({ port: 3112, token, jobsDir: path.join(root, 'jobs'), stagingRoot, selectorContract: contract });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Integration server did not bind');
  return { ...app, base: `http://127.0.0.1:${address.port}`, token, bundlePath };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('Printables publisher loopback API', () => {
  it('requires authentication and validates a hash-covered private release through real HTTP', async () => {
    const service = await startService();
    try {
      expect((await fetch(`${service.base}/api/health`)).status).toBe(200);
      expect((await fetch(`${service.base}/api/printables/jobs`)).status).toBe(401);
      const headers = { authorization: `Bearer ${service.token}`, 'content-type': 'application/json' };
      const createdResponse = await fetch(`${service.base}/api/printables/jobs`, {
        method: 'POST', headers, body: JSON.stringify({ bundlePath: service.bundlePath }),
      });
      expect(createdResponse.status).toBe(201);
      const created = await createdResponse.json() as { id: string; state: string };
      expect(created.state).toBe('created');
      const validatedResponse = await fetch(`${service.base}/api/printables/jobs/${created.id}/validate`, { method: 'POST', headers });
      expect(validatedResponse.status).toBe(200);
      const validated = await validatedResponse.json() as { state: string; release: { license: string } };
      expect(validated.state).toBe('validated');
      expect(validated.release.license).toBe('CC BY 4.0');
    } finally {
      await new Promise<void>((resolve, reject) => service.server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('fails closed before Safari selector capture and blocks premature publish approval', async () => {
    const service = await startService();
    try {
      const headers = { authorization: `Bearer ${service.token}`, 'content-type': 'application/json' };
      const created = await (await fetch(`${service.base}/api/printables/jobs`, {
        method: 'POST', headers, body: JSON.stringify({ bundlePath: service.bundlePath }),
      })).json() as { id: string };
      await fetch(`${service.base}/api/printables/jobs/${created.id}/validate`, { method: 'POST', headers });
      await fetch(`${service.base}/api/printables/jobs/${created.id}/prepare-draft`, { method: 'POST', headers });
      const execute = await fetch(`${service.base}/api/printables/jobs/${created.id}/execute-draft`, { method: 'POST', headers });
      expect(execute.status).toBe(409);
      const approval = await fetch(`${service.base}/api/printables/jobs/${created.id}/approve-publish`, {
        method: 'POST', headers, body: JSON.stringify({ bundleDigest: 'wrong', statement: 'I approve publishing this exact release' }),
      });
      expect(approval.status).toBe(409);
    } finally {
      await new Promise<void>((resolve, reject) => service.server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('binds later publication approval to the exact validated draft digest', async () => {
    const service = await startService();
    try {
      const headers = { authorization: `Bearer ${service.token}`, 'content-type': 'application/json' };
      const created = await (await fetch(`${service.base}/api/printables/jobs`, {
        method: 'POST', headers, body: JSON.stringify({ bundlePath: service.bundlePath }),
      })).json() as { id: string };
      const validated = await (await fetch(`${service.base}/api/printables/jobs/${created.id}/validate`, {
        method: 'POST', headers,
      })).json() as { release: { bundleDigest: string } };
      await service.store.transition(created.id, ['validated'], 'draft_prepared', 'draft.prepared');
      await service.store.recordBrowserDraft(created.id, 'https://www.printables.com/model/1234567/edit');

      const rejected = await fetch(`${service.base}/api/printables/jobs/${created.id}/approve-publish`, {
        method: 'POST', headers, body: JSON.stringify({
          bundleDigest: '0'.repeat(64), statement: 'I approve publishing this exact release',
        }),
      });
      expect(rejected.status).toBe(409);

      const approvedResponse = await fetch(`${service.base}/api/printables/jobs/${created.id}/approve-publish`, {
        method: 'POST', headers, body: JSON.stringify({
          bundleDigest: validated.release.bundleDigest,
          statement: 'I approve publishing this exact release',
        }),
      });
      expect(approvedResponse.status).toBe(200);
      const approved = await approvedResponse.json() as { approvalNonce: string; job: { state: string } };
      expect(approved.approvalNonce.length).toBeGreaterThan(32);
      expect(approved.job.state).toBe('publish_approved');

      const completed = await service.store.recordPublished(created.id, 'https://www.printables.com/model/1234567/example');
      expect(completed.state).toBe('published');
      expect(completed.printablesPublishedUrl).toBe('https://www.printables.com/model/1234567/example');
    } finally {
      await new Promise<void>((resolve, reject) => service.server.close(error => error ? reject(error) : resolve()));
    }
  });
});
