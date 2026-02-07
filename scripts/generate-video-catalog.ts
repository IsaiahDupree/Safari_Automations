#!/usr/bin/env npx tsx
/**
 * Sora Video Catalog Generator
 * Creates a master catalog linking all videos to their prompts and metadata
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SORA_VIDEOS_DIR = path.join(process.env.HOME || '', 'sora-videos');
const OUTPUT_FILE = path.join(SORA_VIDEOS_DIR, 'VIDEO_CATALOG.json');
const README_FILE = path.join(SORA_VIDEOS_DIR, 'VIDEO_CATALOG.md');

interface VideoEntry {
  filename: string;
  path: string;
  part: number;
  title: string;
  prompt: string;
  stage?: string;
  fileSize: string;
  createdAt: string;
}

interface MovieEntry {
  id: number;
  title: string;
  theme: string;
  format: string;
  totalParts: number;
  folder: string;
  videos: VideoEntry[];
}

interface Catalog {
  generatedAt: string;
  totalMovies: number;
  totalVideos: number;
  character: string;
  movies: MovieEntry[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function findVideosInFolder(folderPath: string): { filename: string; path: string; size: number; mtime: Date }[] {
  if (!fs.existsSync(folderPath)) return [];
  
  return fs.readdirSync(folderPath)
    .filter(f => f.endsWith('.mp4') && f.startsWith('part-'))
    .map(f => {
      const fullPath = path.join(folderPath, f);
      const stats = fs.statSync(fullPath);
      return { filename: f, path: fullPath, size: stats.size, mtime: stats.mtime };
    })
    .sort((a, b) => {
      const partA = parseInt(a.filename.match(/part-(\d+)/)?.[1] || '0');
      const partB = parseInt(b.filename.match(/part-(\d+)/)?.[1] || '0');
      return partA - partB;
    });
}

async function main() {
  console.log('🎬 Generating Sora Video Catalog...\n');
  
  const catalog: Catalog = {
    generatedAt: new Date().toISOString(),
    totalMovies: 0,
    totalVideos: 0,
    character: '@isaiahdupree',
    movies: []
  };

  // 1. Hero's Journey 3 Movies (6 parts each)
  const herosJourneyFile = path.join(__dirname, '..', 'sora-heros-journey-3movies.json');
  if (fs.existsSync(herosJourneyFile)) {
    const hjData = JSON.parse(fs.readFileSync(herosJourneyFile, 'utf-8'));
    
    for (const movie of hjData.movies) {
      const folderName = movie.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const folderPath = path.join(SORA_VIDEOS_DIR, 'heros-journey', folderName);
      const videoFiles = findVideosInFolder(folderPath);
      
      const movieEntry: MovieEntry = {
        id: catalog.movies.length + 1,
        title: movie.title,
        theme: movie.theme,
        format: "Hero's Journey (6 parts)",
        totalParts: 6,
        folder: `heros-journey/${folderName}`,
        videos: []
      };
      
      for (const video of movie.videos) {
        const matchingFile = videoFiles.find(f => f.filename.includes(`part-${video.part}`));
        if (matchingFile) {
          movieEntry.videos.push({
            filename: matchingFile.filename,
            path: matchingFile.path,
            part: video.part,
            title: video.title,
            prompt: video.prompt,
            stage: video.stage,
            fileSize: formatBytes(matchingFile.size),
            createdAt: matchingFile.mtime.toISOString()
          });
        }
      }
      
      if (movieEntry.videos.length > 0) {
        catalog.movies.push(movieEntry);
        catalog.totalVideos += movieEntry.videos.length;
      }
    }
  }

  // 2. The Last Guardian (6 parts)
  const lastGuardianFile = path.join(__dirname, '..', 'sora-6-part-epic.json');
  if (fs.existsSync(lastGuardianFile)) {
    const lgData = JSON.parse(fs.readFileSync(lastGuardianFile, 'utf-8'));
    const folderPath = path.join(SORA_VIDEOS_DIR, 'the-last-guardian');
    const videoFiles = findVideosInFolder(folderPath);
    
    const movieEntry: MovieEntry = {
      id: catalog.movies.length + 1,
      title: lgData.title,
      theme: lgData.theme,
      format: '6-Part Epic',
      totalParts: 6,
      folder: 'the-last-guardian',
      videos: []
    };
    
    for (const video of lgData.videos) {
      const matchingFile = videoFiles.find(f => f.filename.includes(`part-${video.part}`));
      if (matchingFile) {
        movieEntry.videos.push({
          filename: matchingFile.filename,
          path: matchingFile.path,
          part: video.part,
          title: video.title,
          prompt: video.prompt,
          fileSize: formatBytes(matchingFile.size),
          createdAt: matchingFile.mtime.toISOString()
        });
      }
    }
    
    if (movieEntry.videos.length > 0) {
      catalog.movies.push(movieEntry);
      catalog.totalVideos += movieEntry.videos.length;
    }
  }

  // 3. New 8 Trilogies (3 parts each)
  const trilogiesFile = path.join(__dirname, '..', 'sora-8-new-trilogies.json');
  if (fs.existsSync(trilogiesFile)) {
    const triData = JSON.parse(fs.readFileSync(trilogiesFile, 'utf-8'));
    
    for (const trilogy of triData.trilogies) {
      const folderName = trilogy.name.toLowerCase().replace(/\s+/g, '_');
      const folderPath = path.join(SORA_VIDEOS_DIR, 'new-8-trilogies', folderName);
      const videoFiles = findVideosInFolder(folderPath);
      
      const movieEntry: MovieEntry = {
        id: catalog.movies.length + 1,
        title: trilogy.name,
        theme: trilogy.theme,
        format: 'Trilogy (3 parts)',
        totalParts: 3,
        folder: `new-8-trilogies/${folderName}`,
        videos: []
      };
      
      for (const video of trilogy.videos) {
        const matchingFile = videoFiles.find(f => f.filename.includes(`part-${video.part}`));
        if (matchingFile) {
          movieEntry.videos.push({
            filename: matchingFile.filename,
            path: matchingFile.path,
            part: video.part,
            title: video.title,
            prompt: video.prompt,
            fileSize: formatBytes(matchingFile.size),
            createdAt: matchingFile.mtime.toISOString()
          });
        }
      }
      
      if (movieEntry.videos.length > 0) {
        catalog.movies.push(movieEntry);
        catalog.totalVideos += movieEntry.videos.length;
      }
    }
  }

  // 4. Original 27 Prompts Trilogies
  const orig27File = path.join(__dirname, '..', 'sora-27-prompts.json');
  if (fs.existsSync(orig27File)) {
    const origData = JSON.parse(fs.readFileSync(orig27File, 'utf-8'));
    
    for (const trilogy of origData.trilogies) {
      const folderName = trilogy.name.toLowerCase().replace(/\s+/g, '_');
      const folderPath = path.join(SORA_VIDEOS_DIR, folderName);
      const videoFiles = findVideosInFolder(folderPath);
      
      // Also check for chapter-X-raw.mp4 format
      const chapterFiles = fs.existsSync(folderPath) ? 
        fs.readdirSync(folderPath)
          .filter(f => f.match(/chapter-\d+-raw\.mp4/))
          .map(f => {
            const fullPath = path.join(folderPath, f);
            const stats = fs.statSync(fullPath);
            const partNum = parseInt(f.match(/chapter-(\d+)/)?.[1] || '0');
            return { filename: f, path: fullPath, size: stats.size, mtime: stats.mtime, part: partNum };
          }) : [];
      
      const movieEntry: MovieEntry = {
        id: catalog.movies.length + 1,
        title: trilogy.name,
        theme: trilogy.theme,
        format: 'Trilogy (3 parts)',
        totalParts: 3,
        folder: folderName,
        videos: []
      };
      
      for (const video of trilogy.videos) {
        let matchingFile = videoFiles.find(f => f.filename.includes(`part-${video.part}`));
        if (!matchingFile) {
          const chapterMatch = chapterFiles.find(f => f.part === video.part);
          if (chapterMatch) {
            matchingFile = { filename: chapterMatch.filename, path: chapterMatch.path, size: chapterMatch.size, mtime: chapterMatch.mtime };
          }
        }
        
        if (matchingFile) {
          movieEntry.videos.push({
            filename: matchingFile.filename,
            path: matchingFile.path,
            part: video.part,
            title: video.title,
            prompt: video.prompt,
            fileSize: formatBytes(matchingFile.size),
            createdAt: matchingFile.mtime.toISOString()
          });
        }
      }
      
      if (movieEntry.videos.length > 0) {
        catalog.movies.push(movieEntry);
        catalog.totalVideos += movieEntry.videos.length;
      }
    }
  }

  catalog.totalMovies = catalog.movies.length;

  // Write JSON catalog
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(catalog, null, 2));
  console.log(`✅ JSON Catalog: ${OUTPUT_FILE}`);

  // Generate Markdown README
  let md = `# @isaiahdupree Sora Video Catalog\n\n`;
  md += `**Generated:** ${new Date().toLocaleString()}\n\n`;
  md += `**Total Movies:** ${catalog.totalMovies}\n`;
  md += `**Total Videos:** ${catalog.totalVideos}\n\n`;
  md += `---\n\n`;

  for (const movie of catalog.movies) {
    md += `## ${movie.id}. ${movie.title}\n\n`;
    md += `- **Theme:** ${movie.theme}\n`;
    md += `- **Format:** ${movie.format}\n`;
    md += `- **Folder:** \`${movie.folder}\`\n`;
    md += `- **Videos:** ${movie.videos.length}/${movie.totalParts}\n\n`;
    
    if (movie.videos.length > 0) {
      md += `| Part | Title | File | Size |\n`;
      md += `|------|-------|------|------|\n`;
      for (const v of movie.videos) {
        md += `| ${v.part} | ${v.title} | \`${v.filename}\` | ${v.fileSize} |\n`;
      }
      md += `\n`;
      
      md += `<details>\n<summary>📜 Prompts</summary>\n\n`;
      for (const v of movie.videos) {
        md += `**Part ${v.part}: ${v.title}**${v.stage ? ` *(${v.stage})*` : ''}\n`;
        md += `> ${v.prompt}\n\n`;
      }
      md += `</details>\n\n`;
    }
    
    md += `---\n\n`;
  }

  fs.writeFileSync(README_FILE, md);
  console.log(`✅ Markdown Catalog: ${README_FILE}`);

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 CATALOG SUMMARY');
  console.log('═'.repeat(60));
  console.log(`   Total Movies: ${catalog.totalMovies}`);
  console.log(`   Total Videos: ${catalog.totalVideos}`);
  console.log(`\n   Movies by Format:`);
  
  const formats: Record<string, number> = {};
  for (const m of catalog.movies) {
    formats[m.format] = (formats[m.format] || 0) + 1;
  }
  for (const [format, count] of Object.entries(formats)) {
    console.log(`     - ${format}: ${count} movies`);
  }
  
  console.log('\n🎉 Catalog generation complete!');
}

main().catch(console.error);
