# PRD: Sora Full Generation Pipeline

**Version:** 1.0  
**Date:** January 28, 2026  
**Status:** Implementation

---

## Overview

A fully automated Safari-based script that:
1. Enters a prompt with @isaiahdupree character
2. Selects video options (duration, aspect ratio)
3. Submits for generation
4. Polls /drafts for completion (count-based detection)
5. Downloads new videos automatically

---

## Success Criteria

| Criteria | Required |
|----------|----------|
| Enter prompt text | ✅ |
| Select @isaiahdupree character | ✅ |
| Select duration (10s, 15s, 25s) | ✅ |
| Select aspect ratio (Portrait/Landscape) | ✅ |
| Click "Create video" | ✅ |
| Poll /drafts for new videos | ✅ |
| Detect completion (count increases) | ✅ |
| Download to local machine | ✅ |
| Handle queue limit (max 3) | ✅ |
| No manual commands needed | ✅ |

---

## Technical Architecture

### Flow Diagram

```
[Enter Prompt] → [Select @isaiahdupree] → [Set Options] → [Create Video]
                                                              ↓
[Download] ← [Detect New Video] ← [Poll /drafts] ← [Wait for Generation]
```

### Queue Management

- Max 3 concurrent generations
- Track initial drafts count
- Poll every 30 seconds
- New video = count increased by 1
- Timeout after 10 minutes per video

---

## Script: `sora_full_pipeline.py`

### Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | str | required | Video description |
| `character` | str | "isaiahdupree" | Character to use |
| `duration` | int | 15 | Video length (10, 15, 25) |
| `aspect_ratio` | str | "Portrait" | Portrait or Landscape |
| `auto_download` | bool | True | Download when complete |
| `timeout` | int | 600 | Max wait time (seconds) |

### Output

```python
{
    "success": bool,
    "prompt": str,
    "character": str,
    "video_path": str,  # Local file path
    "generation_time": int,  # Seconds
    "file_size_mb": float
}
```

---

## Implementation Steps

### Step 1: Navigate to Sora Explore
```python
navigate_to("https://sora.chatgpt.com/explore")
```

### Step 2: Clear & Enter Prompt
```javascript
// Clear existing prompt
textarea.value = '';
// Enter new prompt
textarea.value = prompt;
textarea.dispatchEvent(new Event('input', {bubbles: true}));
```

### Step 3: Select Character (@isaiahdupree)
```javascript
// Click Characters tab
document.querySelector('button:contains("Characters")').click();
// Select isaiahdupree
document.querySelector('button:contains("isaiahdupree")').click();
```

### Step 4: Set Duration
```javascript
// Open duration dropdown
document.querySelector('button:contains("s")').click();
// Select duration
document.querySelector('[role=menuitem]:contains("15 seconds")').click();
```

### Step 5: Set Aspect Ratio
```javascript
// Open aspect dropdown
document.querySelector('button:contains("Portrait")').click();
// Select aspect
document.querySelector('[role=menuitem]:contains("Portrait")').click();
```

### Step 6: Click Create Video
```javascript
document.querySelector('button:contains("Create video")').click();
```

### Step 7: Get Initial Drafts Count
```python
initial_count = len(get_drafts_videos())
```

### Step 8: Poll for Completion
```python
while elapsed < timeout:
    current_count = len(get_drafts_videos())
    if current_count > initial_count:
        # New video detected!
        break
    sleep(30)
```

### Step 9: Download New Video
```python
new_videos = get_drafts_videos()[:1]  # Most recent
download_video(new_videos[0])
```

---

## Error Handling

| Error | Action |
|-------|--------|
| Not logged in | Prompt user to log in |
| Queue full (3 generating) | Wait for slot |
| Timeout | Return partial result |
| Download failed | Retry 3 times |

---

## File Locations

| File | Path |
|------|------|
| Main script | `scripts/sora_full_pipeline.py` |
| Downloads | `/Users/isaiahdupree/Documents/CompetitorResearch/sora_downloads/` |
| Logs | `logs/sora_pipeline.log` |

---

## Usage Examples

### Single Video
```bash
python scripts/sora_full_pipeline.py "person walking through city at sunset"
```

### With Options
```bash
python scripts/sora_full_pipeline.py "dancing on beach" --duration 25 --aspect Landscape
```

### Multiple Videos (Queue)
```bash
python scripts/sora_full_pipeline.py "prompt 1" "prompt 2" "prompt 3"
```

---

## Dependencies

- `automation/sora_full_automation.py` - Safari control
- Safari browser with Remote Automation enabled
- Logged into sora.chatgpt.com

---

## Timeline

| Phase | Duration |
|-------|----------|
| PRD | ✅ Complete |
| Implementation | Now |
| Testing | After implementation |
