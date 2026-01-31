/**
 * Video Encoder
 * 
 * High-quality video encoding using FFmpeg
 * Supports HEVC (H.265) and H.264 with configurable quality
 */

import { spawn } from 'child_process';
import { logger } from '../utils/logger.js';

/**
 * Encode video with high-quality settings
 * 
 * @param inputPath - Input video path
 * @param outputPath - Output video path
 * @param codec - 'hevc' or 'h264'
 * @param crf - Quality (0-51, lower = better, 18 recommended)
 * @param preset - Speed/quality tradeoff ('ultrafast' to 'veryslow')
 */
export async function encodeVideo(
  inputPath: string,
  outputPath: string,
  codec: 'hevc' | 'h264' = 'hevc',
  crf: number = 18,
  preset: string = 'medium'
): Promise<void> {
  logger.info(`[Encoder] Encoding with ${codec.toUpperCase()} CRF ${crf} preset ${preset}`);

  const codecLib = codec === 'hevc' ? 'libx265' : 'libx264';
  
  // HEVC-specific options for better quality
  const codecOptions = codec === 'hevc' 
    ? ['-x265-params', 'log-level=error']
    : [];

  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-c:v', codecLib,
      '-preset', preset,
      '-crf', String(crf),
      ...codecOptions,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      outputPath,
    ];

    logger.debug(`[Encoder] FFmpeg args: ${args.join(' ')}`);

    const ffmpeg = spawn('ffmpeg', args);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
      const line = data.toString();
      
      // Log progress updates
      if (line.includes('frame=') && line.includes('fps=')) {
        const frameMatch = line.match(/frame=\s*(\d+)/);
        const fpsMatch = line.match(/fps=\s*([\d.]+)/);
        if (frameMatch && fpsMatch) {
          logger.debug(`[Encoder] Frame ${frameMatch[1]} @ ${fpsMatch[1]} fps`);
        }
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        logger.info(`[Encoder] ✅ Encoding complete`);
        resolve();
      } else {
        logger.error(`[Encoder] FFmpeg stderr: ${stderr.slice(-500)}`);
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (error) => {
      logger.error(`[Encoder] FFmpeg error: ${error.message}`);
      reject(error);
    });
  });
}

/**
 * Get video info using ffprobe
 */
export async function getVideoInfo(inputPath: string): Promise<{
  width: number;
  height: number;
  duration: number;
  fps: number;
  codec: string;
}> {
  return new Promise((resolve, reject) => {
    const probe = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration,r_frame_rate,codec_name',
      '-of', 'json',
      inputPath,
    ]);

    let output = '';
    probe.stdout.on('data', (data) => {
      output += data.toString();
    });

    probe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('ffprobe failed'));
        return;
      }

      try {
        const data = JSON.parse(output);
        const stream = data.streams[0];
        
        // Parse frame rate (e.g., "30/1" or "30000/1001")
        const [num, den] = stream.r_frame_rate.split('/').map(Number);
        const fps = num / den;

        resolve({
          width: stream.width,
          height: stream.height,
          duration: parseFloat(stream.duration) || 0,
          fps,
          codec: stream.codec_name,
        });
      } catch (e) {
        reject(new Error('Failed to parse ffprobe output'));
      }
    });

    probe.on('error', reject);
  });
}
