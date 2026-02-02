# PRD: Upwork Automation System
**Date:** February 1, 2026  
**Status:** 📋 PLANNED  
**Priority:** High  
**Platform:** Upwork (upwork.com)

---

## Overview

Safari-based automation for Upwork to streamline freelance job discovery, application management, client communication, and opportunity tracking. Uses the existing Safari automation framework to interact with Upwork's web interface.

---

## Goals

1. **Discover relevant jobs** - Automated scanning based on keywords, skills, budget
2. **Extract job information** - Pull job details, client history, budget, requirements
3. **Streamline applications** - AI-assisted proposal writing, template management
4. **Track opportunities** - Monitor job status, client responses, interview requests
5. **Manage communications** - Read/respond to messages, schedule follow-ups

---

## Features

### Phase 1: Job Discovery & Information Extraction

#### 1.1 Job Search Automation
```typescript
interface JobSearchConfig {
  keywords: string[];           // ["TypeScript", "Node.js", "automation"]
  categories: string[];         // ["Web Development", "Software Development"]
  budgetMin?: number;           // Minimum budget filter
  budgetMax?: number;           // Maximum budget filter
  jobType: 'hourly' | 'fixed' | 'both';
  experienceLevel: 'entry' | 'intermediate' | 'expert' | 'any';
  clientHistory: 'any' | 'payment_verified' | 'has_hires';
  postedWithin: '24h' | '3d' | '7d' | '14d' | '30d';
  excludeKeywords?: string[];   // Jobs to skip
}
```

#### 1.2 Job Data Extraction
```typescript
interface UpworkJob {
  id: string;
  title: string;
  description: string;
  budget: {
    type: 'hourly' | 'fixed';
    min?: number;
    max?: number;
    amount?: number;
  };
  skills: string[];
  category: string;
  experienceLevel: string;
  postedAt: Date;
  proposals: number;
  clientInfo: {
    location: string;
    paymentVerified: boolean;
    totalSpent: number;
    hireRate: number;
    jobsPosted: number;
    reviewScore?: number;
  };
  url: string;
  isInviteOnly: boolean;
  connectsCost: number;
}
```

#### 1.3 Job Scoring System
```typescript
interface JobScore {
  jobId: string;
  totalScore: number;        // 0-100
  factors: {
    budgetMatch: number;     // Does budget match expectations?
    skillMatch: number;      // How many skills match?
    clientQuality: number;   // Payment history, reviews
    competition: number;     // Number of proposals
    freshness: number;       // How recently posted?
    descriptionQuality: number; // AI analysis of clarity
  };
  recommendation: 'apply' | 'maybe' | 'skip';
  reason: string;
}
```

### Phase 2: Application Management

#### 2.1 Proposal Templates
```typescript
interface ProposalTemplate {
  id: string;
  name: string;
  category: string[];        // Which job categories to use this for
  template: string;          // With {{placeholders}}
  tone: 'professional' | 'friendly' | 'technical';
  includePortfolio: boolean;
  suggestedRate?: number;
}
```

#### 2.2 AI Proposal Generation
```typescript
interface ProposalRequest {
  job: UpworkJob;
  template?: ProposalTemplate;
  customInstructions?: string;
  highlightSkills: string[];
  includeQuestions: boolean;  // Ask clarifying questions
  proposedRate?: number;
  estimatedDuration?: string;
}

interface GeneratedProposal {
  coverLetter: string;
  suggestedQuestions: string[];
  attachments: string[];      // Portfolio items to attach
  connectsCost: number;
  confidence: number;         // AI confidence in this proposal
}
```

#### 2.3 Application Tracking
```typescript
interface ApplicationStatus {
  jobId: string;
  appliedAt: Date;
  proposalText: string;
  connectsUsed: number;
  status: 'submitted' | 'viewed' | 'shortlisted' | 'interview' | 'hired' | 'declined' | 'withdrawn';
  clientViewed: boolean;
  clientViewedAt?: Date;
  messages: number;
  lastActivity?: Date;
}
```

### Phase 3: Communication Management

#### 3.1 Message Monitoring
```typescript
interface UpworkMessage {
  id: string;
  jobId?: string;
  contractId?: string;
  from: string;
  to: string;
  content: string;
  timestamp: Date;
  isRead: boolean;
  requiresResponse: boolean;
  suggestedResponse?: string;  // AI-generated
}
```

#### 3.2 Auto-Response Templates
```typescript
interface AutoResponse {
  trigger: 'interview_request' | 'question' | 'offer' | 'rejection';
  template: string;
  useAI: boolean;
  requireApproval: boolean;
  delay: number;  // Minutes before sending
}
```

### Phase 4: Analytics & Insights

#### 4.1 Performance Metrics
```typescript
interface UpworkAnalytics {
  period: 'week' | 'month' | 'quarter' | 'year';
  applications: {
    total: number;
    viewed: number;
    shortlisted: number;
    hired: number;
    viewRate: number;
    hireRate: number;
  };
  connects: {
    spent: number;
    remaining: number;
    costPerHire: number;
  };
  earnings: {
    total: number;
    pending: number;
    inProgress: number;
  };
  topPerformingCategories: string[];
  recommendedKeywords: string[];
}
```

---

## API Endpoints

### Job Discovery
```
GET  /api/upwork/jobs/search          - Search jobs with filters
GET  /api/upwork/jobs/:id             - Get job details
GET  /api/upwork/jobs/saved           - Get saved jobs
POST /api/upwork/jobs/:id/save        - Save a job
POST /api/upwork/jobs/:id/score       - Score a job
```

### Applications
```
POST /api/upwork/apply                - Submit application
GET  /api/upwork/applications         - List all applications
GET  /api/upwork/applications/:id     - Get application status
PUT  /api/upwork/applications/:id     - Update/withdraw application
```

### Proposals
```
GET  /api/upwork/templates            - List proposal templates
POST /api/upwork/templates            - Create template
POST /api/upwork/proposals/generate   - AI generate proposal
```

### Messages
```
GET  /api/upwork/messages             - Get messages
GET  /api/upwork/messages/unread      - Get unread messages
POST /api/upwork/messages/:id/reply   - Reply to message
POST /api/upwork/messages/:id/ai-draft - Generate AI draft
```

### Analytics
```
GET  /api/upwork/analytics            - Get performance analytics
GET  /api/upwork/connects             - Get connects balance
GET  /api/upwork/recommendations      - Get job recommendations
```

---

## Automation Workflows

### Daily Job Scan
```typescript
// Runs every 4 hours
async function dailyJobScan() {
  // 1. Search for new jobs matching criteria
  const jobs = await searchJobs(savedSearchConfig);
  
  // 2. Score each job
  const scoredJobs = await Promise.all(
    jobs.map(job => scoreJob(job))
  );
  
  // 3. Filter high-quality opportunities
  const recommended = scoredJobs.filter(j => j.totalScore >= 70);
  
  // 4. Notify user of top opportunities
  await notifyNewJobs(recommended);
  
  // 5. Auto-save jobs scoring 85+
  for (const job of recommended.filter(j => j.totalScore >= 85)) {
    await saveJob(job.jobId);
  }
}
```

### Application Assistant
```typescript
// When user clicks "Apply" on a job
async function assistApplication(jobId: string) {
  // 1. Extract full job details
  const job = await getJobDetails(jobId);
  
  // 2. Analyze requirements
  const analysis = await analyzeJobRequirements(job);
  
  // 3. Generate tailored proposal
  const proposal = await generateProposal({
    job,
    highlightSkills: analysis.matchingSkills,
    includeQuestions: analysis.hasUnclearRequirements,
  });
  
  // 4. Present to user for review/edit
  return { job, analysis, proposal };
}
```

### Message Response Assistant
```typescript
// When new message received
async function handleNewMessage(message: UpworkMessage) {
  // 1. Classify message type
  const type = await classifyMessage(message);
  
  // 2. Generate appropriate response
  const draft = await generateResponse(message, type);
  
  // 3. Queue for user approval or auto-send
  if (autoResponseConfig[type]?.requireApproval) {
    await queueForApproval(message.id, draft);
  } else {
    await scheduleResponse(message.id, draft, autoResponseConfig[type].delay);
  }
}
```

---

## Technical Implementation

### Package Structure
```
packages/upwork-automation/
├── src/
│   ├── api/
│   │   └── server.ts           # REST API
│   ├── automation/
│   │   ├── upwork-driver.ts    # Safari automation
│   │   ├── job-scraper.ts      # Job extraction
│   │   ├── proposal-submitter.ts
│   │   └── message-handler.ts
│   ├── ai/
│   │   ├── job-scorer.ts       # AI job scoring
│   │   ├── proposal-generator.ts
│   │   └── message-classifier.ts
│   ├── db/
│   │   ├── job-logger.ts       # Track jobs
│   │   └── application-logger.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

### Database Tables (Supabase)
```sql
-- Jobs discovered
CREATE TABLE upwork_jobs (
  id TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  budget JSONB,
  skills TEXT[],
  client_info JSONB,
  score INTEGER,
  status TEXT DEFAULT 'new',
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  url TEXT
);

-- Applications submitted
CREATE TABLE upwork_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT REFERENCES upwork_jobs(id),
  proposal TEXT,
  connects_used INTEGER,
  status TEXT DEFAULT 'submitted',
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity TIMESTAMPTZ
);

-- Proposal templates
CREATE TABLE upwork_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  category TEXT[],
  template TEXT,
  tone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Safari Automation Considerations

### Login & Session Management
- Use existing Safari session manager
- Handle 2FA if enabled
- Detect session expiration
- Rate limit requests to avoid detection

### Element Selectors
```typescript
const UPWORK_SELECTORS = {
  // Job search
  searchInput: 'input[placeholder*="Search"]',
  jobCard: '[data-test="job-tile"]',
  jobTitle: '[data-test="job-title"]',
  jobBudget: '[data-test="budget"]',
  
  // Application
  applyButton: '[data-test="apply-button"]',
  proposalTextarea: '[data-test="cover-letter"]',
  submitButton: '[data-test="submit-proposal"]',
  
  // Messages
  messageList: '[data-test="message-list"]',
  messageInput: '[data-test="message-input"]',
  sendButton: '[data-test="send-message"]',
};
```

### Rate Limiting
```typescript
const UPWORK_RATE_LIMITS = {
  searchesPerHour: 20,
  applicationsPerDay: 50,  // Connects limit
  messagesPerHour: 30,
  pageLoadsPerMinute: 10,
};
```

---

## Compliance & Ethics

### Platform Terms
- Respect Upwork's Terms of Service
- No fake reviews or inflated metrics
- No automated bidding wars
- User must review all proposals before submission

### Data Privacy
- Store only necessary job data
- Don't scrape client personal information
- Secure API key storage
- User controls all data retention

### Best Practices
- Human review required for all applications
- AI assists but doesn't fully automate sensitive actions
- Transparent about using automation tools
- Quality over quantity in applications

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Jobs scanned per day | 100+ |
| Application view rate | >50% |
| Interview rate | >20% |
| Time saved per application | 10 min |
| Connects efficiency | 3x current |

---

## Phases & Timeline

| Phase | Features | Estimated Effort |
|-------|----------|------------------|
| **Phase 1** | Job search, extraction, scoring | 2-3 days |
| **Phase 2** | Proposal generation, application tracking | 2-3 days |
| **Phase 3** | Message monitoring, auto-responses | 2 days |
| **Phase 4** | Analytics, recommendations | 1-2 days |

---

## Dependencies

- Safari automation framework (existing)
- OpenAI API for AI features
- Supabase for data storage
- Existing scheduler for automation

---

## Related PRDs

| PRD | Relevance |
|-----|-----------|
| PRD_Safari_Task_Scheduler | Task scheduling |
| PRD_AI_AUDIT_COMPLETE | AI integration patterns |
| PRD_DM_Automation | Message automation patterns |

---

**Created:** February 1, 2026  
**Status:** Ready for development
