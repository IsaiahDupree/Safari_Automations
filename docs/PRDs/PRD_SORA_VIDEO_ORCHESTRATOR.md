# Product Requirements Document (PRD)
# Sora Video Orchestrator for MediaPoster

**Version:** 1.0.0  
**Date:** December 2024  
**Status:** Draft  

---

## Executive Summary

Build a comprehensive video orchestration system that enables creation of long-form videos (up to 5 minutes) by intelligently chunking narratives into manageable clips, generating via Sora API (with fallback providers), assessing quality, and assembling into final renders.

### Key Roles
| Role | Responsibility |
|------|----------------|
| **Content Brief** | Defines objective, audience, tone, CTA |
| **Director** | Orchestrates narrative flow, pacing, clip planning |
| **Scene Crafter** | Builds provider-specific prompts with style/character bibles |
| **Assessor** | Quality checks: transcript, visual, continuity, artifacts |

---

## Problem Statement

Current video AI generators (Sora, Runway, Kling) produce **short clips (4-20 seconds)**. Creating coherent long-form content requires:

1. **Narrative chunking** — Breaking scripts into clips where actors can speak naturally
2. **Pacing control** — ~150 wpm narration = ~25-35 words per 12s clip
3. **Quality assessment** — Did the video match the prompt? Is continuity maintained?
4. **Retry/Remix loops** — Failed clips need intelligent repair
5. **Timeline assembly** — Stitch clips + transitions + audio into final render

---

## Goals & Success Metrics

### Goals
- [ ] Generate coherent videos up to **5 minutes** from scripts/briefs
- [ ] Maintain **character/style consistency** across clips via "bibles"
- [ ] **Auto-assess** generated clips for quality (pass/fail/retry)
- [ ] Support **multiple providers** (Sora primary, Runway/Kling fallback)
- [ ] Provide **UI workflows** for single generation and storyboard mode

### Success Metrics
| Metric | Target |
|--------|--------|
| Clip pass rate (first attempt) | > 70% |
| Average retry count per clip | < 2 |
| Time to generate 60s video | < 15 min |
| User satisfaction score | > 4.0/5.0 |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MediaPoster Frontend                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Single Gen   │  │ Storyboard   │  │ Project Dashboard        │  │
│  │ (Sora Panel) │  │ Workflow     │  │ (Timeline + Assessments) │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     MediaPoster Backend (Python)                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Video Orchestrator Service                  │  │
│  │  ┌─────────┐  ┌─────────────┐  ┌──────────┐  ┌────────────┐  │  │
│  │  │Director │→ │Scene Crafter│→ │Generator │→ │ Assessor   │  │  │
│  │  │(Planner)│  │(Prompt Bake)│  │(Provider)│  │(QA/Retry)  │  │  │
│  │  └─────────┘  └─────────────┘  └──────────┘  └────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Provider Adapters                           │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │  │
│  │  │  Sora   │  │ Runway  │  │  Kling  │  │  Mock   │          │  │
│  │  │ Adapter │  │ Adapter │  │ Adapter │  │(Testing)│          │  │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Timeline Assembler                          │  │
│  │  • Concatenate clips  • Add transitions  • Overlay audio      │  │
│  │  • Render final MP4 via MoviePy/FFmpeg                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Supabase Database                            │
│  projects, bibles, content_briefs, scripts, clip_plans,             │
│  scenes, clip_plan_clips, clip_runs, assessments, assets, renders   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Database Schema + Core Models

### Duration: 1-2 days

### Deliverables

1. **Supabase Migration** — `supabase/migrations/XXX_video_orchestrator.sql`
2. **Python Models** — SQLAlchemy models + Pydantic schemas
3. **ClipPlan JSON Schema** — Validation for orchestration payloads

### Database Tables

| Table | Purpose |
|-------|---------|
| `video_projects` | Top-level project container |
| `style_bibles` | Visual style rules (colors, lighting, mood) |
| `character_bibles` | Character appearance/personality canon |
| `content_briefs` | Objective, audience, tone, CTA |
| `scripts` | Full script text |
| `clip_plans` | Orchestration plan (JSON + status) |
| `scenes` | Scene containers within clip plans |
| `clip_plan_clips` | Individual clip definitions |
| `clip_runs` | Provider generation attempts |
| `assessments` | QA results per run |
| `video_assets` | Stored video/image files |
| `final_renders` | Assembled timeline outputs |

### Key Constraints
- `max_total_seconds`: 300 (5 minutes)
- `default_clip_seconds`: 4, 8, or 12 (Sora limits)
- `pacing.words_per_minute`: 90-200 (default 150)
- `retry_policy.max_attempts`: 1-10 (default 3)

---

## Phase 2: Provider Adapters (Sora-First)

### Duration: 2-3 days

### Deliverables

1. **Base Provider Interface** — `services/video_providers/base.py`
2. **Sora Adapter** — `services/video_providers/sora_provider.py`
3. **Mock Adapter** — `services/video_providers/mock_provider.py`
4. **Provider Factory** — Dynamic loading based on config

### Provider Interface

```python
class VideoProviderAdapter(ABC):
    @property
    @abstractmethod
    def name(self) -> ProviderName: ...
    
    @abstractmethod
    async def create_clip(self, input: CreateClipInput) -> Generation: ...
    
    @abstractmethod
    async def remix_clip(self, input: RemixClipInput) -> Generation: ...
    
    @abstractmethod
    async def get_generation(self, generation_id: str) -> Generation: ...
    
    @abstractmethod
    async def download_content(self, generation: Generation) -> bytes: ...
```

### Sora-Specific Features
- Models: `sora-2`, `sora-2-pro`
- Durations: 4s, 8s, 12s
- Sizes: `720x1280` (9:16), `1280x720` (16:9), `1024x1792`, `1792x1024`
- Image reference support for style consistency
- Remix endpoint for iterative refinement

### Environment Variables
```env
SORA_API_KEY=sk-...
SORA_MODEL=sora-2
VIDEO_PROVIDER=sora  # sora | runway | kling | mock
```

---

## Phase 3: Director + Scene Crafter

### Duration: 2-3 days

### Deliverables

1. **Director Service** — Script → ClipPlan conversion
2. **Scene Crafter** — ClipPlan → Provider payloads
3. **Bible Injection** — Style/character consistency

### Director (Narrative Planner)

```python
class DirectorService:
    async def create_clip_plan(
        self,
        script: str,
        brief: ContentBrief,
        constraints: PlanConstraints
    ) -> ClipPlan:
        """
        1. Analyze script structure
        2. Identify natural break points
        3. Chunk into clips respecting pacing rules
        4. Assign visual intent to each clip
        5. Set acceptance criteria
        """
```

### Pacing Rules
| Duration | Max Words | Description |
|----------|-----------|-------------|
| 4s | ~10 words | Quick cuts, reactions |
| 8s | ~20 words | Standard dialogue |
| 12s | ~30 words | Extended scenes |

### Scene Crafter

```python
class SceneCrafterService:
    async def build_provider_payload(
        self,
        clip: ClipPlanClip,
        style_bible: StyleBible,
        character_bible: CharacterBible
    ) -> ProviderCreateInput:
        """
        1. Inject style rules into prompt
        2. Add character descriptions
        3. Apply continuity constraints
        4. Format for target provider
        """
```

---

## Phase 4: Assessor + Repair Loop

### Duration: 3-4 days

### Deliverables

1. **Assessor Service** — Multi-check quality assessment
2. **Repair Strategy Engine** — Prompt patch / Remix / Fallback
3. **Orchestration Loop** — Retry until pass or max attempts

### Assessment Checks

| Check | Weight | Method |
|-------|--------|--------|
| `transcript_match` | 0.25 | Whisper transcription → compare |
| `visual_requirements` | 0.30 | Vision model frame analysis |
| `continuity` | 0.20 | Character/setting consistency |
| `no_artifacts` | 0.15 | Glitch/gibberish detection |
| `duration_ok` | 0.10 | Actual vs target duration |

### Repair Strategies

```python
class RepairStrategy(Enum):
    PROMPT_PATCH = "prompt_patch"      # Add constraints
    REMIX = "remix"                     # Keep identity, adjust
    FALLBACK_PROVIDER = "fallback"     # Try different provider
```

### Assessment Flow

```
Generate Clip
    ↓
Assessor.assess()
    ↓
├── PASS → Mark clip passed, continue
├── FAIL → 
│   ├── attempt < max_attempts?
│   │   ├── YES → Apply repair strategy, retry
│   │   └── NO → Mark clip failed, halt or skip
│   └── repair_instruction.strategy?
│       ├── PROMPT_PATCH → Modify prompt, regenerate
│       ├── REMIX → Call remix endpoint
│       └── FALLBACK → Switch provider
```

---

## Phase 5: UI Integration (Sora Panel)

### Duration: 3-4 days

### Deliverables

1. **Single Generation Mode** — Quick clip creation
2. **Storyboard Workflow** — Full project management
3. **Timeline View** — Visual clip arrangement
4. **Assessment Dashboard** — QA results display

### Single Generation UI

```
┌────────────────────────────────────────────────────────┐
│                    Sora Generator                       │
├────────────────────────────────────────────────────────┤
│ Prompt: [____________________________________]         │
│                                                         │
│ Model: [sora-2 ▼]  Duration: [8s ▼]  Size: [16:9 ▼]   │
│                                                         │
│ [Upload Reference Image]                                │
│                                                         │
│ ┌─────────────────┐  ┌─────────────────┐              │
│ │   [Generate]    │  │  [Optimize Prompt] │             │
│ └─────────────────┘  └─────────────────┘              │
│                                                         │
│ History:                                                │
│ ├─ Clip 1 [✓ Passed] [Preview] [Download] [Remix]     │
│ ├─ Clip 2 [⟳ Processing...]                           │
│ └─ Clip 3 [✗ Failed] [Retry] [View Assessment]        │
└────────────────────────────────────────────────────────┘
```

### Storyboard Workflow UI

```
┌────────────────────────────────────────────────────────┐
│                   Storyboard Editor                     │
├────────────────────────────────────────────────────────┤
│ Project: [My Video Project]                             │
│                                                         │
│ Brief:                                                  │
│ ┌─────────────────────────────────────────────────────┐│
│ │ Objective: [Explain product features              ] ││
│ │ Audience:  [Tech founders                         ] ││
│ │ Tone:      [Professional, confident               ] ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ Script:                                                 │
│ ┌─────────────────────────────────────────────────────┐│
│ │ [Paste or write full script...]                     ││
│ │                                                      ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ [Generate Clip Plan]                                    │
│                                                         │
│ Timeline Preview:                                       │
│ ┌─────┬─────┬─────┬─────┬─────┬─────┐                 │
│ │ S1  │ S2  │ S3  │ S4  │ S5  │ ... │                 │
│ │ 12s │ 8s  │ 12s │ 4s  │ 8s  │     │                 │
│ │ [✓] │ [✓] │ [⟳] │ [_] │ [_] │     │                 │
│ └─────┴─────┴─────┴─────┴─────┴─────┘                 │
│                                                         │
│ [Start Generation] [Pause] [Export Timeline]           │
└────────────────────────────────────────────────────────┘
```

---

## Phase 6: Timeline Assembler

### Duration: 2-3 days

### Deliverables

1. **Clip Concatenation** — Sequential assembly
2. **Transition Engine** — Crossfades, cuts, wipes
3. **Audio Overlay** — VO + music + SFX
4. **Final Render** — MP4 export via MoviePy

### Assembly Pipeline

```python
class TimelineAssembler:
    async def assemble(
        self,
        clip_plan_id: str,
        transitions: List[Transition] = None,
        audio_tracks: List[AudioTrack] = None
    ) -> FinalRender:
        """
        1. Load all passed clips
        2. Order by scene + clip order
        3. Apply transitions between clips
        4. Mix audio tracks (VO, music, SFX)
        5. Render final MP4
        6. Upload to storage
        """
```

### Supported Transitions
- `cut` — Hard cut (default)
- `crossfade` — Dissolve (0.5-2s)
- `wipe` — Directional wipe
- `fade_black` — Fade to/from black

---

## API Endpoints

### Video Orchestrator Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/video/projects` | Create project |
| POST | `/api/v1/video/briefs` | Create content brief |
| POST | `/api/v1/video/clip-plans` | Generate clip plan from script |
| POST | `/api/v1/video/clip-plans/{id}/start` | Start generation |
| GET | `/api/v1/video/clip-plans/{id}/status` | Get progress |
| POST | `/api/v1/video/clips/{id}/assess` | Manual assessment trigger |
| POST | `/api/v1/video/clips/{id}/retry` | Manual retry |
| POST | `/api/v1/video/renders` | Start final render |
| GET | `/api/v1/video/renders/{id}` | Get render status |

### Sora Direct Routes (Single Gen)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/sora/generate` | Generate single clip |
| POST | `/api/v1/sora/remix` | Remix existing clip |
| GET | `/api/v1/sora/videos/{id}` | Get video status |
| GET | `/api/v1/sora/videos/{id}/content` | Download video |
| POST | `/api/v1/sora/optimize-prompt` | AI prompt enhancement |

---

## Testing Strategy

### Unit Tests (Per Phase)

| Phase | Test File | Coverage |
|-------|-----------|----------|
| 1 | `test_video_orchestrator_models.py` | DB models, schemas |
| 2 | `test_video_providers.py` | Provider adapters |
| 3 | `test_director_scene_crafter.py` | Planning services |
| 4 | `test_assessor.py` | Assessment logic |
| 5 | `test_video_api_endpoints.py` | API routes |
| 6 | `test_timeline_assembler.py` | Render pipeline |

### Integration Tests
- Full clip plan → generation → assessment → render flow
- Provider failover scenarios
- Concurrent clip generation

### Mock Provider
- Deterministic outputs for testing
- Configurable delay/failure simulation
- No API costs during development

---

## Environment Configuration

```env
# Video Provider
VIDEO_PROVIDER=sora
SORA_API_KEY=sk-...
SORA_MODEL=sora-2

# Fallback Providers
RUNWAY_API_KEY=...
KLING_API_KEY=...

# Assessment
WHISPER_MODEL=base
VISION_MODEL=gpt-4o

# Orchestration
MAX_CONCURRENT_CLIPS=3
DEFAULT_CLIP_DURATION=8
MAX_RETRY_ATTEMPTS=3

# Storage
VIDEO_STORAGE_BUCKET=video-assets
```

---

## Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: DB + Models | 1-2 days | None |
| Phase 2: Providers | 2-3 days | Phase 1 |
| Phase 3: Director + Crafter | 2-3 days | Phase 1 |
| Phase 4: Assessor | 3-4 days | Phase 2, 3 |
| Phase 5: UI | 3-4 days | Phase 4 |
| Phase 6: Assembler | 2-3 days | Phase 4 |

**Total: 13-19 days**

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Sora API rate limits | Implement queue with backoff |
| High generation costs | Mock provider for dev, cost tracking |
| Inconsistent character | Character bible + image references |
| Assessment false positives | Tunable thresholds, manual override |
| Long render times | Progressive status updates, background jobs |

---

## Future Enhancements

- [ ] Multi-language narration support
- [ ] A/B testing for prompt variations
- [ ] Collaborative editing (multiple users)
- [ ] Template library (pre-built clip plans)
- [ ] Analytics dashboard (cost, time, quality metrics)
- [ ] Additional providers (Pika, Luma, Haiper)

---

## References

- [OpenAI Sora Sample App](https://github.com/openai/openai-sora-sample-app)
- [Sora Video API Docs](https://platform.openai.com/docs/guides/video-generation)
- [MediaRouter (Multi-provider)](https://github.com/samagra14/mediagateway)
- [Sora MCP Server](https://github.com/Doriandarko/sora-mcp)

---

**Document Status:** Ready for Implementation  
**Next Step:** Phase 1 — Database Schema + Core Models
