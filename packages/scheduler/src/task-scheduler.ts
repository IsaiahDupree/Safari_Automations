/**
 * Safari Task Scheduler
 * 
 * Central scheduler that coordinates all Safari automation tasks with
 * resource awareness, priority queuing, and dependency management.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import type {
  ScheduledTask,
  SchedulerConfig,
  SchedulerStatus,
  TaskType,
  TaskPriority,
  Platform,
  ResourceRequirements,
  SoraCreditStatus,
  PlatformStatus,
  DEFAULT_SCHEDULER_CONFIG,
} from './types.js';
import { SoraCreditMonitor } from './sora-credit-monitor.js';

export class TaskScheduler extends EventEmitter {
  private config: SchedulerConfig;
  private queue: ScheduledTask[] = [];
  private running: ScheduledTask[] = [];
  private completed: ScheduledTask[] = [];
  private isRunning = false;
  private startedAt: Date | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private soraMonitor: SoraCreditMonitor;
  private platformStatus: Map<Platform, PlatformStatus> = new Map();

  constructor(config: Partial<SchedulerConfig> = {}) {
    super();
    this.config = { 
      persistPath: './scheduler-state.json',
      checkIntervalMs: 5000,
      maxConcurrentTasks: 1,
      defaultRetries: 3,
      enableSoraMonitor: true,
      soraCheckIntervalMs: 60 * 60 * 1000, // 1 hour
      ...config 
    };
    this.soraMonitor = new SoraCreditMonitor(this.config.soraCheckIntervalMs);
    this.initializePlatforms();
    this.loadState();
  }

  private initializePlatforms(): void {
    const platforms: Platform[] = ['tiktok', 'instagram', 'twitter', 'sora', 'youtube', 'upwork', 'linkedin'];
    for (const platform of platforms) {
      this.platformStatus.set(platform, {
        platform,
        isReady: true,
        isLoggedIn: false,
        messagesThisHour: 0,
        messagesToday: 0,
      });
    }
  }

  /**
   * Schedule a new task
   */
  schedule(options: {
    type: TaskType;
    name: string;
    platform?: Platform;
    priority?: TaskPriority;
    scheduledFor?: Date;
    dependencies?: string[];
    resourceRequirements?: ResourceRequirements;
    maxRetries?: number;
    payload?: Record<string, unknown>;
  }): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const task: ScheduledTask = {
      id,
      type: options.type,
      name: options.name,
      platform: options.platform,
      priority: options.priority || 3,
      scheduledFor: options.scheduledFor || new Date(),
      createdAt: new Date(),
      dependencies: options.dependencies,
      resourceRequirements: options.resourceRequirements,
      status: 'pending',
      retryCount: 0,
      maxRetries: options.maxRetries ?? this.config.defaultRetries,
      payload: options.payload || {},
    };

    // Insert in priority order
    const insertIndex = this.queue.findIndex(t => t.priority > task.priority);
    if (insertIndex === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(insertIndex, 0, task);
    }

    console.log(`[SCHEDULER] 📋 Task scheduled: ${task.name} (${task.id})`);
    this.emit('taskScheduled', task);
    this.saveState();
    
    return id;
  }

  /**
   * Schedule a Sora trilogy generation
   */
  scheduleSoraTrilogy(trilogyId: string, trilogyName: string, options?: {
    priority?: TaskPriority;
    waitForCredits?: number;
  }): string {
    const taskId = this.schedule({
      type: 'sora',
      name: `Sora Trilogy: ${trilogyName}`,
      platform: 'sora',
      priority: options?.priority || 2,
      resourceRequirements: {
        soraCredits: options?.waitForCredits || 3,
        safariExclusive: true,
      },
      payload: {
        trilogyId,
        trilogyName,
        command: `npx tsx scripts/sora-trilogy-runner.ts --story ${trilogyId}`,
      },
    });

    // If waiting for credits, register callback
    if (options?.waitForCredits) {
      console.log(`[SCHEDULER] ⏳ Waiting for ${options.waitForCredits} Sora credits for ${trilogyName}`);
      this.soraMonitor.onCreditsAvailable(options.waitForCredits, () => {
        const task = this.queue.find(t => t.id === taskId);
        if (task && task.status === 'waiting') {
          task.status = 'pending';
          console.log(`[SCHEDULER] ✅ Credits available! ${trilogyName} ready to run`);
        }
      });
    }

    return taskId;
  }

  /**
   * Schedule DM automation session
   */
  scheduleDMSession(platform: Platform, options?: {
    priority?: TaskPriority;
    duration?: number;
    startTime?: Date;
  }): string {
    return this.schedule({
      type: 'dm',
      name: `DM Session: ${platform}`,
      platform,
      priority: options?.priority || 3,
      scheduledFor: options?.startTime || new Date(),
      resourceRequirements: {
        platform,
        safariExclusive: true,
      },
      payload: {
        duration: options?.duration || 60 * 60 * 1000, // 1 hour default
      },
    });
  }

  /**
   * Cancel a task
   */
  cancel(taskId: string): boolean {
    const index = this.queue.findIndex(t => t.id === taskId);
    if (index === -1) return false;

    const task = this.queue[index];
    task.status = 'cancelled';
    this.queue.splice(index, 1);
    this.completed.push(task);
    
    console.log(`[SCHEDULER] ❌ Task cancelled: ${task.name}`);
    this.saveState();
    return true;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      console.log('[SCHEDULER] Already running');
      return;
    }

    this.isRunning = true;
    this.startedAt = new Date();
    console.log('[SCHEDULER] 🚀 Starting task scheduler...');

    // Start Sora credit monitor
    if (this.config.enableSoraMonitor) {
      this.soraMonitor.start();
    }

    // Start processing loop
    this.intervalId = setInterval(() => {
      this.processQueue();
    }, this.config.checkIntervalMs);

    // Process immediately
    this.processQueue();
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.isRunning) return;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.soraMonitor.stop();
    this.isRunning = false;
    
    console.log('[SCHEDULER] ⏹️ Scheduler stopped');
    this.saveState();
  }

  /**
   * Pause the scheduler (keeps state, stops processing)
   */
  pause(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[SCHEDULER] ⏸️ Scheduler paused');
  }

  /**
   * Resume the scheduler
   */
  resume(): void {
    if (!this.isRunning) {
      this.start();
      return;
    }

    if (!this.intervalId) {
      this.intervalId = setInterval(() => {
        this.processQueue();
      }, this.config.checkIntervalMs);
      console.log('[SCHEDULER] ▶️ Scheduler resumed');
    }
  }

  /**
   * Get current status
   */
  getStatus(): SchedulerStatus {
    return {
      isRunning: this.isRunning,
      startedAt: this.startedAt,
      tasksInQueue: this.queue.length,
      tasksRunning: this.running.length,
      tasksCompleted: this.completed.filter(t => t.status === 'completed').length,
      tasksFailed: this.completed.filter(t => t.status === 'failed').length,
      soraCredits: this.soraMonitor.getStatus(),
      platforms: Array.from(this.platformStatus.values()),
    };
  }

  /**
   * Get queue
   */
  getQueue(): ScheduledTask[] {
    return [...this.queue];
  }

  /**
   * Get running tasks
   */
  getRunning(): ScheduledTask[] {
    return [...this.running];
  }

  /**
   * Get completed tasks
   */
  getCompleted(limit?: number): ScheduledTask[] {
    const sorted = [...this.completed].sort(
      (a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0)
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    if (this.running.length >= this.config.maxConcurrentTasks) {
      return;
    }

    // Check quiet hours
    if (this.isQuietHours()) {
      return;
    }

    // Find next ready task
    const task = this.findNextReadyTask();
    if (!task) return;

    await this.executeTask(task);
  }

  /**
   * Find the next task that's ready to run
   */
  private findNextReadyTask(): ScheduledTask | null {
    const now = new Date();

    for (const task of this.queue) {
      // Skip if not yet scheduled
      if (task.scheduledFor > now) continue;

      // Skip if waiting for resources
      if (task.status === 'waiting') continue;

      // Check dependencies
      if (task.dependencies?.length) {
        const allComplete = task.dependencies.every(depId =>
          this.completed.some(t => t.id === depId && t.status === 'completed')
        );
        if (!allComplete) continue;
      }

      // Check resource requirements
      if (!this.checkResourceRequirements(task)) {
        task.status = 'waiting';
        continue;
      }

      return task;
    }

    return null;
  }

  /**
   * Check if task's resource requirements are met
   */
  private checkResourceRequirements(task: ScheduledTask): boolean {
    const req = task.resourceRequirements;
    if (!req) return true;

    // Check Sora credits
    if (req.soraCredits) {
      const credits = this.soraMonitor.getStatus();
      if (!credits || credits.totalCredits < req.soraCredits) {
        return false;
      }
    }

    // Check platform availability
    if (req.platform) {
      const platform = this.platformStatus.get(req.platform);
      if (!platform?.isReady) return false;
    }

    return true;
  }

  /**
   * Execute a task
   */
  private async executeTask(task: ScheduledTask): Promise<void> {
    // Move from queue to running
    const index = this.queue.indexOf(task);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
    
    task.status = 'running';
    task.startedAt = new Date();
    this.running.push(task);
    
    console.log(`[SCHEDULER] ▶️ Starting task: ${task.name}`);
    this.emit('taskStarted', task);

    try {
      // Execute based on task type
      const result = await this.runTask(task);
      
      task.status = 'completed';
      task.completedAt = new Date();
      task.result = result;
      
      console.log(`[SCHEDULER] ✅ Task completed: ${task.name}`);
      this.emit('taskCompleted', task);
      
    } catch (error) {
      task.retryCount++;
      task.error = error instanceof Error ? error.message : String(error);
      
      if (task.retryCount < task.maxRetries) {
        // Retry
        task.status = 'pending';
        this.queue.push(task);
        console.log(`[SCHEDULER] 🔄 Task retry ${task.retryCount}/${task.maxRetries}: ${task.name}`);
      } else {
        task.status = 'failed';
        task.completedAt = new Date();
        console.log(`[SCHEDULER] ❌ Task failed: ${task.name} - ${task.error}`);
        this.emit('taskFailed', task, error);
      }
    }

    // Move from running to completed
    const runIndex = this.running.indexOf(task);
    if (runIndex !== -1) {
      this.running.splice(runIndex, 1);
    }
    if (task.status === 'completed' || task.status === 'failed') {
      this.completed.push(task);
    }

    this.saveState();
  }

  /**
   * Run the actual task
   */
  private async runTask(task: ScheduledTask): Promise<unknown> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    switch (task.type) {
      case 'sora': {
        const command = task.payload.command as string;
        if (!command) throw new Error('No command specified for Sora task');
        
        const { stdout, stderr } = await execAsync(command, {
          cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation',
          timeout: 60 * 60 * 1000, // 1 hour timeout
        });
        
        return { stdout, stderr };
      }

      case 'dm': {
        // DM session - would integrate with DM APIs
        console.log(`[SCHEDULER] Running DM session for ${task.platform}`);
        return { message: 'DM session completed' };
      }

      case 'comment': {
        console.log(`[SCHEDULER] Running comment task`);
        return { message: 'Comment task completed' };
      }

      case 'discovery': {
        console.log(`[SCHEDULER] Running discovery task`);
        return { message: 'Discovery completed' };
      }

      case 'sync': {
        console.log(`[SCHEDULER] Running sync task`);
        return { message: 'Sync completed' };
      }

      case 'sora-generate': {
        const mode = task.payload.mode || 'mix';
        const genCount = task.payload.count || 5;
        const shouldGenerate = task.payload.generate !== false;

        const genCmd = `npx tsx scripts/sora-content-generator.ts --mode ${mode} --count ${genCount}${shouldGenerate ? ' --generate' : ' --save'}`;
        console.log(`[SCHEDULER] 🎬 Content generation: ${genCmd}`);

        const genResult = await execAsync(genCmd, {
          cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation',
          timeout: 30 * 60 * 1000, // 30 min (Sora generation is slow)
        });
        console.log(`[SCHEDULER] 🎬 Generation output:\n${genResult.stdout}`);
        return { stdout: genResult.stdout, stderr: genResult.stderr };
      }

      case 'sora-daily-pipeline': {
        const pMode = task.payload.mode || 'mix';
        const pCount = task.payload.count || 6;
        const queueCount = task.payload.queueCount || 4;
        const platforms = task.payload.platforms || 'youtube';
        const skipGenerate = task.payload.skipGenerate ? ' --skip-generate' : '';
        const skipDrain = task.payload.skipDrain ? ' --skip-drain' : '';
        const generateOnly = task.payload.generateOnly ? ' --generate-only' : '';
        const drainOnly = task.payload.drainOnly ? ' --drain-only' : '';

        const pipelineCmd = `npx tsx scripts/sora-daily-pipeline.ts --mode ${pMode} --count ${pCount} --queue-count ${queueCount} --platforms ${platforms}${skipGenerate}${skipDrain}${generateOnly}${drainOnly}`;
        console.log(`[SCHEDULER] 🚀 Daily pipeline: ${pipelineCmd}`);

        const pipelineResult = await execAsync(pipelineCmd, {
          cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation',
          timeout: 60 * 60 * 1000, // 60 min (generation + drain)
        });
        console.log(`[SCHEDULER] 🚀 Pipeline output:\n${pipelineResult.stdout}`);
        return { stdout: pipelineResult.stdout, stderr: pipelineResult.stderr };
      }

      case 'queue-drain': {
        const maxPublished = task.payload.maxPublished || 10;
        const maxRounds = task.payload.maxRounds || 15;
        const wait = task.payload.wait || 120;
        const batchSize = task.payload.batchSize || 4;
        const persistent = task.payload.persistent ? ' --persistent' : '';

        const drainCmd = `npx tsx scripts/queue-drain.ts --max-published ${maxPublished} --max-rounds ${maxRounds} --wait ${wait} --batch-size ${batchSize}${persistent}`;
        console.log(`[SCHEDULER] 📤 Queue drain: ${drainCmd}`);

        const drainResult = await execAsync(drainCmd, {
          cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation',
          timeout: 45 * 60 * 1000, // 45 min
        });
        console.log(`[SCHEDULER] 📤 Drain output:\n${drainResult.stdout}`);
        return { stdout: drainResult.stdout, stderr: drainResult.stderr };
      }

      case 'daily-research': {
        const drPayload = task.payload as any;
        const drMaxAds = drPayload.maxAds || 30;
        const drSkipScrape = drPayload.skipScrape ? ' --skip-scrape' : '';
        const drCmd = `python3 python/market_research/daily_research.py --max-ads ${drMaxAds}${drSkipScrape}`;
        console.log(`[SCHEDULER] 🔬 Daily Research: ${drCmd}`);
        const drResult = await execAsync(drCmd, {
          cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation',
          timeout: 45 * 60 * 1000,
        });
        console.log(`[SCHEDULER] 🔬 Daily Research output:\n${drResult.stdout}`);
        return { stdout: drResult.stdout, stderr: drResult.stderr };
      }

      case 'meta-ad-library': {
        const malPayload = task.payload as any;
        const malKeywords = (malPayload.keywords || []).join(',');
        const malMaxAds = malPayload.maxAds || 30;
        const malDownloadTop = malPayload.downloadTop || 5;
        const malCountry = malPayload.country || 'US';
        const malAllStatus = malPayload.allStatus ? ' --all-status' : '';

        const malCmd = `python3 python/market_research/meta_ad_library_cli.py batch --keywords "${malKeywords}" --max-per-keyword ${malMaxAds} --download-top ${malDownloadTop} --country ${malCountry}${malAllStatus}`;
        console.log(`[SCHEDULER] 📚 Meta Ad Library: ${malCmd}`);

        const malResult = await execAsync(malCmd, {
          cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation',
          timeout: 30 * 60 * 1000,
        });
        console.log(`[SCHEDULER] 📚 Ad Library output:\n${malResult.stdout}`);
        return { stdout: malResult.stdout, stderr: malResult.stderr };
      }

      case 'market-research': {
        const mrPayload = task.payload as any;
        const keywords = (mrPayload.keywords || []).join(',');
        const maxPosts = mrPayload.maxPosts || 50;
        const downloadTop = mrPayload.downloadTop || 10;
        const searchType = mrPayload.searchType || 'posts';
        const dateFilter = mrPayload.dateFilter ? ` --date ${mrPayload.dateFilter}` : '';

        const mrCmd = `python3 python/market_research/run_facebook.py batch --keywords "${keywords}" --max-per-keyword ${maxPosts} --download-top ${downloadTop} --type ${searchType}${dateFilter}`;
        console.log(`[SCHEDULER] 🔍 Facebook research: ${mrCmd}`);

        const mrResult = await execAsync(mrCmd, {
          cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation',
          timeout: 30 * 60 * 1000,
        });
        console.log(`[SCHEDULER] 🔍 Research output:\n${mrResult.stdout}`);
        return { stdout: mrResult.stdout, stderr: mrResult.stderr };
      }

      case 'market-research-instagram': {
        const igPayload = task.payload as any;
        const igKeywords = (igPayload.keywords || []).join(',');
        const igMaxPosts = igPayload.maxPosts || 50;
        const igDownloadTop = igPayload.downloadTop || 10;
        const igSearchType = igPayload.searchType || 'hashtag';
        const igDetail = igPayload.detail ? ' --detail' : '';

        const igCmd = `python3 python/market_research/run_instagram.py batch --keywords "${igKeywords}" --max-per-keyword ${igMaxPosts} --download-top ${igDownloadTop} --type ${igSearchType}${igDetail}`;
        console.log(`[SCHEDULER] 📸 Instagram research: ${igCmd}`);

        const igResult = await execAsync(igCmd, {
          cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation',
          timeout: 30 * 60 * 1000,
        });
        console.log(`[SCHEDULER] 📸 IG Research output:\n${igResult.stdout}`);
        return { stdout: igResult.stdout, stderr: igResult.stderr };
      }

      case 'ad-brief': {
        const briefPayload = task.payload as any;
        const briefKeyword = briefPayload.keyword || '';
        const briefProduct = briefPayload.product || 'mediaposter';
        const briefPlatform = briefPayload.platform || 'facebook';
        const skipScrape = briefPayload.skipScrape ? ' --skip-scrape' : '';

        const briefCmd = `python3 python/market_research/run_ad_intelligence.py brief "${briefKeyword}" --product ${briefProduct} --platform ${briefPlatform}`;
        console.log(`[SCHEDULER] 💡 Ad brief: ${briefCmd}`);

        const briefResult = await execAsync(briefCmd, {
          cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation',
          timeout: 10 * 60 * 1000,
        });
        console.log(`[SCHEDULER] 💡 Brief output:\n${briefResult.stdout}`);
        return { stdout: briefResult.stdout, stderr: briefResult.stderr };
      }

      case 'upwork-job-scan': {
        const upPayload = task.payload as any;
        const upKeywords = (upPayload.keywords || ['TypeScript', 'React']).join(' ');
        const upSkills = (upPayload.preferredSkills || ['TypeScript', 'React', 'Node.js']).join(',');
        const upMinBudget = upPayload.minBudget || 500;
        const upTab = upPayload.tab || '';
        const upFilters = upPayload.filters ? JSON.stringify(upPayload.filters) : '{}';

        // Step 1: Search or browse tab
        let scanCmd: string;
        if (upTab) {
          scanCmd = `curl -s -X POST http://localhost:3104/api/upwork/jobs/tab -H "Content-Type: application/json" -d '{"tab":"${upTab}"}'`;
        } else {
          scanCmd = `curl -s -X POST http://localhost:3104/api/upwork/jobs/search -H "Content-Type: application/json" -d '${JSON.stringify({ keywords: upPayload.keywords || ['TypeScript', 'React'], ...upPayload.filters })}'`;
        }
        console.log(`[SCHEDULER] 🏢 Upwork job scan: ${scanCmd.substring(0, 80)}...`);

        const scanResult = await execAsync(scanCmd, { timeout: 60 * 1000 });
        const scanData = JSON.parse(scanResult.stdout);
        console.log(`[SCHEDULER] 🏢 Found ${scanData.count || scanData.jobs?.length || 0} jobs`);

        // Step 2: Batch score
        if (scanData.jobs?.length > 0) {
          const scoreCmd = `curl -s -X POST http://localhost:3104/api/upwork/jobs/score-batch -H "Content-Type: application/json" -d '${JSON.stringify({
            jobs: scanData.jobs,
            preferredSkills: upPayload.preferredSkills || ['TypeScript', 'React', 'Node.js'],
            minBudget: upMinBudget,
            availableConnects: upPayload.availableConnects || 100,
          })}'`;

          const scoreResult = await execAsync(scoreCmd, { timeout: 30 * 1000 });
          const scores = JSON.parse(scoreResult.stdout);
          console.log(`[SCHEDULER] 🏢 Scored: ${scores.applyCount} apply, ${scores.maybeCount} maybe, ${scores.skipCount} skip`);
          return { jobs: scanData.jobs.length, scores };
        }

        return { jobs: 0 };
      }

      case 'upwork-apply': {
        // Placeholder — will integrate with proposal submission automation
        const applyPayload = task.payload as any;
        const jobUrl = applyPayload.jobUrl;
        if (!jobUrl) throw new Error('jobUrl required for upwork-apply');

        // Step 1: Extract detail
        const detailCmd = `curl -s "http://localhost:3104/api/upwork/jobs/detail?url=${encodeURIComponent(jobUrl)}"`;
        const detailResult = await execAsync(detailCmd, { timeout: 60 * 1000 });
        const detail = JSON.parse(detailResult.stdout);
        console.log(`[SCHEDULER] 🏢 Upwork apply: ${detail.title} (${detail.connectsCost} connects)`);

        // Step 2: Generate proposal
        const proposalCmd = `curl -s -X POST http://localhost:3104/api/upwork/proposals/generate -H "Content-Type: application/json" -d '${JSON.stringify({
          job: detail,
          highlightSkills: applyPayload.highlightSkills,
          customInstructions: applyPayload.customInstructions,
        })}'`;
        const proposalResult = await execAsync(proposalCmd, { timeout: 30 * 1000 });
        const proposal = JSON.parse(proposalResult.stdout);
        console.log(`[SCHEDULER] 🏢 Proposal generated (${proposal.coverLetter?.length || 0} chars, AI: ${proposal.aiGenerated})`);

        return { detail, proposal };
      }

      case 'linkedin-outreach': {
        const lnPayload = task.payload as any;
        const lnAction = lnPayload.action || 'search';

        let lnCmd: string;
        if (lnAction === 'search') {
          lnCmd = `curl -s -X POST http://localhost:3105/api/linkedin/search -H "Content-Type: application/json" -d '${JSON.stringify(lnPayload.searchConfig || {})}'`;
        } else if (lnAction === 'connect') {
          lnCmd = `curl -s -X POST http://localhost:3105/api/linkedin/connect -H "Content-Type: application/json" -d '${JSON.stringify({ profileUrl: lnPayload.profileUrl, note: lnPayload.note })}'`;
        } else {
          lnCmd = `curl -s http://localhost:3105/api/linkedin/status`;
        }

        console.log(`[SCHEDULER] 💼 LinkedIn ${lnAction}: ${lnCmd.substring(0, 80)}...`);
        const lnResult = await execAsync(lnCmd, { timeout: 60 * 1000 });
        return JSON.parse(lnResult.stdout);
      }

      case 'publish': {
        const count = task.payload.count || 4;
        const platform = task.payload.platform || 'youtube';

        // Step 1: Run daily orchestrator to generate UGC + select Sora videos + queue
        const orchestratorCmd = task.payload.command as string ||
          `npx tsx scripts/daily-orchestrator.ts --ugc-count 2 --sora-count ${count} --platforms ${platform}`;
        console.log(`[SCHEDULER] 📺 Step 1: Running orchestrator: ${orchestratorCmd}`);

        const { stdout, stderr } = await execAsync(orchestratorCmd, {
          cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation',
          timeout: 5 * 60 * 1000, // 5 min timeout
        });
        console.log(`[SCHEDULER] 📺 Orchestrator output:\n${stdout}`);

        // Step 2: Trigger Blotato queue processor to actually publish queued items
        console.log(`[SCHEDULER] 📺 Step 2: Triggering Blotato queue processor...`);
        try {
          const processResp = await fetch('http://localhost:5555/api/publish-controls/process/batch?max_items=5', {
            method: 'POST',
            signal: AbortSignal.timeout(5 * 60 * 1000),
          });
          const processResult = await processResp.json();
          console.log(`[SCHEDULER] 📺 Queue processor result: ${JSON.stringify(processResult)}`);
          return { stdout, stderr, processResult };
        } catch (processErr) {
          console.log(`[SCHEDULER] ⚠️ Queue processor failed (items still queued): ${processErr}`);
          return { stdout, stderr, processError: String(processErr) };
        }
      }

      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  /**
   * Check if in quiet hours
   */
  private isQuietHours(): boolean {
    if (!this.config.quietHoursStart || !this.config.quietHoursEnd) {
      return false;
    }

    const hour = new Date().getHours();
    const start = this.config.quietHoursStart;
    const end = this.config.quietHoursEnd;

    if (start < end) {
      return hour >= start && hour < end;
    }
    return hour >= start || hour < end;
  }

  /**
   * Save state to disk
   */
  private saveState(): void {
    try {
      const state = {
        queue: this.queue,
        completed: this.completed.slice(-100), // Keep last 100
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.config.persistPath, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('[SCHEDULER] Error saving state:', error);
    }
  }

  /**
   * Load state from disk
   */
  private loadState(): void {
    try {
      if (fs.existsSync(this.config.persistPath)) {
        const data = fs.readFileSync(this.config.persistPath, 'utf-8');
        const state = JSON.parse(data);
        
        // Restore queue (rehydrate dates)
        this.queue = (state.queue || []).map((t: ScheduledTask) => ({
          ...t,
          scheduledFor: new Date(t.scheduledFor),
          createdAt: new Date(t.createdAt),
          startedAt: t.startedAt ? new Date(t.startedAt) : undefined,
          completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
        }));
        
        this.completed = state.completed || [];
        console.log(`[SCHEDULER] Loaded ${this.queue.length} pending tasks from state`);
      }
    } catch (error) {
      console.error('[SCHEDULER] Error loading state:', error);
    }
  }
}
