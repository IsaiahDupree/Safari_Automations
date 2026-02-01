#!/usr/bin/env npx tsx
/**
 * Safari Task Scheduler CLI
 * 
 * Commands:
 *   start              Start the scheduler daemon
 *   stop               Stop the scheduler
 *   status             Show scheduler status
 *   queue              Show task queue
 *   resources          Show resource status (Sora credits, platforms)
 *   sora <trilogy>     Schedule a Sora trilogy
 *   dm <platform>      Schedule a DM session
 *   cancel <taskId>    Cancel a task
 */

import { TaskScheduler } from '../src/task-scheduler.js';
import { SoraCreditMonitor } from '../src/sora-credit-monitor.js';
import type { Platform } from '../src/types.js';

const args = process.argv.slice(2);
const command = args[0];

// Trilogy definitions for quick reference
const TRILOGIES: Record<string, string> = {
  volcanic_fury: 'Volcanic Fury',
  abyssal_descent: 'Abyssal Descent',
  neon_shadows: 'Neon Shadows',
  frozen_edge: 'Frozen Edge',
  titan_protocol: 'Titan Protocol',
  temporal_shift: 'Temporal Shift',
  midnight_run: 'Midnight Run',
  way_of_dragon: 'Way of the Dragon',
  first_contact: 'First Contact',
};

function printHelp(): void {
  console.log(`
📅 Safari Task Scheduler CLI

USAGE:
  npx tsx cli/scheduler-cli.ts <command> [options]

COMMANDS:
  start                    Start the scheduler daemon
  stop                     Stop the scheduler  
  status                   Show scheduler status
  queue                    Show task queue
  resources                Show resource status
  
  sora <trilogy>           Schedule a Sora trilogy
    --when-credits <n>     Wait until n credits available
    --priority <1-5>       Task priority (1=highest)
    
  dm <platform>            Schedule a DM session
    --duration <minutes>   Session duration
    
  cancel <taskId>          Cancel a pending task

EXAMPLES:
  npx tsx cli/scheduler-cli.ts start
  npx tsx cli/scheduler-cli.ts resources
  npx tsx cli/scheduler-cli.ts sora first_contact --when-credits 3
  npx tsx cli/scheduler-cli.ts dm tiktok --duration 60
  `);
}

async function showStatus(): Promise<void> {
  const scheduler = new TaskScheduler();
  const status = scheduler.getStatus();
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  SAFARI TASK SCHEDULER STATUS                              ║
╠════════════════════════════════════════════════════════════╣
║  Running: ${status.isRunning ? '✅ Yes' : '❌ No'}                                        
║  Started: ${status.startedAt?.toLocaleString() || 'N/A'}                     
║                                                            
║  QUEUE:                                                    
║    Pending:   ${String(status.tasksInQueue).padEnd(4)} tasks                            
║    Running:   ${String(status.tasksRunning).padEnd(4)} tasks                            
║    Completed: ${String(status.tasksCompleted).padEnd(4)} tasks                            
║    Failed:    ${String(status.tasksFailed).padEnd(4)} tasks                            
╚════════════════════════════════════════════════════════════╝
  `);
}

async function showQueue(): Promise<void> {
  const scheduler = new TaskScheduler();
  const queue = scheduler.getQueue();
  const running = scheduler.getRunning();
  
  console.log('\n📋 TASK QUEUE\n');
  
  if (running.length > 0) {
    console.log('🔄 RUNNING:');
    for (const task of running) {
      console.log(`   [${task.priority}] ${task.name}`);
      console.log(`       Started: ${task.startedAt?.toLocaleTimeString()}`);
    }
    console.log('');
  }
  
  if (queue.length === 0) {
    console.log('   (empty)\n');
    return;
  }
  
  console.log('⏳ PENDING:');
  for (const task of queue) {
    const waitingFor = task.status === 'waiting' ? ' [waiting for resources]' : '';
    console.log(`   [${task.priority}] ${task.name}${waitingFor}`);
    console.log(`       Type: ${task.type}, Platform: ${task.platform || 'N/A'}`);
    console.log(`       Scheduled: ${task.scheduledFor.toLocaleString()}`);
  }
  console.log('');
}

async function showResources(): Promise<void> {
  console.log('\n📊 RESOURCES\n');
  
  // Check Sora credits
  const soraMonitor = new SoraCreditMonitor();
  const credits = await soraMonitor.checkCredits();
  
  if (credits) {
    console.log('🎬 SORA:');
    console.log(`   Credits: ${credits.totalCredits} (${credits.freeCredits} free, ${credits.paidCredits} paid)`);
    console.log(`   Refreshes: ${soraMonitor.getTimeUntilRefresh()}`);
  } else {
    console.log('🎬 SORA: Unable to check credits');
  }
  
  console.log('');
  console.log('💬 PLATFORMS:');
  console.log('   TikTok:    Check port 3002');
  console.log('   Instagram: Check port 3001');
  console.log('   Twitter:   Check port 3003');
  console.log('');
}

async function scheduleSora(): Promise<void> {
  const trilogyId = args[1];
  if (!trilogyId) {
    console.error('❌ Please specify a trilogy ID');
    console.log('Available trilogies:');
    for (const [id, name] of Object.entries(TRILOGIES)) {
      console.log(`   ${id} - ${name}`);
    }
    return;
  }
  
  const trilogyName = TRILOGIES[trilogyId] || trilogyId;
  
  // Parse options
  let whenCredits = 3;
  let priority = 2;
  
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--when-credits' && args[i + 1]) {
      whenCredits = parseInt(args[i + 1]);
    }
    if (args[i] === '--priority' && args[i + 1]) {
      priority = parseInt(args[i + 1]) as 1 | 2 | 3 | 4 | 5;
    }
  }
  
  const scheduler = new TaskScheduler();
  const taskId = scheduler.scheduleSoraTrilogy(trilogyId, trilogyName, {
    priority: priority as 1 | 2 | 3 | 4 | 5,
    waitForCredits: whenCredits,
  });
  
  console.log(`✅ Scheduled Sora trilogy: ${trilogyName}`);
  console.log(`   Task ID: ${taskId}`);
  console.log(`   Waiting for: ${whenCredits} credits`);
  console.log(`   Priority: ${priority}`);
}

async function scheduleDM(): Promise<void> {
  const platform = args[1] as Platform;
  if (!platform || !['tiktok', 'instagram', 'twitter'].includes(platform)) {
    console.error('❌ Please specify a valid platform: tiktok, instagram, twitter');
    return;
  }
  
  let duration = 60;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--duration' && args[i + 1]) {
      duration = parseInt(args[i + 1]);
    }
  }
  
  const scheduler = new TaskScheduler();
  const taskId = scheduler.scheduleDMSession(platform, {
    duration: duration * 60 * 1000,
  });
  
  console.log(`✅ Scheduled DM session: ${platform}`);
  console.log(`   Task ID: ${taskId}`);
  console.log(`   Duration: ${duration} minutes`);
}

async function startScheduler(): Promise<void> {
  console.log('🚀 Starting Safari Task Scheduler...\n');
  
  const scheduler = new TaskScheduler({
    persistPath: '/Users/isaiahdupree/sora-videos/scheduler-state.json',
    checkIntervalMs: 10000,
    enableSoraMonitor: true,
    soraCheckIntervalMs: 60 * 60 * 1000, // 1 hour
  });
  
  scheduler.on('taskStarted', (task) => {
    console.log(`▶️  Started: ${task.name}`);
  });
  
  scheduler.on('taskCompleted', (task) => {
    console.log(`✅ Completed: ${task.name}`);
  });
  
  scheduler.on('taskFailed', (task, error) => {
    console.log(`❌ Failed: ${task.name} - ${error.message}`);
  });
  
  scheduler.start();
  
  console.log('Scheduler running. Press Ctrl+C to stop.\n');
  
  // Keep process alive
  process.on('SIGINT', () => {
    console.log('\nStopping scheduler...');
    scheduler.stop();
    process.exit(0);
  });
  
  // Print status every 30 seconds
  setInterval(() => {
    const status = scheduler.getStatus();
    console.log(`[${new Date().toLocaleTimeString()}] Queue: ${status.tasksInQueue}, Running: ${status.tasksRunning}`);
  }, 30000);
}

async function cancelTask(): Promise<void> {
  const taskId = args[1];
  if (!taskId) {
    console.error('❌ Please specify a task ID');
    return;
  }
  
  const scheduler = new TaskScheduler();
  const success = scheduler.cancel(taskId);
  
  if (success) {
    console.log(`✅ Cancelled task: ${taskId}`);
  } else {
    console.log(`❌ Task not found: ${taskId}`);
  }
}

// Main
async function main(): Promise<void> {
  switch (command) {
    case 'start':
      await startScheduler();
      break;
    case 'status':
      await showStatus();
      break;
    case 'queue':
      await showQueue();
      break;
    case 'resources':
      await showResources();
      break;
    case 'sora':
      await scheduleSora();
      break;
    case 'dm':
      await scheduleDM();
      break;
    case 'cancel':
      await cancelTask();
      break;
    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp();
  }
}

main().catch(console.error);
