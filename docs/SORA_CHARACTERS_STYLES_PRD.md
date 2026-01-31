# Sora Characters & Styles Feature PRD

## Overview

Add Characters and Style Presets to the AI Video Generation page, enabling users to create consistent characters across videos and apply predefined visual styles to their generations.

## Background

OpenAI's Sora offers:
- **Style Presets**: Predefined visual styles (Cinematic, Anime, Film Noir, etc.)
- **Characters**: Reusable character definitions for consistency across videos
- **Camera Motion**: Predefined camera movements and shots

This PRD outlines implementing similar features in MediaPoster's AI Generations page.

---

## Feature 1: Style Presets

### Description
Predefined visual styles that modify how the AI generates video content.

### Available Styles

| Style | Description | Example Keywords |
|-------|-------------|------------------|
| **Cinematic** | Film-like visuals with dramatic lighting | 35mm film, shallow depth of field, golden hour |
| **Photorealistic** | Ultra-realistic, lifelike footage | 8K, photorealistic, natural lighting |
| **Anime** | Japanese animation style | Hand-drawn, vibrant colors, anime style |
| **Cyberpunk** | Futuristic neon aesthetics | Neon lights, rain, dystopian, holographic |
| **Film Noir** | Classic black-and-white dramatic style | Black and white, high contrast, shadows |
| **Dreamy** | Soft, ethereal visuals | Soft focus, pastel colors, ethereal glow |
| **Stop Motion** | Frame-by-frame animation look | Claymation, stop motion, handcrafted |
| **Vintage** | Retro film aesthetics | VHS, grain, 70s film stock, faded colors |
| **Surreal** | Abstract, dreamlike imagery | Salvador Dali, impossible geometry, dreamscape |
| **Documentary** | Raw, authentic footage style | Handheld, natural, unscripted feel |

### UI Requirements
- Grid of style cards with preview thumbnails
- Hover to see style description
- Click to select (only one style at a time)
- Selected style badge appears in prompt area
- Style keywords are automatically appended to prompt

---

## Feature 2: Camera Motion Presets

### Description
Predefined camera movements that define how the virtual camera behaves.

### Available Motions

| Motion | Description |
|--------|-------------|
| **Static** | Camera remains stationary |
| **Slow Pan Left/Right** | Gradual horizontal camera movement |
| **Slow Tilt Up/Down** | Gradual vertical camera movement |
| **Dolly In/Out** | Camera moves toward/away from subject |
| **Orbit** | Camera circles around subject |
| **Tracking Shot** | Camera follows moving subject |
| **Crane Shot** | Vertical movement, high to low or vice versa |
| **Zoom In/Out** | Lens zoom effect |
| **Handheld** | Slight shake for documentary feel |
| **Drone** | Aerial sweeping movements |

### UI Requirements
- Dropdown or icon grid for motion selection
- Visual icon representing each motion type
- Motion keywords appended to prompt

---

## Feature 3: Characters (Saved Characters)

### Description
Allow users to create, save, and reuse character definitions for consistent character appearance across multiple video generations.

### Character Definition Fields

```typescript
interface Character {
  id: string;
  name: string;
  description: string;           // Detailed appearance description
  referenceImageUrl?: string;    // Optional reference image
  attributes: {
    gender?: string;
    age?: string;
    ethnicity?: string;
    hairColor?: string;
    hairStyle?: string;
    eyeColor?: string;
    bodyType?: string;
    clothing?: string;
    distinguishingFeatures?: string;
  };
  createdAt: string;
  usageCount: number;
}
```

### UI Requirements

#### Character Library
- Grid view of saved characters
- Character card shows: name, thumbnail/avatar, description preview
- Quick actions: Edit, Delete, Use in Prompt

#### Character Creator Modal
- Form fields for all attributes
- Optional image upload for reference
- AI-generated preview of character description
- Save to library

#### Character Usage
- "Add Character" button in generation form
- Character picker modal
- Selected characters appear as tags
- Character descriptions injected into prompt

---

## Feature 4: Scene Presets (Templates)

### Description
Complete scene templates combining style, camera, and setting.

### Example Presets

| Preset | Style | Camera | Setting |
|--------|-------|--------|---------|
| **Product Showcase** | Cinematic | Orbit | Studio, white background |
| **Nature Documentary** | Documentary | Drone | Outdoor, natural |
| **Music Video** | Cyberpunk | Tracking | Urban, night |
| **Corporate** | Photorealistic | Static | Office, professional |
| **Social Vertical** | Dreamy | Static | Lifestyle, aesthetic |
| **Tutorial** | Photorealistic | Static | Indoor, well-lit |

---

## Technical Implementation

### Backend API Endpoints

```
GET  /api/ai-video/styles           - List available styles
GET  /api/ai-video/camera-motions   - List camera motions
GET  /api/ai-video/characters       - List user's saved characters
POST /api/ai-video/characters       - Create new character
PUT  /api/ai-video/characters/:id   - Update character
DELETE /api/ai-video/characters/:id - Delete character
```

### Prompt Enhancement

When generating, the system combines:
1. User's base prompt
2. Selected style keywords
3. Selected camera motion
4. Character descriptions (if any)

Example:
```
Base: "A person walking through a forest"
Style: Cinematic → ", cinematic, 35mm film, shallow depth of field"
Camera: Slow dolly → ", slow dolly forward"
Character: "Sarah" → "Sarah, a 25-year-old woman with long red hair..."

Final: "Sarah, a 25-year-old woman with long red hair, walking through 
a forest, cinematic, 35mm film, shallow depth of field, slow dolly forward"
```

### Database Schema

```sql
CREATE TABLE ai_video_characters (
  id UUID PRIMARY KEY,
  user_id UUID,
  name VARCHAR(100),
  description TEXT,
  reference_image_url TEXT,
  attributes JSONB,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_video_style_presets (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100),
  description TEXT,
  keywords TEXT[],
  thumbnail_url TEXT,
  category VARCHAR(50)
);
```

---

## UI Mockup Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ Sora                                          [Generate] [Templates] [History] │
│ Configure your video generation                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│ ┌─ Style Preset ────────────────────────────────────────────────┐ │
│ │ [Cinematic] [Anime] [Cyberpunk] [Film Noir] [Dreamy] [+More]  │ │
│ └───────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ ┌─ Characters ──────────────────────────────────────────────────┐ │
│ │ [+ Add Character]  [Sarah 👩‍🦰] [Alex 👨]                      │ │
│ └───────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ Duration: [10s ▼]  Resolution: [1080p ▼]  Aspect: [9:16 ▼]       │
│                                                                   │
│ Camera Motion: [Static ▼]                                         │
│                                                                   │
│ ┌─ Video Prompt ────────────────────────────────────────────────┐ │
│ │ Describe the video you want to create...                       │ │
│ │                                                                 │ │
│ │ Selected: [Cinematic ✕] [Sarah ✕]                              │ │
│ └───────────────────────────────────────────────────────────────┘ │
│                                                                   │
│ Estimated: ~10s video at 1080p              [🎬 Generate Video]   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Success Metrics

- **Adoption**: % of video generations using style presets
- **Character Reuse**: Average characters per user, reuse rate
- **Generation Quality**: User satisfaction with styled outputs
- **Time Saved**: Reduction in prompt iteration cycles

---

## Implementation Phases

### Phase 1 (MVP)
- [ ] Style presets UI (10 styles)
- [ ] Camera motion dropdown
- [ ] Prompt enhancement logic

### Phase 2
- [ ] Character library (create, save, list)
- [ ] Character picker in generation form
- [ ] Character prompt injection

### Phase 3
- [ ] Scene templates combining all elements
- [ ] AI-powered character description generator
- [ ] Style preview thumbnails

---

## Timeline

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Phase 1 | 1 day | Styles + Camera Motion |
| Phase 2 | 2 days | Characters System |
| Phase 3 | 2 days | Templates + Polish |

---

*Created: December 22, 2025*
*Status: Ready for Implementation*
