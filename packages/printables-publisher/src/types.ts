export type JobState =
  | 'created'
  | 'validated'
  | 'draft_prepared'
  | 'browser_draft_created'
  | 'publish_approved'
  | 'published'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export interface JobEvent {
  at: string;
  type: string;
  detail: Record<string, unknown>;
}

export interface ReleaseFile {
  relativePath: string;
  absolutePath: string;
  sha256: string;
  bytes: number;
}

export interface ValidatedRelease {
  bundlePath: string;
  bundleDigest: string;
  catalogItemId: string;
  title: string;
  description: string;
  license: string;
  files: ReleaseFile[];
  preview: ReleaseFile;
  repositoryUrl: string;
  requestUrl: string;
}

export interface PublishApproval {
  bundleDigest: string;
  statement: string;
  nonceHash: string;
  approvedAt: string;
}

export interface PublishJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  state: JobState;
  requestedBundlePath: string;
  release?: ValidatedRelease;
  approval?: PublishApproval;
  printablesDraftUrl?: string;
  printablesPublishedUrl?: string;
  events: JobEvent[];
}

export interface SelectorContract {
  schemaVersion: number;
  status: 'pending_live_capture' | 'verified';
  capturedAt: string | null;
  verifiedAt: string | null;
  host: string;
  profileHandle: string;
  createUrl: string | null;
  selectors: Record<string, string | null>;
  notes: string[];
}
