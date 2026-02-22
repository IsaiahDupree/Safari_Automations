#!/usr/bin/env npx tsx
/**
 * Trilogy Stitcher
 * ================
 * Concatenates multi-part Sora videos into single final videos using ffmpeg.
 *
 * Usage:
 *   npx tsx scripts/stitch-trilogies.ts              # Stitch all trilogies
 *   npx tsx scripts/stitch-trilogies.ts --dry-run     # Preview without stitching
 *   npx tsx scripts/stitch-trilogies.ts --batch db-batch-2  # Specific batch only
 *   npx tsx scripts/stitch-trilogies.ts --force       # Re-stitch even if output exists
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SORA_VIDEOS_DIR = path.join(process.env.HOME || '', 'sora-videos');
const CLEANED_DIR = path.join(SORA_VIDEOS_DIR, 'cleaned');
const FINALS_DIR = path.join(SORA_VIDEOS_DIR, 'finals');
const CONFIG_DIR = path.join(__dirname, '..');
const CATALOG_FILE = path.join(SORA_VIDEOS_DIR, 'daily-pipeline-catalog.json');

const CONFIG_FILES = [
  { file: 'sora-february-2026-trends.json', cleanedDir: 'february-2026-trends', batch: 'february-trends' },
  { file: 'sora-db-generated-batch-1.json', cleanedDir: 'db-generated-batch-1', batch: 'db-batch-1' },
  { file: 'sora-db-generated-batch-2.json', cleanedDir: 'db-generated-batch-2', batch: 'db-batch-2' },
  { file: 'sora-trending-batch-3.json', cleanedDir: 'trending-batch-3', batch: 'trending-batch-3' },
];

interface TrilogyInfo {
  title: string;
  slug: string;
  batch: string;
  batchDir: string;
  parts: { part: number; path: string }[];
  outputPath: string;
}

function discoverTrilogies(batchFilter?: string): TrilogyInfo[] {
  const trilogies: TrilogyInfo[] = [];

  for (const cfg of CONFIG_FILES) {
    if (batchFilter && cfg.batch !== batchFilter) continue;

    const configPath = path.join(CONFIG_DIR, cfg.file);
    if (!fs.existsSync(configPath)) continue;

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const movies = config.movies || [];

    for (const movie of movies) {
      const videos = movie.videos || [];
      if (videos.length <= 1) continue; // Single videos, not trilogies

      const slug = (movie.title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const cleanedBase = path.join(CLEANED_DIR, cfg.cleanedDir);
      const subfolderDir = path.join(cleanedBase, slug);

      // Find all part files
      const parts: { part: number; path: string }[] = [];

      for (const video of videos) {
        let videoPath = '';

        // Check subfolder first (per-subfolder cleaning pattern)
        if (fs.existsSync(subfolderDir)) {
          const files = fs.readdirSync(subfolderDir)
            .filter(f => f.endsWith('.mp4'))
            .sort();
          if (files.length >= video.part) {
            videoPath = path.join(subfolderDir, files[video.part - 1]);
          }
        }

        // Fallback: flat cleaned dir with multiple naming patterns
        if (!videoPath) {
          const partSlug = (video.title || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

          // Pattern 1: cleaned_part-N-slug.mp4 (most common for flat trilogies)
          const partPrefixed = path.join(cleanedBase, `cleaned_part-${video.part}-${partSlug}.mp4`);
          // Pattern 2: cleaned_slug.mp4
          const flatPath = path.join(cleanedBase, `cleaned_${partSlug}.mp4`);
          // Pattern 3: cleaned_part-N-part-N-slug.mp4 (double-part pattern from some configs)
          const doublePart = path.join(cleanedBase, `cleaned_part-${video.part}-part-${video.part}-${partSlug}.mp4`);

          if (fs.existsSync(partPrefixed)) {
            videoPath = partPrefixed;
          } else if (fs.existsSync(flatPath)) {
            videoPath = flatPath;
          } else if (fs.existsSync(doublePart)) {
            videoPath = doublePart;
          } else if (fs.existsSync(cleanedBase)) {
            // Fuzzy: scan directory for files containing both part number and slug keywords
            const files = fs.readdirSync(cleanedBase).filter(f => f.endsWith('.mp4'));
            const partMatch = files.find(f =>
              f.includes(`part-${video.part}`) && f.includes(partSlug.split('-')[0])
            );
            if (partMatch) {
              videoPath = path.join(cleanedBase, partMatch);
            }
          }
        }

        if (videoPath && fs.existsSync(videoPath)) {
          parts.push({ part: video.part, path: videoPath });
        }
      }

      // Only include if all parts are available
      if (parts.length === videos.length) {
        const batchFinals = path.join(FINALS_DIR, cfg.batch);
        trilogies.push({
          title: movie.title,
          slug,
          batch: cfg.batch,
          batchDir: cfg.cleanedDir,
          parts: parts.sort((a, b) => a.part - b.part),
          outputPath: path.join(batchFinals, `${slug}-final.mp4`),
        });
      }
    }
  }

  return trilogies;
}

function stitchTrilogy(trilogy: TrilogyInfo, force: boolean): boolean {
  // Check if output already exists
  if (fs.existsSync(trilogy.outputPath) && !force) {
    console.log(`  ⏭️  Already stitched: ${path.basename(trilogy.outputPath)}`);
    return true;
  }

  // Ensure output directory exists
  const outputDir = path.dirname(trilogy.outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  // Create ffmpeg concat file
  const concatFile = path.join(outputDir, `${trilogy.slug}-concat.txt`);
  const concatContent = trilogy.parts
    .map(p => `file '${p.path}'`)
    .join('\n');
  fs.writeFileSync(concatFile, concatContent);

  try {
    // Use ffmpeg concat demuxer for lossless concatenation
    const cmd = [
      'ffmpeg',
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-c', 'copy',
      '-movflags', '+faststart',
      trilogy.outputPath,
    ].join(' ');

    execSync(cmd, { stdio: 'pipe', timeout: 120000 });

    // Clean up concat file
    fs.unlinkSync(concatFile);

    // Verify output
    if (fs.existsSync(trilogy.outputPath)) {
      const stats = fs.statSync(trilogy.outputPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
      console.log(`  ✅ Stitched: ${path.basename(trilogy.outputPath)} (${sizeMB} MB)`);
      return true;
    } else {
      console.log(`  ❌ Output file not created`);
      return false;
    }
  } catch (error: any) {
    // Clean up concat file on error
    if (fs.existsSync(concatFile)) fs.unlinkSync(concatFile);

    // If copy fails (different codecs/resolutions), try re-encode
    console.log(`  ⚠️  Copy failed, trying re-encode...`);
    try {
      const reencodeCmd = [
        'ffmpeg', '-y',
        ...trilogy.parts.flatMap(p => ['-i', `"${p.path}"`]),
        '-filter_complex',
        `"concat=n=${trilogy.parts.length}:v=1:a=1"`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        `"${trilogy.outputPath}"`,
      ].join(' ');

      execSync(reencodeCmd, { stdio: 'pipe', shell: '/bin/zsh', timeout: 300000 });

      if (fs.existsSync(trilogy.outputPath)) {
        const stats = fs.statSync(trilogy.outputPath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
        console.log(`  ✅ Re-encoded: ${path.basename(trilogy.outputPath)} (${sizeMB} MB)`);
        return true;
      }
    } catch (reencodeErr: any) {
      console.log(`  ❌ Re-encode also failed: ${reencodeErr.message?.substring(0, 100)}`);
      return false;
    }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const batchIdx = args.indexOf('--batch');
const batchFilter = batchIdx !== -1 ? args[batchIdx + 1] : undefined;

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║   🎬 TRILOGY STITCHER — Combine Parts into Finals          ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
if (dryRun) console.log('🧪 DRY RUN MODE');
if (batchFilter) console.log(`📦 Batch filter: ${batchFilter}`);

// Ensure finals directory exists
fs.mkdirSync(FINALS_DIR, { recursive: true });

const trilogies = discoverTrilogies(batchFilter);
console.log(`\n📋 Found ${trilogies.length} complete trilogies\n`);

let stitched = 0;
let skipped = 0;
let failed = 0;

for (const trilogy of trilogies) {
  console.log(`\n🎬 ${trilogy.title} (${trilogy.parts.length} parts) [${trilogy.batch}]`);
  for (const p of trilogy.parts) {
    console.log(`   Part ${p.part}: ${path.basename(p.path)}`);
  }

  if (dryRun) {
    console.log(`  🧪 Would stitch → ${path.basename(trilogy.outputPath)}`);
    stitched++;
    continue;
  }

  if (fs.existsSync(trilogy.outputPath) && !force) {
    console.log(`  ⏭️  Already exists: ${path.basename(trilogy.outputPath)}`);
    skipped++;
    continue;
  }

  const ok = stitchTrilogy(trilogy, force);
  if (ok) stitched++;
  else failed++;
}

console.log('\n══════════════════════════════════════════════════════════════');
console.log('📊 STITCH SUMMARY');
console.log('══════════════════════════════════════════════════════════════');
console.log(`   Total trilogies: ${trilogies.length}`);
console.log(`   Stitched: ${stitched}`);
console.log(`   Skipped (already done): ${skipped}`);
console.log(`   Failed: ${failed}`);
console.log(`   Output: ${FINALS_DIR}`);
console.log('══════════════════════════════════════════════════════════════\n');
