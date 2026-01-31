# PRD: Safari Session Manager & Health Dashboard

**Version:** 1.0  
**Date:** January 19, 2026  
**Status:** Partially Implemented  
**Priority:** High  
**Estimated Effort:** 1-2 weeks (enhancements)

---

## Executive Summary

Comprehensive Safari browser session management system that maintains login states across all social media platforms, provides real-time health monitoring, automatic session keep-alive, and a visual dashboard for session status. This is critical infrastructure for all Safari-based automations.

---

## Current Implementation Status

### ✅ Already Implemented

| Feature | Location | Status |
|---------|----------|--------|
| Login detection (7 platforms) | `safari_session_manager.py` | ✅ Working |
| Session refresh intervals | `safari_session_manager.py` | ✅ Working |
| Background session keeper | `safari_session_manager.py` | ✅ Working |
| CLI commands | `safari_session_manager.py` | ✅ Working |
| Sleep mode wake trigger | `safari_session_manager.py` | ✅ Working |

### ❌ Not Yet Implemented

| Feature | Priority | Description |
|---------|----------|-------------|
| Health dashboard UI | High | Visual status of all sessions |
| Multi-account switching | High | Switch between accounts per platform |
| Session metrics/analytics | Medium | Track session uptime, failures |
| Automatic re-login | Medium | Attempt re-login on session loss |
| Email/push notifications | Low | Alert on session expiry |
| Session recording | Low | Record session for debugging |

---

## Problem Statement

### Current Gaps
1. No visual dashboard to monitor session health
2. Single account per platform limitation
3. No historical metrics on session stability
4. Manual intervention required when sessions expire
5. No notifications when automation is blocked

### User Pain Points
1. Discovering sessions expired only when automation fails
2. No way to monitor which accounts are active
3. Difficulty debugging session issues
4. No proactive session maintenance

---

## Goals & Success Metrics

### Goals
1. 99%+ session uptime across all platforms
2. Visual dashboard for session monitoring
3. Multi-account support with easy switching
4. Proactive session maintenance and alerts
5. Historical analytics for debugging

### Success Metrics

| Metric | Target |
|--------|--------|
| Session uptime | > 99% |
| Time to detect expired session | < 5 min |
| Mean time to recover | < 2 min (auto) |
| Dashboard load time | < 1 sec |

---

## Features

### Phase 1: Health Dashboard (Week 1)

#### 1.1 Session Status Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Safari Session Health                    Last Check: 2 min ago │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Platform Status                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ ✅ Twitter/X     @IsaiahDupree7        Active  25m refresh  │ │
│  │ ✅ TikTok        @isaiah_dupree        Active  18m refresh  │ │
│  │ ✅ Instagram     @the_isaiah_dupree    Active  22m refresh  │ │
│  │ ⚠️  Threads      @the_isaiah_dupree    Stale   45m ago      │ │
│  │ ❌ YouTube       Not logged in         Expired  2h ago      │ │
│  │ ✅ Sora          Connected             Active  10m refresh  │ │
│  │ ⏸️  Reddit       Paused                Manual               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  [Refresh All] [Check Now] [Start Keeper] [Settings]            │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

#### 1.2 Status Indicators

| Status | Icon | Color | Description |
|--------|------|-------|-------------|
| Active | ✅ | Green | Logged in, recently refreshed |
| Stale | ⚠️ | Yellow | Logged in, needs refresh |
| Expired | ❌ | Red | Session lost, needs re-login |
| Paused | ⏸️ | Gray | Manually paused |
| Checking | 🔄 | Blue | Currently verifying |

#### 1.3 Real-time Updates
- WebSocket connection for live status updates
- Auto-refresh every 30 seconds
- Instant notification on status change
- Browser notification on session expiry

### Phase 2: Multi-Account Support (Week 1-2)

#### 2.1 Account Registry

```python
# Database schema for account management
CREATE TABLE safari_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NOT NULL,
    
    platform VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    display_name VARCHAR(100),
    
    -- Session state
    is_active BOOLEAN DEFAULT false,
    is_logged_in BOOLEAN DEFAULT false,
    last_login TIMESTAMPTZ,
    last_check TIMESTAMPTZ,
    last_refresh TIMESTAMPTZ,
    
    -- Cookies/session data (encrypted)
    session_data_encrypted TEXT,
    
    -- Config
    refresh_interval_minutes INTEGER DEFAULT 30,
    auto_refresh BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, platform, username)
);

CREATE TABLE safari_session_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES safari_accounts(id) ON DELETE CASCADE,
    
    event_type VARCHAR(50) NOT NULL,
    status VARCHAR(20),
    details JSONB,
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_safari_accounts_platform ON safari_accounts(platform, is_active);
CREATE INDEX idx_safari_session_logs_account ON safari_session_logs(account_id, created_at DESC);
```

#### 2.2 Account Switching

```
┌─────────────────────────────────────────────────────────────────┐
│  TikTok Accounts                                   [+ Add New]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ● @isaiah_dupree (Active)                                       │
│    ✅ Logged in • Last refresh: 5 min ago                        │
│    [Switch Away] [Refresh] [Remove]                              │
│                                                                   │
│  ○ @the_isaiah_dupree                                            │
│    ⏸️ Inactive • Last login: 2 days ago                          │
│    [Activate] [Remove]                                            │
│                                                                   │
│  ○ @dupree_isaiah                                                │
│    ❌ Session expired • Last login: 5 days ago                   │
│    [Re-login] [Remove]                                            │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

#### 2.3 Account Switch Flow

```python
async def switch_account(platform: Platform, target_username: str) -> bool:
    """
    Switch Safari to a different account for a platform.
    
    1. Save current session cookies
    2. Clear platform cookies
    3. Load target account cookies
    4. Navigate to platform
    5. Verify login status
    6. Update account states
    """
    pass
```

### Phase 3: Session Analytics (Week 2)

#### 3.1 Metrics Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│  Session Analytics                          [Last 7 Days ▼]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Uptime by Platform                                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Twitter   ████████████████████████████████████░░  98.5%    │ │
│  │ TikTok    ██████████████████████████████████████  99.2%    │ │
│  │ Instagram ████████████████████████████░░░░░░░░░░  85.0%    │ │
│  │ Threads   ████████████████████████████████████░░  97.8%    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  Session Events (Last 24h)                                       │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 14:30  ✅ Twitter    Session refreshed                      │ │
│  │ 14:05  ✅ TikTok     Session refreshed                      │ │
│  │ 13:45  ⚠️  Instagram  Session stale (40m)                   │ │
│  │ 12:00  ❌ Instagram  Session expired                        │ │
│  │ 11:55  🔄 Instagram  Manual re-login                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  Summary Stats                                                   │
│  • Total refreshes: 156                                          │
│  • Session losses: 3                                             │
│  • Avg session duration: 4.2 hours                               │
│  • Auto-recovery rate: 67%                                       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.2 Metrics Tracked

| Metric | Description |
|--------|-------------|
| Session uptime | Percentage of time logged in |
| Refresh count | Number of successful refreshes |
| Failure count | Number of session losses |
| Avg session length | Time between logins |
| Recovery time | Time to recover from failure |
| Check latency | Time to verify login status |

### Phase 4: Auto-Recovery & Notifications (Week 2)

#### 4.1 Automatic Re-login Attempts

```python
class SessionRecovery:
    """
    Attempts to recover expired sessions automatically.
    """
    
    async def attempt_recovery(self, account: SafariAccount) -> bool:
        """
        Try to recover a session:
        1. Check if we have stored cookies
        2. Try restoring cookies
        3. Navigate and verify
        4. If failed, try stored credentials (if available)
        5. Log result
        """
        
        # Step 1: Try cookie restoration
        if account.session_data_encrypted:
            cookies = decrypt_cookies(account.session_data_encrypted)
            if await self.restore_cookies(account.platform, cookies):
                if await self.verify_login(account.platform):
                    logger.success(f"Session recovered via cookies: {account.username}")
                    return True
        
        # Step 2: Notify user if auto-recovery failed
        await self.notify_session_expired(account)
        return False
```

#### 4.2 Notification System

| Event | Notification Type | Content |
|-------|-------------------|---------|
| Session expired | Push + Email | "TikTok session expired. Re-login required." |
| Multiple failures | Push + Email | "3 platforms need attention" |
| Auto-recovered | Push only | "Instagram session auto-recovered" |
| Keeper stopped | Email | "Session keeper stopped unexpectedly" |

#### 4.3 Notification Settings

```
┌─────────────────────────────────────────────────────────────────┐
│  Notification Settings                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ☑️ Push notifications for session expiry                        │
│  ☑️ Email digest (daily summary)                                 │
│  ☐ Email immediate (each expiry)                                 │
│  ☑️ Browser notifications                                        │
│                                                                   │
│  Quiet Hours: [10 PM] to [8 AM]                                  │
│                                                                   │
│  [Save Settings]                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technical Architecture

### API Endpoints

```
# Session Status
GET    /api/safari/sessions                  # All session states
GET    /api/safari/sessions/{platform}       # Single platform status
POST   /api/safari/sessions/{platform}/check # Force check
POST   /api/safari/sessions/{platform}/refresh # Force refresh

# Accounts
GET    /api/safari/accounts                  # List all accounts
POST   /api/safari/accounts                  # Add account
DELETE /api/safari/accounts/{id}             # Remove account
POST   /api/safari/accounts/{id}/activate    # Switch to account
POST   /api/safari/accounts/{id}/login       # Initiate login flow

# Keeper Service
GET    /api/safari/keeper/status             # Keeper running?
POST   /api/safari/keeper/start              # Start keeper
POST   /api/safari/keeper/stop               # Stop keeper

# Analytics
GET    /api/safari/analytics                 # Session metrics
GET    /api/safari/analytics/events          # Recent events
GET    /api/safari/analytics/uptime          # Uptime by platform

# WebSocket
WS     /api/safari/ws                        # Real-time updates
```

### File Structure

```
Backend/
├── automation/
│   ├── safari_session_manager.py      # Core manager (existing)
│   ├── safari_account_manager.py      # Multi-account support
│   ├── safari_session_recovery.py     # Auto-recovery logic
│   └── safari_cookie_manager.py       # Cookie storage/restore
├── services/
│   └── safari/
│       ├── health_monitor.py          # Health check service
│       ├── analytics_service.py       # Metrics aggregation
│       └── notification_service.py    # Alerts & notifications
├── api/
│   └── endpoints/
│       └── safari_api.py              # API routes

dashboard/
├── app/
│   └── (dashboard)/
│       └── safari/
│           ├── page.tsx               # Health dashboard
│           ├── accounts/
│           │   └── page.tsx           # Account management
│           └── analytics/
│               └── page.tsx           # Session analytics
├── components/
│   └── safari/
│       ├── SessionStatusCard.tsx
│       ├── AccountSwitcher.tsx
│       ├── UptimeChart.tsx
│       ├── EventLog.tsx
│       └── KeeperControls.tsx
```

### Enhanced Session Manager

```python
# Backend/automation/safari_session_manager.py (enhancements)

class SafariSessionManager:
    """Enhanced with health monitoring and multi-account support."""
    
    async def get_health_status(self) -> Dict:
        """Get comprehensive health status for all platforms."""
        health = {
            "overall": "healthy",
            "platforms": {},
            "keeper_running": self._refresh_thread and self._refresh_thread.is_alive(),
            "last_full_check": None,
            "issues": []
        }
        
        for platform, state in self.sessions.items():
            config = PLATFORM_CONFIGS.get(platform)
            
            # Calculate staleness
            if state.last_refresh:
                minutes_since = (datetime.now() - state.last_refresh).total_seconds() / 60
                is_stale = minutes_since > config.refresh_interval_minutes
            else:
                is_stale = True
                minutes_since = None
            
            # Determine status
            if not state.is_logged_in:
                status = "expired"
                health["issues"].append(f"{platform.value} session expired")
            elif is_stale:
                status = "stale"
                health["issues"].append(f"{platform.value} needs refresh")
            else:
                status = "active"
            
            health["platforms"][platform.value] = {
                "status": status,
                "is_logged_in": state.is_logged_in,
                "username": state.username,
                "last_check": state.last_check.isoformat() if state.last_check else None,
                "last_refresh": state.last_refresh.isoformat() if state.last_refresh else None,
                "minutes_since_refresh": round(minutes_since, 1) if minutes_since else None,
                "refresh_interval": config.refresh_interval_minutes,
                "error": state.error
            }
        
        # Set overall health
        if any(p["status"] == "expired" for p in health["platforms"].values()):
            health["overall"] = "critical"
        elif any(p["status"] == "stale" for p in health["platforms"].values()):
            health["overall"] = "warning"
        
        return health
    
    async def emit_status_update(self, platform: Platform, state: SessionState):
        """Emit WebSocket update when status changes."""
        from api.websocket import broadcast_safari_update
        
        await broadcast_safari_update({
            "type": "session_update",
            "platform": platform.value,
            "status": "active" if state.is_logged_in else "expired",
            "timestamp": datetime.now().isoformat()
        })
```

---

## Implementation Timeline

| Day | Task |
|-----|------|
| 1 | Database schema, account manager |
| 2 | Health status API endpoints |
| 3 | Frontend: Health dashboard |
| 4 | WebSocket real-time updates |
| 5 | Multi-account switching logic |
| 6 | Frontend: Account management |
| 7 | Session analytics service |
| 8 | Frontend: Analytics dashboard |
| 9 | Notification system |
| 10 | Testing, documentation |

---

## CLI Commands (Enhanced)

```bash
# Existing commands
python safari_session_manager.py --check twitter
python safari_session_manager.py --check all
python safari_session_manager.py --refresh tiktok
python safari_session_manager.py --keeper

# New commands
python safari_session_manager.py --health           # JSON health report
python safari_session_manager.py --accounts         # List all accounts
python safari_session_manager.py --switch tiktok:@the_isaiah_dupree
python safari_session_manager.py --analytics 7d     # Last 7 days stats
python safari_session_manager.py --recover instagram  # Attempt recovery
```

---

## Dependencies

- **AppleScript:** Safari automation (macOS only)
- **WebSocket:** Real-time dashboard updates
- **Redis:** Session state caching
- **Encryption:** Secure cookie storage

---

## Security Considerations

1. **Cookie encryption:** All stored session data AES-256 encrypted
2. **Local storage only:** No cookies sent to external servers
3. **Permission model:** Only authorized users can switch accounts
4. **Audit logging:** All session events logged

---

**Document Owner:** Engineering Team  
**Last Updated:** January 19, 2026
