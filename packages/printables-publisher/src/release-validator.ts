import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ReleaseFile, ValidatedRelease } from './types.js';

const RELEASE_EXTENSIONS = new Set(['.stl', '.step', '.stp', '.3mf', '.fcstd']);
const PREVIEW_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
  return value.trim();
}

async function sha256File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

async function safeContainedPath(root: string, relative: string): Promise<string> {
  if (!relative || path.isAbsolute(relative)) throw new Error(`Unsafe bundle-relative path: ${relative}`);
  const joined = path.resolve(root, relative);
  const rootPrefix = `${root}${path.sep}`;
  if (!joined.startsWith(rootPrefix)) throw new Error(`Path escapes release bundle: ${relative}`);
  const entry = await lstat(joined);
  if (entry.isSymbolicLink()) throw new Error(`Symlinks are not permitted in a release bundle: ${relative}`);
  const resolved = await realpath(joined);
  if (!resolved.startsWith(rootPrefix)) throw new Error(`Resolved path escapes release bundle: ${relative}`);
  return resolved;
}

async function describeFile(root: string, relativePath: string, expectedHash: string): Promise<ReleaseFile> {
  const absolutePath = await safeContainedPath(root, relativePath);
  const details = await stat(absolutePath);
  if (!details.isFile()) throw new Error(`Manifest entry is not a regular file: ${relativePath}`);
  const actualHash = await sha256File(absolutePath);
  if (!expectedHash || actualHash !== expectedHash) throw new Error(`SHA-256 mismatch: ${relativePath}`);
  return { relativePath, absolutePath, sha256: actualHash, bytes: details.size };
}

export async function validateReleaseBundle(bundleInput: string, stagingRootInput: string): Promise<ValidatedRelease> {
  const stagingRoot = await realpath(stagingRootInput);
  const bundlePath = await realpath(bundleInput);
  if (!bundlePath.startsWith(`${stagingRoot}${path.sep}`)) {
    throw new Error('Release bundle must be inside the configured private staging root');
  }
  if ((await lstat(bundleInput)).isSymbolicLink()) throw new Error('Release bundle may not be a symlink');

  const worksheetPath = await safeContainedPath(bundlePath, 'printables.json');
  const manifestPath = await safeContainedPath(bundlePath, 'manifest.json');
  const readmePath = await safeContainedPath(bundlePath, 'README.md');
  const worksheet = objectValue(JSON.parse(await readFile(worksheetPath, 'utf8')), 'printables.json');
  const manifest = objectValue(JSON.parse(await readFile(manifestPath, 'utf8')), 'manifest.json');
  const manifestFiles = objectValue(manifest.files, 'manifest.files');

  if (worksheet.requires_human_review !== true) throw new Error('Release worksheet must require human review');
  if (worksheet.uploaded !== false) throw new Error('Release worksheet is already marked uploaded');
  if (manifest.network_writes_performed !== false) throw new Error('Manifest must record zero prior network writes');

  const described = new Map<string, ReleaseFile>();
  for (const [relativePath, expectedHash] of Object.entries(manifestFiles)) {
    described.set(relativePath, await describeFile(bundlePath, relativePath, requiredString(expectedHash, `hash for ${relativePath}`)));
  }
  const readme = described.get('README.md');
  const worksheetFile = described.get('printables.json');
  if (!readme || !worksheetFile) throw new Error('Manifest must hash README.md and printables.json');

  const listedFiles = worksheet.files;
  if (!Array.isArray(listedFiles) || listedFiles.length === 0) throw new Error('At least one CAD file is required');
  const files = listedFiles.map((entry, index) => {
    const relative = requiredString(entry, `files[${index}]`);
    const file = described.get(relative);
    if (!file) throw new Error(`CAD file is not hash-covered by manifest: ${relative}`);
    if (!RELEASE_EXTENSIONS.has(path.extname(relative).toLowerCase())) throw new Error(`Unsupported CAD release format: ${relative}`);
    return file;
  });

  const previewRelative = requiredString(worksheet.preview, 'preview');
  const preview = described.get(previewRelative);
  if (!preview) throw new Error('Preview image is not hash-covered by manifest');
  if (!PREVIEW_EXTENSIONS.has(path.extname(previewRelative).toLowerCase())) throw new Error('Preview must be PNG, JPEG, or WebP');

  const title = requiredString(worksheet.title, 'title');
  const license = requiredString(worksheet.license, 'license');
  const repositoryUrl = requiredString(worksheet.github_repository_url, 'github_repository_url');
  const requestUrl = requiredString(worksheet.request_url, 'request_url');
  const description = (await readFile(readme.absolutePath, 'utf8')).trim();
  if (description.length < 40) throw new Error('README.md is too short to be a useful Printables description');

  const sourceSha256 = requiredString(manifest.source_sha256, 'source_sha256');
  if (!files.some(file => file.sha256 === sourceSha256)) {
    throw new Error('Manifest source_sha256 does not match any submitted CAD file');
  }
  const canonical = JSON.stringify({
    catalogItemId: requiredString(manifest.catalog_item_id, 'catalog_item_id'),
    sourceSha256,
    title,
    license,
    files: files.map(file => [file.relativePath, file.sha256]),
    preview: [preview.relativePath, preview.sha256],
  });
  const bundleDigest = createHash('sha256').update(canonical).digest('hex');
  return {
    bundlePath,
    bundleDigest,
    catalogItemId: String(manifest.catalog_item_id),
    title,
    description,
    license,
    files,
    preview,
    repositoryUrl,
    requestUrl,
  };
}
