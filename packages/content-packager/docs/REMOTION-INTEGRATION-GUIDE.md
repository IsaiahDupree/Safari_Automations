# Remotion Content Recreation Server — Integration Guide

> How to build a server that consumes ContentPackages and recreates content using Remotion + supporting APIs.

---

## Architecture Overview

```
┌──────────────────────┐     ┌──────────────────────────────────┐
│  Safari Automation   │     │  Content Recreation Server       │
│  (this repo)         │     │  (separate server)               │
│                      │     │                                  │
│  Market Research     │     │  ┌────────────────────────────┐  │
│  ├─ FB Scraper       │     │  │  Package Ingestion API     │  │
│  ├─ IG Scraper       │────>│  │  POST /api/packages/ingest │  │
│  ├─ Ad Library       │     │  └────────────┬───────────────┘  │
│  └─ Creative Radar   │     │               │                  │
│                      │     │  ┌────────────▼───────────────┐  │
│  Content Packager    │     │  │  Recreation Pipeline       │  │
│  └─ Generates        │     │  │  1. Parse ContentPackage   │  │
│     ContentPackages  │     │  │  2. Download media assets   │  │
│     (JSON batches)   │     │  │  3. Adapt copy (OpenAI)    │  │
│                      │     │  │  4. Generate voiceover      │  │
│  Scheduler API       │     │  │  5. Render (Remotion)      │  │
│  POST /api/content/  │     │  │  6. Post-process (ffmpeg)  │  │
│    package           │     │  └────────────┬───────────────┘  │
│  POST /api/content/  │     │               │                  │
│    package/send      │     │  ┌────────────▼───────────────┐  │
│                      │     │  │  Output                    │  │
└──────────────────────┘     │  │  ├─ Rendered videos/images  │  │
                             │  │  ├─ Publish queue           │  │
                             │  │  └─ Analytics dashboard     │  │
                             │  └────────────────────────────┘  │
                             └──────────────────────────────────┘
```

---

## 1. Required Dependencies

The content recreation server needs these tools/services:

### Core Rendering
```json
{
  "@remotion/cli": "^4.0.0",
  "@remotion/renderer": "^4.0.0",
  "@remotion/player": "^4.0.0"
}
```

### Supporting Services

| Service | Purpose | Auth | Docs |
|---------|---------|------|------|
| **Remotion** | Video/image rendering | License key | https://remotion.dev/docs |
| **OpenAI** | Copy adaptation, hook generation | API key | https://platform.openai.com |
| **ElevenLabs** | Text-to-speech voiceover | API key | https://elevenlabs.io/docs |
| **Sora** | AI video generation (via Safari) | Safari automation | Internal |
| **ffmpeg** | Video post-processing | Local install | https://ffmpeg.org |
| **sharp** | Image processing/resizing | npm package | https://sharp.pixelplumbing.com |

### Recommended Stack
```json
{
  "runtime": "Node.js 20+",
  "framework": "Express or Fastify",
  "rendering": "Remotion 4.x",
  "queue": "BullMQ + Redis (for render jobs)",
  "storage": "Local filesystem or S3",
  "database": "SQLite or PostgreSQL (job tracking)"
}
```

---

## 2. Package Ingestion API

### `POST /api/packages/ingest`

Accepts a `ContentPackageBatch` or single `ContentPackage`.

```typescript
// Example: Ingest a batch
app.post('/api/packages/ingest', async (req, res) => {
  const batch: ContentPackageBatch = req.body;
  
  for (const pkg of batch.packages) {
    // Queue each package for processing
    await renderQueue.add('recreate', {
      packageId: pkg.id,
      package: pkg,
      priority: pkg.recreation.priority,
    });
  }
  
  res.json({
    accepted: batch.packages.length,
    batchId: batch.id,
  });
});
```

### `POST /api/packages/ingest/file`

Accepts a path to a batch JSON file on the local filesystem:

```typescript
app.post('/api/packages/ingest/file', async (req, res) => {
  const { filePath } = req.body;
  const batch = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  // ... same as above
});
```

---

## 3. Recreation Pipeline

For each `ContentPackage`, the pipeline runs these steps:

### Step 1: Parse & Validate

```typescript
function validatePackage(pkg: ContentPackage): boolean {
  return (
    pkg.schemaVersion === '1.0' &&
    pkg.content.originalText.length > 0 &&
    pkg.renderSpec.compositionId !== ''
  );
}
```

### Step 2: Download Media Assets

```typescript
async function downloadAssets(pkg: ContentPackage): Promise<string[]> {
  const localPaths: string[] = [];
  
  for (const asset of pkg.media.assets) {
    // Prefer local path if already downloaded
    if (asset.localPath && fs.existsSync(asset.localPath)) {
      localPaths.push(asset.localPath);
      continue;
    }
    
    // Download from remote URL
    if (asset.remoteUrl) {
      const ext = asset.type === 'video' ? '.mp4' : '.jpg';
      const localPath = path.join(ASSETS_DIR, `${pkg.id}_${asset.index}${ext}`);
      await downloadFile(asset.remoteUrl, localPath);
      localPaths.push(localPath);
    }
  }
  
  return localPaths;
}
```

### Step 3: Adapt Copy with OpenAI

```typescript
async function adaptCopy(pkg: ContentPackage): Promise<AdaptedCopy> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a content recreation specialist. Adapt the following content 
        for our brand while keeping the same tone (${pkg.content.tone}) and hook structure.
        Original hook: "${pkg.content.hook}"
        Original CTA: "${pkg.content.cta}"
        Keep the emotional core but make it unique.`
      },
      {
        role: 'user',
        content: pkg.content.originalText,
      }
    ],
  });
  
  return {
    adaptedHook: /* parse response */,
    adaptedBody: /* parse response */,
    adaptedCta: /* parse response */,
    scriptBeats: /* parse response into array */,
  };
}
```

### Step 4: Generate Voiceover (Video Content)

```typescript
async function generateVoiceover(scriptBeats: string[]): Promise<string> {
  const fullScript = scriptBeats.join('. ');
  
  const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/YOUR_VOICE_ID', {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: fullScript,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  
  const audioPath = path.join(ASSETS_DIR, `voiceover_${Date.now()}.mp3`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(audioPath, buffer);
  return audioPath;
}
```

### Step 5: Render with Remotion

```typescript
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill } from '@remotion/renderer';

async function renderContent(pkg: ContentPackage, assets: RenderAssets): Promise<string> {
  const bundleLocation = await bundle({
    entryPoint: path.join(__dirname, 'remotion/index.ts'),
  });
  
  const { compositionId, durationSec, fps, resolution, aspectRatio } = pkg.renderSpec;
  const { style } = pkg.renderSpec;
  
  // Input props passed to the Remotion composition
  const inputProps = {
    // Content
    hook: assets.adaptedCopy.adaptedHook,
    body: assets.adaptedCopy.adaptedBody,
    cta: assets.adaptedCopy.adaptedCta,
    scriptBeats: assets.adaptedCopy.scriptBeats,
    
    // Media
    backgroundMedia: assets.downloadedPaths[0] || null,
    additionalMedia: assets.downloadedPaths.slice(1),
    voiceoverPath: assets.voiceoverPath,
    
    // Style from renderSpec
    primaryColor: style.primaryColor,
    secondaryColor: style.secondaryColor,
    backgroundColor: style.backgroundColor,
    textColor: style.textColor,
    fontFamily: style.fontFamily,
    headingFontFamily: style.headingFontFamily,
    layout: style.layout,
    textAnimation: style.textAnimation,
    backgroundStyle: style.backgroundStyle,
    musicMood: style.musicMood,
  };
  
  if (pkg.renderSpec.outputFormat === 'video') {
    const outputPath = path.join(OUTPUT_DIR, `${pkg.id}.mp4`);
    
    await renderMedia({
      composition: {
        id: compositionId,
        durationInFrames: durationSec * fps,
        fps,
        width: resolution.width,
        height: resolution.height,
      },
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps,
    });
    
    return outputPath;
  } else {
    // Static image
    const outputPath = path.join(OUTPUT_DIR, `${pkg.id}.png`);
    
    await renderStill({
      composition: {
        id: compositionId,
        durationInFrames: 1,
        fps: 1,
        width: resolution.width,
        height: resolution.height,
      },
      serveUrl: bundleLocation,
      output: outputPath,
      inputProps,
    });
    
    return outputPath;
  }
}
```

### Step 6: Post-Process with ffmpeg

```typescript
async function postProcess(videoPath: string, pkg: ContentPackage): Promise<string> {
  const outputPath = videoPath.replace('.mp4', '_final.mp4');
  
  // Add watermark, normalize audio, ensure codec compatibility
  await execAsync(`ffmpeg -i "${videoPath}" \
    -vf "scale=${pkg.renderSpec.resolution.width}:${pkg.renderSpec.resolution.height}" \
    -c:v libx264 -preset medium -crf 23 \
    -c:a aac -b:a 128k \
    -movflags +faststart \
    "${outputPath}"`);
  
  return outputPath;
}
```

---

## 4. Remotion Composition Examples

### TextOverlayReel (starter template)

```tsx
// remotion/compositions/TextOverlayReel.tsx
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Sequence } from 'remotion';

interface Props {
  hook: string;
  scriptBeats: string[];
  primaryColor: string;
  textColor: string;
  backgroundColor: string;
  textAnimation: string;
  backgroundMedia?: string;
}

export const TextOverlayReel: React.FC<Props> = ({
  hook, scriptBeats, primaryColor, textColor, backgroundColor,
  textAnimation, backgroundMedia,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  
  const beatDuration = Math.floor(durationInFrames / (scriptBeats.length + 1));
  
  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {backgroundMedia && (
        <video src={backgroundMedia} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.4 }} />
      )}
      
      {/* Hook - first beat */}
      <Sequence from={0} durationInFrames={beatDuration}>
        <AnimatedText text={hook} animation={textAnimation} color={primaryColor} frame={frame} />
      </Sequence>
      
      {/* Script beats */}
      {scriptBeats.map((beat, i) => (
        <Sequence key={i} from={beatDuration * (i + 1)} durationInFrames={beatDuration}>
          <AnimatedText text={beat} animation={textAnimation} color={textColor} frame={frame - beatDuration * (i + 1)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
```

### CarouselSlideshow

```tsx
// remotion/compositions/CarouselSlideshow.tsx
import { AbsoluteFill, Sequence, Img, interpolate, useCurrentFrame } from 'remotion';

interface Props {
  slides: Array<{ text: string; imagePath?: string }>;
  primaryColor: string;
  textColor: string;
}

export const CarouselSlideshow: React.FC<Props> = ({ slides, primaryColor, textColor }) => {
  const frame = useCurrentFrame();
  const slideFrames = 90; // 3 seconds per slide at 30fps
  
  return (
    <AbsoluteFill>
      {slides.map((slide, i) => (
        <Sequence key={i} from={i * slideFrames} durationInFrames={slideFrames}>
          <AbsoluteFill style={{
            backgroundColor: i % 2 === 0 ? primaryColor : '#111',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 60,
          }}>
            {slide.imagePath && (
              <Img src={slide.imagePath} style={{ maxWidth: '80%', maxHeight: '50%', borderRadius: 12 }} />
            )}
            <h2 style={{ color: textColor, fontSize: 48, textAlign: 'center', marginTop: 20 }}>
              {slide.text}
            </h2>
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
```

---

## 5. API Endpoints for the Recreation Server

### Required Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/packages/ingest` | Accept a ContentPackageBatch |
| `POST` | `/api/packages/ingest/file` | Ingest from a local file path |
| `GET` | `/api/packages/:id` | Get package status |
| `GET` | `/api/packages/:id/result` | Get rendered output path |
| `POST` | `/api/render/:packageId` | Manually trigger render |
| `GET` | `/api/render/queue` | View render queue status |
| `GET` | `/api/render/:packageId/status` | Check render progress |
| `POST` | `/api/render/batch` | Render all packages in a batch |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/compositions` | List available Remotion compositions |

### Status Response

```json
{
  "packageId": "pkg_fb_abc123_170000000",
  "status": "rendered",
  "steps": {
    "ingested": true,
    "assetsDownloaded": true,
    "copyAdapted": true,
    "voiceoverGenerated": true,
    "rendered": true,
    "postProcessed": true
  },
  "output": {
    "videoPath": "/output/pkg_fb_abc123.mp4",
    "thumbnailPath": "/output/pkg_fb_abc123_thumb.jpg",
    "durationSec": 30,
    "fileSizeMb": 12.4
  }
}
```

---

## 6. Sending Packages from Safari Automation

### Option A: Direct HTTP POST

```bash
# From Safari Automation scheduler
curl -X POST http://RECREATION_SERVER:4000/api/packages/ingest \
  -H "Content-Type: application/json" \
  -d @~/market-research/content-packages/batch_1234567890.json
```

### Option B: File Path (same machine or shared filesystem)

```bash
curl -X POST http://RECREATION_SERVER:4000/api/packages/ingest/file \
  -H "Content-Type: application/json" \
  -d '{"filePath": "/Users/isaiahdupree/market-research/content-packages/batch_1234567890.json"}'
```

### Option C: Scheduler API Integration

The Safari Automation scheduler can trigger packaging and sending:

```bash
# Package research data and send to recreation server
curl -X POST http://localhost:3010/api/content/package \
  -H "Content-Type: application/json" \
  -d '{"topN": 20, "platforms": ["facebook", "instagram"], "sendTo": "http://RECREATION_SERVER:4000"}'
```

---

## 7. Environment Variables

The recreation server needs:

```env
# Remotion
REMOTION_LICENSE_KEY=your_license_key

# OpenAI (copy adaptation)
OPENAI_API_KEY=sk-...

# ElevenLabs (voiceover)
ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=default_voice_id

# Sora (optional, via Safari Automation callback)
SAFARI_AUTOMATION_URL=http://localhost:3010

# Storage
OUTPUT_DIR=/path/to/rendered/output
ASSETS_DIR=/path/to/temp/assets

# Queue
REDIS_URL=redis://localhost:6379
```

---

## 8. Recommended Project Structure

```
content-recreation-server/
├── src/
│   ├── index.ts                # Express server entry
│   ├── api/
│   │   ├── packages.ts         # Package ingestion endpoints
│   │   ├── render.ts           # Render control endpoints
│   │   └── health.ts           # Health check
│   ├── pipeline/
│   │   ├── download.ts         # Media asset downloader
│   │   ├── adapt-copy.ts       # OpenAI copy adaptation
│   │   ├── voiceover.ts        # ElevenLabs TTS
│   │   ├── render.ts           # Remotion rendering
│   │   └── post-process.ts     # ffmpeg post-processing
│   ├── queue/
│   │   ├── render-queue.ts     # BullMQ render job queue
│   │   └── workers.ts          # Queue workers
│   └── types/
│       └── content-package.ts  # Copy of ContentPackage types
├── remotion/
│   ├── index.ts                # Remotion entry point
│   ├── Root.tsx                # Root component registering all compositions
│   └── compositions/
│       ├── TextOverlayReel.tsx
│       ├── EmotionalStoryReel.tsx
│       ├── KineticTextExplainer.tsx
│       ├── QuickCutMeme.tsx
│       ├── ProductShowcase.tsx
│       ├── NarrativeReel.tsx
│       ├── CarouselSlideshow.tsx
│       └── StaticPostCard.tsx
├── package.json
├── tsconfig.json
├── .env
└── README.md
```
