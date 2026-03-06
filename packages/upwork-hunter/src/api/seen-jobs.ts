/**
 * Persistent seen-jobs tracker.
 *
 * Tracks every job_id we've ever scored (above or below threshold) so we
 * don't re-fetch, re-score, or re-notify on repeat scans.
 *
 * Backed by:
 *   1. In-memory Set (fast O(1) lookups during a process lifetime)
 *   2. JSON file on disk (survives server restarts)
 *
 * File: packages/upwork-hunter/data/seen-jobs.json
 * Format: { "ids": ["abc123", ...], "updatedAt": "ISO" }
 */

import * as fs from 'fs';
import * as path from 'path';
const DATA_DIR  = path.join(__dirname, '../../data');
const FILE_PATH = path.join(DATA_DIR, 'seen-jobs.json');

// Cap at 5000 entries — evict oldest 500 when full (FIFO ring)
const MAX_IDS = 5000;
const EVICT_COUNT = 500;

let _ids: string[] = [];
let _set: Set<string> = new Set();
let _loaded = false;

function load(): void {
  if (_loaded) return;
  _loaded = true;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8')) as { ids?: string[] };
      _ids = raw.ids || [];
      _set = new Set(_ids);
      console.log(`[seen-jobs] Loaded ${_ids.length} previously seen job IDs`);
    }
  } catch (e) {
    console.warn('[seen-jobs] Could not load file, starting fresh:', (e as Error).message);
    _ids = [];
    _set = new Set();
  }
}

function persist(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE_PATH, JSON.stringify({ ids: _ids, updatedAt: new Date().toISOString() }));
  } catch (e) {
    console.warn('[seen-jobs] Could not persist:', (e as Error).message);
  }
}

export function hasSeen(jobId: string): boolean {
  load();
  return _set.has(jobId);
}

export function markSeen(jobIds: string[]): void {
  load();
  let added = 0;
  for (const id of jobIds) {
    if (!_set.has(id)) {
      _ids.push(id);
      _set.add(id);
      added++;
    }
  }
  // Evict oldest entries if over cap
  if (_ids.length > MAX_IDS) {
    const evicted = _ids.splice(0, EVICT_COUNT);
    for (const id of evicted) _set.delete(id);
  }
  if (added > 0) persist();
}

export function seenCount(): number {
  load();
  return _ids.length;
}

export function clearSeen(): void {
  _ids = [];
  _set = new Set();
  _loaded = true;
  persist();
}
