import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { JobState, PublishJob, ValidatedRelease } from './types.js';

const APPROVAL_STATEMENT = 'I approve publishing this exact release';

function now(): string {
  return new Date().toISOString();
}

function nonceHash(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

export class JobStore {
  constructor(private readonly jobsDir: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.jobsDir, { recursive: true, mode: 0o700 });
  }

  private jobPath(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid job id');
    return path.join(this.jobsDir, `${id}.json`);
  }

  private async save(job: PublishJob): Promise<PublishJob> {
    job.updatedAt = now();
    const target = this.jobPath(job.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
    return job;
  }

  async create(bundlePath: string): Promise<PublishJob> {
    const timestamp = now();
    const job: PublishJob = {
      id: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      state: 'created',
      requestedBundlePath: bundlePath,
      events: [{ at: timestamp, type: 'job.created', detail: { bundlePath } }],
    };
    return this.save(job);
  }

  async get(id: string): Promise<PublishJob> {
    return JSON.parse(await readFile(this.jobPath(id), 'utf8')) as PublishJob;
  }

  async list(): Promise<PublishJob[]> {
    await this.initialize();
    const names = (await readdir(this.jobsDir)).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name));
    const jobs = await Promise.all(names.map(name => this.get(name.slice(0, -5))));
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async validate(id: string, release: ValidatedRelease): Promise<PublishJob> {
    const job = await this.get(id);
    if (!['created', 'blocked', 'failed'].includes(job.state)) throw new Error(`Cannot validate job in state ${job.state}`);
    job.release = release;
    job.approval = undefined;
    job.state = 'validated';
    job.events.push({ at: now(), type: 'release.validated', detail: { bundleDigest: release.bundleDigest } });
    return this.save(job);
  }

  async transition(id: string, expected: JobState[], next: JobState, type: string, detail: Record<string, unknown> = {}): Promise<PublishJob> {
    const job = await this.get(id);
    if (!expected.includes(job.state)) throw new Error(`Cannot transition ${job.state} to ${next}`);
    job.state = next;
    job.events.push({ at: now(), type, detail });
    return this.save(job);
  }

  async recordBrowserDraft(id: string, draftUrl: string): Promise<PublishJob> {
    const job = await this.get(id);
    if (job.state !== 'draft_prepared') throw new Error('Job must be draft_prepared');
    job.state = 'browser_draft_created';
    job.printablesDraftUrl = draftUrl;
    job.events.push({ at: now(), type: 'draft.created', detail: { draftUrl } });
    return this.save(job);
  }

  async recordPublished(id: string, publishedUrl: string): Promise<PublishJob> {
    const job = await this.get(id);
    if (job.state !== 'publish_approved') throw new Error('Job must be publish_approved');
    job.state = 'published';
    job.printablesPublishedUrl = publishedUrl;
    job.events.push({ at: now(), type: 'publish.completed', detail: { publishedUrl } });
    return this.save(job);
  }

  async approve(id: string, bundleDigest: string, statement: string): Promise<{ job: PublishJob; approvalNonce: string }> {
    const job = await this.get(id);
    if (job.state !== 'browser_draft_created') throw new Error('Only a verified browser draft can be approved for publication');
    if (!job.release || job.release.bundleDigest !== bundleDigest) throw new Error('Approval digest does not match the validated release');
    if (statement !== APPROVAL_STATEMENT) throw new Error(`Approval statement must be exactly: ${APPROVAL_STATEMENT}`);
    const nonce = randomBytes(32).toString('base64url');
    job.approval = { bundleDigest, statement, nonceHash: nonceHash(nonce), approvedAt: now() };
    job.state = 'publish_approved';
    job.events.push({ at: now(), type: 'publish.approved', detail: { bundleDigest } });
    await this.save(job);
    return { job, approvalNonce: nonce };
  }

  verifyApproval(job: PublishJob, nonce: string): void {
    if (job.state !== 'publish_approved' || !job.approval || !job.release) throw new Error('Job has no live publication approval');
    if (job.approval.bundleDigest !== job.release.bundleDigest) throw new Error('Release changed after approval');
    const expected = Buffer.from(job.approval.nonceHash, 'hex');
    const actual = Buffer.from(nonceHash(nonce), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Invalid publication approval nonce');
  }
}

export { APPROVAL_STATEMENT };
