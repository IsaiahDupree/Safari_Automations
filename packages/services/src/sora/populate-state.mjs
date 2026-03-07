#!/usr/bin/env node
// One-time script: register already-processed Sora videos in state + upload to YouTube

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://ivhfuhxorppptyuofbgq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aGZ1aHhvcnBwcHR5dW9mYmdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTUzODk5NywiZXhwIjoyMDg3MTE0OTk3fQ.iGefA7ArDMwQSg0diAw20h4rjLgDP_EWQa3khCIHkmA';
const BLOTATO_KEY = 'blt_LwwTS0Syws9jriila9i3PVXneUAWio0RXK++Wv/T8mY=';
const YOUTUBE_ACCOUNT_ID = '228';
const STATE_PATH = join(__dirname, 'sora-mcp-state.json');
const PASSPORT_RAW = '/Volumes/My Passport/Sora Videos/raw';
const PASSPORT_PROCESSED = '/Volumes/My Passport/Sora Videos/processed';

// Videos to register (skip 1772765197095 - 0 byte clean file)
const VIDEOS = [
  'manual-1772773629266',
  'manual-1772773636019',
  'manual-1772773642060',
  'manual-1772773648189',
];

function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); }
  catch { return { videos: [], trilogies: [], generatedToday: 0 }; }
}

function saveState(s) {
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

async function uploadToYouTube(cleanPath, videoId) {
  if (!existsSync(cleanPath)) {
    console.log('  SKIP: clean file not found:', cleanPath);
    return null;
  }
  const fileSize = readFileSync(cleanPath).length;
  if (fileSize < 1000) {
    console.log('  SKIP: file too small (' + fileSize + ' bytes)');
    return null;
  }

  console.log('  Uploading to Supabase Storage...');
  const filename = 'sora-' + Date.now() + '-' + videoId + '-clean.mp4';
  const bucket = 'sora-videos';
  const uploadUrl = SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + filename;

  try {
    execSync(
      'curl -s -X PUT "' + uploadUrl + '" -H "Authorization: Bearer ' + SUPABASE_KEY + '" -H "Content-Type: video/mp4" --data-binary @"' + cleanPath + '"',
      { timeout: 300000, stdio: 'pipe' }
    );
    const publicUrl = SUPABASE_URL + '/storage/v1/object/public/' + bucket + '/' + filename;
    console.log('  Public URL:', publicUrl);

    console.log('  Registering with Blotato media...');
    const mediaBody = JSON.stringify({ url: publicUrl });
    const mediaOut = execSync(
      "curl -s -X POST 'https://backend.blotato.com/v2/media' -H 'blotato-api-key: " + BLOTATO_KEY + "' -H 'Content-Type: application/json' -d '" + mediaBody.replace(/'/g, "'\\''") + "'",
      { timeout: 60000, stdio: 'pipe' }
    ).toString();
    let blotatoMediaUrl = publicUrl;
    try {
      const mr = JSON.parse(mediaOut);
      if (mr.url) blotatoMediaUrl = mr.url;
    } catch {}
    console.log('  Blotato media URL:', blotatoMediaUrl);

    console.log('  Posting to YouTube...');
    const title = 'AI Generated Sora Video — ' + videoId;
    const postBody = JSON.stringify({
      post: {
        accountId: Number(YOUTUBE_ACCOUNT_ID),
        content: { platform: 'youtube', text: title + '\n\nAI-generated video created with Sora.', mediaUrls: [blotatoMediaUrl] },
        target: { targetType: 'youtube', title: title.slice(0, 100), privacyStatus: 'public', shouldNotifySubscribers: true }
      }
    });
    const postOut = execSync(
      "curl -s -X POST 'https://backend.blotato.com/v2/posts' -H 'blotato-api-key: " + BLOTATO_KEY + "' -H 'Content-Type: application/json' -d '" + postBody.replace(/'/g, "'\\''") + "'",
      { timeout: 30000, stdio: 'pipe' }
    ).toString();
    console.log('  Blotato response:', postOut.slice(0, 300));

    let postResp;
    try { postResp = JSON.parse(postOut); } catch { return null; }
    if ((postResp.statusCode && postResp.statusCode >= 400) || postResp.error) {
      console.log('  ERROR:', JSON.stringify(postResp).slice(0, 200));
      return null;
    }
    const postId = postResp.postSubmissionId || postResp.id || postResp.post_id;
    return postId ? 'https://blotato.com/posts/' + postId : undefined;
  } catch (e) {
    console.log('  ERROR:', e.message);
    return null;
  }
}

async function main() {
  const state = loadState();
  if (!state.videos) state.videos = [];

  for (const vid of VIDEOS) {
    console.log('\nProcessing:', vid);
    const rawPath = PASSPORT_RAW + '/' + vid + '.mp4';
    const cleanPath = PASSPORT_PROCESSED + '/' + vid + '-clean.mp4';
    const framePath = PASSPORT_PROCESSED + '/' + vid + '-clean-frame.jpg';

    const youtubeUrl = await uploadToYouTube(cleanPath, vid);

    const record = {
      id: vid,
      soraVideoId: vid,
      prompt: 'Manually downloaded Sora video',
      rawPath,
      passportPath: rawPath,
      processedPath: cleanPath,
      thumbnailPath: existsSync(framePath) ? framePath : undefined,
      aiAnalysis: 'Manually processed video — AI analysis not run',
      qualityScore: 70,
      youtubeUrl: youtubeUrl || undefined,
      createdAt: new Date().toISOString(),
      status: 'processed',
    };

    const idx = state.videos.findIndex(v => v.id === vid || v.rawPath === rawPath);
    if (idx !== -1) {
      state.videos[idx] = { ...state.videos[idx], ...record };
      console.log('  Updated existing record');
    } else {
      state.videos.push(record);
      console.log('  Added new record');
    }

    saveState(state);
    console.log('  YouTube URL:', youtubeUrl || 'NOT UPLOADED (skipped or error)');
  }

  console.log('\nDone! State now has', state.videos.length, 'video(s).');
  console.log('State file:', STATE_PATH);
}

main().catch(console.error);
