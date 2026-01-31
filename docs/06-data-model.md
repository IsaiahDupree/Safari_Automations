# Data Model

## Overview

The data model supports:
- Tracking discovered posts and users across platforms
- Recording all engagement actions and their outcomes
- Managing DM conversations
- Full audit trail for every operation

## Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Account   │       │   Platform  │       │  Blocklist  │
│             │       │    User     │       │    Entry    │
│  (your      │──────▶│  (discovered│◀──────│             │
│   accounts) │       │    users)   │       │             │
└──────┬──────┘       └──────┬──────┘       └─────────────┘
       │                     │
       │                     │
       ▼                     ▼
┌─────────────┐       ┌─────────────┐
│    Post     │◀──────│   Comment   │
│             │       │             │
│  (content   │       │  (comments  │
│   items)    │       │   on posts) │
└──────┬──────┘       └─────────────┘
       │
       │
       ▼
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Action    │──────▶│ Verification│       │   Audit     │
│   Attempt   │       │   Result    │       │   Entry     │
│             │       │             │       │             │
└─────────────┘       └─────────────┘       └─────────────┘
       │
       │
       ▼
┌─────────────┐       ┌─────────────┐
│  DM Thread  │──────▶│ DM Message  │
│             │       │             │
└─────────────┘       └─────────────┘
```

## Core Entities

### Account

Your authorized social media accounts.

```typescript
interface Account {
  id: string;                    // Internal UUID
  platform: Platform;            // 'instagram' | 'tiktok' | 'threads' | 'twitter'
  platformUserId: string;        // Platform's user ID
  username: string;              // @handle
  displayName: string | null;    // Display name
  sessionPath: string | null;    // Path to encrypted session file
  isActive: boolean;             // Whether account is active
  lastUsedAt: Date | null;       // Last automation activity
  createdAt: Date;
  updatedAt: Date;
  
  // Settings
  settings: AccountSettings;
}

interface AccountSettings {
  rateLimit: {
    likesPerHour: number;
    commentsPerHour: number;
    dmsPerHour: number;
  };
  quietHours: {
    enabled: boolean;
    startHour: number;
    endHour: number;
    timezone: string;
  } | null;
  autoApprove: {
    likes: boolean;
    comments: boolean;
    dms: boolean;
  };
}
```

**SQL Schema**:

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  session_path TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  settings TEXT NOT NULL,  -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(platform, platform_user_id)
);

CREATE INDEX idx_accounts_platform ON accounts(platform);
CREATE INDEX idx_accounts_active ON accounts(is_active);
```

### PlatformUser

Users discovered on platforms (not your accounts).

```typescript
interface PlatformUser {
  id: string;                    // Internal UUID
  platform: Platform;
  platformUserId: string;        // Platform's user ID
  username: string;
  displayName: string | null;
  profileUrl: string;
  
  // Stats (may be stale)
  followerCount: number | null;
  followingCount: number | null;
  postCount: number | null;
  
  // Metadata
  isVerified: boolean;
  isPrivate: boolean;
  bio: string | null;
  
  // Tracking
  discoveredAt: Date;
  lastSeenAt: Date;
  lastUpdatedAt: Date;
}
```

**SQL Schema**:

```sql
CREATE TABLE platform_users (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  profile_url TEXT NOT NULL,
  follower_count INTEGER,
  following_count INTEGER,
  post_count INTEGER,
  is_verified INTEGER NOT NULL DEFAULT 0,
  is_private INTEGER NOT NULL DEFAULT 0,
  bio TEXT,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(platform, platform_user_id)
);

CREATE INDEX idx_platform_users_platform ON platform_users(platform);
CREATE INDEX idx_platform_users_username ON platform_users(platform, username);
```

### Post

Content items discovered on platforms.

```typescript
interface Post {
  id: string;                    // Internal UUID
  platform: Platform;
  platformPostId: string;        // Platform's post ID
  postUrl: string;
  
  // Author
  authorId: string;              // FK to PlatformUser
  authorUsername: string;        // Denormalized for convenience
  
  // Content
  contentType: 'image' | 'video' | 'carousel' | 'text';
  caption: string | null;
  mediaUrls: string[];           // URLs to media (may expire)
  
  // Stats (at time of extraction)
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  viewCount: number | null;      // For videos
  
  // Metadata
  postedAt: Date | null;         // When post was created
  isSponsored: boolean;
  hashtags: string[];
  mentions: string[];
  
  // Tracking
  discoveredAt: Date;
  lastExtractedAt: Date;
  
  // Engagement tracking
  engagementStatus: EngagementStatus;
}

type EngagementStatus = 
  | 'not_engaged'
  | 'liked'
  | 'commented'
  | 'liked_and_commented';
```

**SQL Schema**:

```sql
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_post_id TEXT NOT NULL,
  post_url TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES platform_users(id),
  author_username TEXT NOT NULL,
  content_type TEXT NOT NULL,
  caption TEXT,
  media_urls TEXT NOT NULL DEFAULT '[]',  -- JSON array
  like_count INTEGER,
  comment_count INTEGER,
  share_count INTEGER,
  view_count INTEGER,
  posted_at TEXT,
  is_sponsored INTEGER NOT NULL DEFAULT 0,
  hashtags TEXT NOT NULL DEFAULT '[]',    -- JSON array
  mentions TEXT NOT NULL DEFAULT '[]',    -- JSON array
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
  engagement_status TEXT NOT NULL DEFAULT 'not_engaged',
  
  UNIQUE(platform, platform_post_id)
);

CREATE INDEX idx_posts_platform ON posts(platform);
CREATE INDEX idx_posts_author ON posts(author_id);
CREATE INDEX idx_posts_engagement ON posts(engagement_status);
CREATE INDEX idx_posts_discovered ON posts(discovered_at);
```

### Comment

Comments on posts (both yours and discovered).

```typescript
interface Comment {
  id: string;                    // Internal UUID
  platform: Platform;
  platformCommentId: string | null;  // Null if pending
  
  // Relations
  postId: string;                // FK to Post
  authorId: string | null;       // FK to PlatformUser (null if you)
  accountId: string | null;      // FK to Account (if you made it)
  
  // Content
  text: string;
  
  // Metadata
  postedAt: Date | null;
  likeCount: number | null;
  replyCount: number | null;
  
  // If this is your comment
  isOurs: boolean;
  actionAttemptId: string | null;  // FK to ActionAttempt
  
  // Tracking
  discoveredAt: Date;
}
```

**SQL Schema**:

```sql
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_comment_id TEXT,
  post_id TEXT NOT NULL REFERENCES posts(id),
  author_id TEXT REFERENCES platform_users(id),
  account_id TEXT REFERENCES accounts(id),
  text TEXT NOT NULL,
  posted_at TEXT,
  like_count INTEGER,
  reply_count INTEGER,
  is_ours INTEGER NOT NULL DEFAULT 0,
  action_attempt_id TEXT REFERENCES action_attempts(id),
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(platform, platform_comment_id)
);

CREATE INDEX idx_comments_post ON comments(post_id);
CREATE INDEX idx_comments_author ON comments(author_id);
CREATE INDEX idx_comments_ours ON comments(is_ours);
```

### ActionAttempt

Every action attempt with outcome.

```typescript
interface ActionAttempt {
  id: string;                    // Internal UUID
  runId: string;                 // Groups actions in same run
  
  // What
  platform: Platform;
  actionType: ActionType;
  
  // Who
  accountId: string;             // FK to Account
  
  // Target
  targetType: 'post' | 'user' | 'dm_thread';
  targetId: string;              // FK to Post, PlatformUser, or DMThread
  
  // Input
  input: Record<string, unknown>;  // Action-specific input
  
  // Outcome
  status: ActionStatus;
  result: Record<string, unknown> | null;
  error: ActionError | null;
  
  // Timing
  attemptedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  
  // Verification
  verificationId: string | null;  // FK to VerificationResult
}

type ActionType = 
  | 'like'
  | 'unlike'
  | 'comment'
  | 'delete_comment'
  | 'dm_send'
  | 'dm_read'
  | 'follow'
  | 'unfollow'
  | 'extract_stats';

type ActionStatus = 
  | 'pending'
  | 'in_progress'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'cancelled';

interface ActionError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  stack?: string;
}
```

**SQL Schema**:

```sql
CREATE TABLE action_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  action_type TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  input TEXT NOT NULL DEFAULT '{}',       -- JSON
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,                             -- JSON
  error TEXT,                              -- JSON
  attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  duration_ms INTEGER,
  verification_id TEXT REFERENCES verification_results(id)
);

CREATE INDEX idx_action_attempts_run ON action_attempts(run_id);
CREATE INDEX idx_action_attempts_account ON action_attempts(account_id);
CREATE INDEX idx_action_attempts_target ON action_attempts(target_type, target_id);
CREATE INDEX idx_action_attempts_status ON action_attempts(status);
CREATE INDEX idx_action_attempts_type ON action_attempts(action_type);

-- Idempotency constraint: one successful action per target per type
CREATE UNIQUE INDEX idx_action_unique 
  ON action_attempts(account_id, platform, target_id, action_type) 
  WHERE status = 'success';
```

### VerificationResult

Post-action verification records.

```typescript
interface VerificationResult {
  id: string;                    // Internal UUID
  actionAttemptId: string;       // FK to ActionAttempt
  
  // Outcome
  verified: boolean;
  confidence: number;            // 0-1
  method: VerificationMethod;
  
  // Details
  details: Record<string, unknown>;
  
  // Timing
  verifiedAt: Date;
  durationMs: number;
}

type VerificationMethod = 
  | 'dom_state_check'
  | 'reload_verify'
  | 'api_response'
  | 'attribute_change'
  | 'manual';
```

**SQL Schema**:

```sql
CREATE TABLE verification_results (
  id TEXT PRIMARY KEY,
  action_attempt_id TEXT NOT NULL REFERENCES action_attempts(id),
  verified INTEGER NOT NULL,
  confidence REAL NOT NULL,
  method TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',  -- JSON
  verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER NOT NULL
);

CREATE INDEX idx_verifications_action ON verification_results(action_attempt_id);
CREATE INDEX idx_verifications_verified ON verification_results(verified);
```

### DMThread

Direct message conversations.

```typescript
interface DMThread {
  id: string;                    // Internal UUID
  platform: Platform;
  platformThreadId: string;
  
  // Participants
  accountId: string;             // FK to Account (your account)
  participantId: string;         // FK to PlatformUser
  participantUsername: string;   // Denormalized
  
  // State
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  isArchived: boolean;
  
  // Tracking
  discoveredAt: Date;
  lastSyncedAt: Date;
}
```

**SQL Schema**:

```sql
CREATE TABLE dm_threads (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_thread_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  participant_id TEXT NOT NULL REFERENCES platform_users(id),
  participant_username TEXT NOT NULL,
  last_message_at TEXT,
  last_message_preview TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(platform, platform_thread_id)
);

CREATE INDEX idx_dm_threads_account ON dm_threads(account_id);
CREATE INDEX idx_dm_threads_participant ON dm_threads(participant_id);
```

### DMMessage

Individual DM messages.

```typescript
interface DMMessage {
  id: string;                    // Internal UUID
  platform: Platform;
  platformMessageId: string | null;
  
  // Thread
  threadId: string;              // FK to DMThread
  
  // Sender
  isFromUs: boolean;
  senderId: string | null;       // FK to PlatformUser (if not from us)
  
  // Content (encrypted at rest)
  contentEncrypted: string;
  contentType: 'text' | 'image' | 'video' | 'link';
  
  // Metadata
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  
  // If we sent it
  actionAttemptId: string | null;  // FK to ActionAttempt
  
  // Tracking
  discoveredAt: Date;
}
```

**SQL Schema**:

```sql
CREATE TABLE dm_messages (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_message_id TEXT,
  thread_id TEXT NOT NULL REFERENCES dm_threads(id),
  is_from_us INTEGER NOT NULL,
  sender_id TEXT REFERENCES platform_users(id),
  content_encrypted TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  action_attempt_id TEXT REFERENCES action_attempts(id),
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  
  UNIQUE(platform, platform_message_id)
);

CREATE INDEX idx_dm_messages_thread ON dm_messages(thread_id);
CREATE INDEX idx_dm_messages_sent ON dm_messages(sent_at);
```

### AuditEntry

Full audit trail.

```typescript
interface AuditEntry {
  id: string;                    // Internal UUID
  
  // Context
  runId: string;
  stepId: string;
  
  // What happened
  eventType: AuditEventType;
  platform: Platform | null;
  
  // Who
  accountId: string | null;
  
  // Target
  targetType: string | null;
  targetId: string | null;
  
  // Outcome
  outcome: 'success' | 'failure' | 'skipped' | 'pending';
  
  // Details (no sensitive data!)
  details: Record<string, unknown>;
  
  // Timing
  timestamp: Date;
  durationMs: number | null;
}

type AuditEventType = 
  | 'session_start'
  | 'session_end'
  | 'navigate'
  | 'extract'
  | 'action_attempt'
  | 'action_complete'
  | 'verification'
  | 'error'
  | 'rate_limit_hit'
  | 'policy_block';
```

**SQL Schema**:

```sql
CREATE TABLE audit_entries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  platform TEXT,
  account_id TEXT REFERENCES accounts(id),
  target_type TEXT,
  target_id TEXT,
  outcome TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',  -- JSON
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms INTEGER
);

CREATE INDEX idx_audit_run ON audit_entries(run_id);
CREATE INDEX idx_audit_account ON audit_entries(account_id);
CREATE INDEX idx_audit_event ON audit_entries(event_type);
CREATE INDEX idx_audit_timestamp ON audit_entries(timestamp);
```

### BlocklistEntry

Users/content to never engage with.

```typescript
interface BlocklistEntry {
  id: string;                    // Internal UUID
  
  // Type
  entryType: 'user' | 'post' | 'keyword' | 'domain';
  
  // Value
  platform: Platform | null;     // Null for cross-platform
  value: string;                 // Username, post ID, keyword, or domain
  matchType: 'exact' | 'contains' | 'regex';
  
  // Reason
  reason: string;
  addedBy: 'user' | 'system' | 'opt_out';
  
  // Tracking
  createdAt: Date;
  expiresAt: Date | null;        // Null for permanent
}
```

**SQL Schema**:

```sql
CREATE TABLE blocklist_entries (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL,
  platform TEXT,
  value TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'exact',
  reason TEXT NOT NULL,
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE INDEX idx_blocklist_type ON blocklist_entries(entry_type);
CREATE INDEX idx_blocklist_platform ON blocklist_entries(platform);
CREATE INDEX idx_blocklist_value ON blocklist_entries(value);
```

## Idempotency Keys

Prevent duplicate actions with unique constraints:

```sql
-- Only one successful like per post per account
CREATE UNIQUE INDEX idx_unique_like
  ON action_attempts(account_id, target_id)
  WHERE action_type = 'like' AND status = 'success';

-- Only one successful comment per post per account per text hash
-- (allows multiple different comments on same post)
CREATE UNIQUE INDEX idx_unique_comment
  ON action_attempts(account_id, target_id, json_extract(input, '$.textHash'))
  WHERE action_type = 'comment' AND status = 'success';
```

## Retention Policy

| Data Type | Retention | Justification |
|-----------|-----------|---------------|
| Audit entries | 1 year | Compliance/debugging |
| Action attempts | 1 year | History tracking |
| Post metadata | 90 days | Keep recent, purge old |
| DM content | 30 days | Privacy |
| Screenshots | 7 days | Debugging only |
| Session files | Until logout | Security |

### Cleanup Jobs

```typescript
// Run nightly
async function cleanupOldData(db: Database) {
  const now = new Date();
  
  // Posts older than 90 days without recent engagement
  await db.exec(`
    DELETE FROM posts 
    WHERE discovered_at < datetime('now', '-90 days')
    AND engagement_status = 'not_engaged'
  `);
  
  // DM content older than 30 days
  await db.exec(`
    UPDATE dm_messages 
    SET content_encrypted = '[REDACTED]'
    WHERE discovered_at < datetime('now', '-30 days')
  `);
  
  // Audit entries older than 1 year
  await db.exec(`
    DELETE FROM audit_entries 
    WHERE timestamp < datetime('now', '-1 year')
  `);
}
```

## Migrations

### Migration Format

```typescript
// packages/db/migrations/001_initial.ts

import { Migration } from '../types';

export const migration: Migration = {
  version: 1,
  name: 'initial',
  up: async (db) => {
    await db.exec(`
      CREATE TABLE accounts (...)
    `);
    await db.exec(`
      CREATE TABLE platform_users (...)
    `);
    // ...
  },
  down: async (db) => {
    await db.exec('DROP TABLE accounts');
    await db.exec('DROP TABLE platform_users');
    // ...
  },
};
```

### Running Migrations

```bash
# Run pending migrations
npm run db:migrate

# Rollback last migration
npm run db:rollback

# Reset and re-run all
npm run db:reset
```

## Encryption

### DM Content Encryption

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export function encryptContent(content: string, key: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(content, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return JSON.stringify({
    iv: iv.toString('hex'),
    encrypted,
    authTag: authTag.toString('hex'),
  });
}

export function decryptContent(encryptedJson: string, key: Buffer): string {
  const { iv, encrypted, authTag } = JSON.parse(encryptedJson);
  
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
```
