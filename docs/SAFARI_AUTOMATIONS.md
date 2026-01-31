# Safari Automations Guide

## Overview

MediaPoster uses Safari browser automation via AppleScript for web-only features that don't have APIs. This enables automation of platforms like Sora (video generation) and various social media actions.

---

## 🗂️ Automation Files

### Core Controllers

| File | Purpose |
|------|---------|
| `automation/safari_app_controller.py` | Main Safari automation controller |
| `automation/safari_session_manager.py` | Session and cookie management |
| `automation/safari_extension_bridge.py` | Extension bridge for JS execution |

### Platform-Specific Automations

| File | Platform | Actions |
|------|----------|---------|
| `automation/safari_sora_scraper.py` | Sora | Video generation, download, usage check |
| `automation/safari_twitter_poster.py` | Twitter/X | Tweet posting, DM automation |
| `automation/safari_twitter_dm.py` | Twitter/X | Direct message automation |
| `automation/safari_instagram_poster.py` | Instagram | Post/Reel uploads |
| `automation/safari_instagram_scraper.py` | Instagram | Content scraping |
| `automation/safari_tiktok_cli.py` | TikTok | CLI-based posting |
| `automation/safari_tiktok_login.py` | TikTok | Login automation |
| `automation/safari_threads_poster.py` | Threads | Post creation |
| `automation/safari_reddit_poster.py` | Reddit | Post creation |

### Full Automation Pipelines

| File | Purpose |
|------|---------|
| `automation/sora_full_automation.py` | Complete Sora video generation pipeline |
| `automation/tiktok_engagement.py` | TikTok engagement automation |
| `automation/tiktok_messenger.py` | TikTok DM automation |

---

## 🚀 Sora Automation

### Video Generation Flow

```
1. Navigate to sora.chatgpt.com/explore
2. Input prompt via textarea
3. Click "Create video" button
4. Monitor activity page for completion
5. Download video when ready
6. Remove watermark (SoraWatermarkCleaner)
7. Process through VideoReadyPipeline
8. Publish to YouTube/TikTok via Blotato
```

### Usage Check

```python
from automation.sora_full_automation import SoraAutomation

sora = SoraAutomation()
usage = await sora.get_usage()
# Returns: {"free": 5, "paid": 0, "total": 5, "next_reset": "Feb 1"}
```

### Generate Video

```python
result = await sora.generate_video(
    prompt="@isaiahdupree walking through a city",
    aspect_ratio="9:16",
    duration="5s"
)
```

### Sora UI Selectors (Radix UI)

```javascript
// Settings dialog (dynamic ID)
document.querySelector('#radix-:r5:')

// Usage tab trigger
document.querySelector('[id*="-trigger-usage"]')

// Create video button
document.querySelector('button:contains("Create video")')

// Prompt textarea
document.querySelector('textarea')
```

### Key URLs

| Page | URL |
|------|-----|
| Explore | `https://sora.chatgpt.com/explore` |
| Activity | `https://sora.chatgpt.com/activity` |
| Library | `https://sora.chatgpt.com/library` |

---

## 🐦 Twitter/X Automation

### Post Tweet

```python
from automation.safari_twitter_poster import SafariTwitterPoster

poster = SafariTwitterPoster()
result = await poster.post_tweet("Hello world! #automation")
# Returns: {"success": True, "tweet_id": "123456789", "url": "https://x.com/..."}
```

### Send DM

```python
from automation.safari_twitter_dm import SafariTwitterDM

dm = SafariTwitterDM()
await dm.send_dm("@username", "Hey! Check out my new video")
```

---

## 📸 Instagram Automation

### Post Reel

```python
from automation.safari_instagram_poster import SafariInstagramPoster

poster = SafariInstagramPoster()
await poster.post_reel(
    video_path="/path/to/video.mp4",
    caption="Check this out! #viral"
)
```

---

## 🎵 TikTok Automation

### CLI Posting

```python
from automation.safari_tiktok_cli import TikTokCLI

cli = TikTokCLI()
await cli.post_video(
    video_path="/path/to/video.mp4",
    caption="Viral content incoming #fyp"
)
```

---

## ⚙️ Setup Requirements

### 1. Safari Developer Mode

```bash
# Enable Develop menu
defaults write com.apple.Safari IncludeDevelopMenu -bool true

# Enable Remote Automation
# Safari → Develop → Allow Remote Automation
```

### 2. Accessibility Permissions

System Preferences → Security & Privacy → Privacy → Accessibility
- Add Terminal.app
- Add your Python/IDE

### 3. Session Cookies

Sessions are stored in `Backend/sessions/` directory:
- `sessions/twitter_cookies.json`
- `sessions/instagram_cookies.json`
- `sessions/tiktok_cookies.json`

---

## 🔗 Integration with VideoReadyPipeline

Safari automations integrate with the video pipeline via `SafariEventListener`:

```python
# services/safari_event_listener.py
class SafariEventListener:
    def __init__(self):
        self._handlers["sora.video.complete"] = self._handle_sora_complete
        self._handlers["sora.video.downloaded"] = self._handle_video_downloaded
    
    @property
    def pipeline(self):
        from services.video_ready_pipeline import VideoReadyPipeline
        return VideoReadyPipeline()
```

### Event Flow

```
Safari Automation (WebSocket:7071)
    ↓
SafariEventListener receives event
    ↓
VideoReadyPipeline.process_video_ready()
    ↓
AI Analysis (GPT-4o + Whisper)
    ↓
Database save (original_videos, analyzed_videos)
    ↓
EventBus → PublishIntegrator → Blotato
    ↓
Social Media (YouTube, TikTok, Instagram)
```

---

## 📁 Video Storage Locations

| Location | Purpose |
|----------|---------|
| `~/sora-videos/` | Raw Sora downloads |
| `~/sora-videos/cleaned/` | Watermark-removed videos |
| `data/sora_videos/` | Backend staging area |

---

## 🧪 Testing

### Test Safari Controller

```bash
python -m pytest automation/tests/test_safari_controller.py
```

### Test Sora Scraper

```bash
python automation/safari_sora_scraper.py --test
```

### Manual Test

```python
from automation.safari_app_controller import SafariAppController

safari = SafariAppController()
await safari.navigate("https://sora.chatgpt.com")
await safari.execute_js("document.title")
```

---

## 🔧 Troubleshooting

### Safari Not Responding

```bash
# Kill Safari and restart
pkill Safari
open -a Safari
```

### AppleScript Permission Denied

1. System Preferences → Security & Privacy → Privacy
2. Automation → Check Safari for your app
3. Restart Terminal/IDE

### Session Expired

```bash
# Clear session cookies
rm -rf Backend/sessions/*.json
# Re-login manually in Safari
```

---

## 📊 Scripts

### Publish Sora Videos

```bash
# List analyzed videos
python scripts/publish_sora_videos.py --list

# Publish one video to YouTube
python scripts/publish_sora_videos.py --video cleaned_badass-01.mp4 --platform youtube

# Publish all to YouTube + TikTok
python scripts/publish_sora_videos.py --all --platform all --limit 10
```

### Test Video Pipeline

```bash
python scripts/test_video_pipeline.py --list
python scripts/test_video_pipeline.py --video test.mp4
```

---

## 🔒 Security Notes

- Never commit session cookies to git
- Safari automation requires local machine access
- Use environment variables for API keys
- Sessions directory is gitignored

---

## 📚 Related Documentation

- [Pipeline Architecture](./PIPELINE_ARCHITECTURE.md)
- [Sora Browser Automation PRD](./SORA_BROWSER_AUTOMATION_PRD.md)
- [Sora Selectors Reference](./SORA_SELECTORS_REFERENCE.md)
