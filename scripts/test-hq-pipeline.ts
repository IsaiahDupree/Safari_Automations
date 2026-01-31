/**
 * Test HQ Pipeline: Watermark Removal + AI Upscale
 * 
 * Tests the full Safari Automation → Modal GPU pipeline
 */

import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env from project root
config({ path: resolve(__dirname, '../.env') });

const API_URL = process.env.API_URL || 'http://localhost:7070';
const TEST_VIDEO = process.argv[2] || '/Users/isaiahdupree/Documents/Software/WaterMarkRemover - BlankLogo/test-videos/sora-watermark-test.mp4';

interface JobResponse {
  job_id: string;
  status: string;
  progress?: number;
  stage?: string;
  result?: {
    stats: {
      input_size_mb: number;
      output_size_mb: number;
      processing_time_s: number;
      watermarks_detected: number;
      upscaled: boolean;
      method: string;
    };
  };
  error?: string;
}

async function main() {
  console.log('🧪 Testing Safari Automation HQ Pipeline');
  console.log('=========================================');
  console.log(`API URL: ${API_URL}`);
  console.log(`Test Video: ${TEST_VIDEO}`);
  console.log('');

  // Check health first
  console.log('1️⃣  Checking API health...');
  const healthRes = await fetch(`${API_URL}/health`);
  const health = await healthRes.json();
  console.log(`   Status: ${health.status}`);
  console.log(`   Modal configured: ${health.config?.modal_configured}`);
  console.log('');

  if (!health.config?.modal_configured) {
    console.error('❌ Modal not configured! Add MODAL_TOKEN_ID and MODAL_TOKEN_SECRET to .env');
    process.exit(1);
  }

  // Read test video
  console.log('2️⃣  Reading test video...');
  const videoBytes = readFileSync(TEST_VIDEO);
  const videoBase64 = videoBytes.toString('base64');
  console.log(`   Size: ${(videoBytes.length / 1024 / 1024).toFixed(2)} MB`);
  console.log('');

  // Submit job
  console.log('3️⃣  Submitting HQ processing job...');
  console.log('   Options: watermark removal (Modal YOLO+LAMA) + AI upscale (Real-ESRGAN 2x)');
  
  const submitRes = await fetch(`${API_URL}/api/v1/video/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_bytes: videoBase64,
      options: {
        watermark_removal: {
          enabled: true,
          method: 'modal',
          platform: 'sora',
        },
        upscaling: {
          enabled: true,
          scale: 2,
          model: 'real-esrgan',
        },
        encoding: {
          codec: 'hevc',
          crf: 18,
        },
      },
      metadata: {
        test: true,
        source: 'hq-pipeline-test',
      },
    }),
  });

  const submitData = await submitRes.json();
  console.log(`   Job ID: ${submitData.job_id}`);
  console.log(`   Estimated time: ${submitData.estimated_time_seconds}s`);
  console.log('');

  // Poll for completion
  console.log('4️⃣  Processing (this may take 2-5 minutes)...');
  const startTime = Date.now();
  let lastProgress = 0;
  let lastStage = '';

  while (true) {
    await new Promise(r => setTimeout(r, 5000)); // Poll every 5s

    const statusRes = await fetch(`${API_URL}/api/v1/jobs/${submitData.job_id}`);
    const status: JobResponse = await statusRes.json();

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Show progress updates
    if (status.progress !== lastProgress || status.stage !== lastStage) {
      console.log(`   [${elapsed}s] ${status.progress}% - ${status.stage}`);
      lastProgress = status.progress || 0;
      lastStage = status.stage || '';
    }

    if (status.status === 'completed') {
      console.log('');
      console.log('✅ Processing complete!');
      console.log('');
      console.log('📊 Results:');
      console.log(`   Method: ${status.result?.stats.method}`);
      console.log(`   Input: ${status.result?.stats.input_size_mb} MB`);
      console.log(`   Output: ${status.result?.stats.output_size_mb} MB`);
      console.log(`   Watermarks detected: ${status.result?.stats.watermarks_detected}`);
      console.log(`   Upscaled: ${status.result?.stats.upscaled}`);
      console.log(`   Processing time: ${status.result?.stats.processing_time_s}s`);
      console.log('');

      // Download result
      console.log('5️⃣  Downloading processed video...');
      const downloadRes = await fetch(`${API_URL}/api/v1/jobs/${submitData.job_id}/download`);
      const outputBuffer = Buffer.from(await downloadRes.arrayBuffer());
      
      const outputPath = `./test-output-${submitData.job_id}.mp4`;
      writeFileSync(outputPath, outputBuffer);
      console.log(`   Saved to: ${outputPath}`);
      console.log('');
      console.log('🎉 Test complete!');
      break;
    }

    if (status.status === 'failed') {
      console.log('');
      console.error(`❌ Job failed: ${status.error}`);
      process.exit(1);
    }

    // Timeout after 10 minutes
    if (elapsed > 600) {
      console.error('❌ Timeout: Job took longer than 10 minutes');
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
