#!/usr/bin/env npx tsx
/**
 * Safari Automation Dashboard CLI
 * 
 * Unified view of all automation systems
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface PlatformHealth {
  name: string;
  port: number;
  isHealthy: boolean;
  error?: string;
}

interface SoraStatus {
  credits: number;
  refreshIn: string;
}

interface QueueStatus {
  pending: number;
  running: number;
  completed: number;
}

async function checkHealth(name: string, port: number): Promise<PlatformHealth> {
  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    const data = await response.json() as { status: string };
    return { name, port, isHealthy: data.status === 'ok' };
  } catch (error) {
    return { name, port, isHealthy: false, error: String(error) };
  }
}

async function getSoraCredits(): Promise<SoraStatus> {
  try {
    const { stdout } = await execAsync(
      'npx tsx scripts/sora-usage-test.ts 2>/dev/null | tail -5',
      { cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation' }
    );
    
    const match = stdout.match(/Usage:\s*(\d+)\s*gens/i);
    const credits = match ? parseInt(match[1]) : 0;
    
    // Estimate refresh time (midnight UTC)
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setUTCHours(24, 0, 0, 0);
    const diff = nextMidnight.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return { credits, refreshIn: `${hours}h ${minutes}m` };
  } catch {
    return { credits: 0, refreshIn: 'Unknown' };
  }
}

async function getSchedulerQueue(): Promise<QueueStatus> {
  try {
    const response = await fetch('http://localhost:3010/api/scheduler/status', {
      signal: AbortSignal.timeout(2000),
    });
    const data = await response.json() as {
      tasksInQueue: number;
      tasksRunning: number;
      tasksCompleted: number;
    };
    return {
      pending: data.tasksInQueue || 0,
      running: data.tasksRunning || 0,
      completed: data.tasksCompleted || 0,
    };
  } catch {
    return { pending: 0, running: 0, completed: 0 };
  }
}

function clearScreen(): void {
  console.clear();
}

function printHeader(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🦁 SAFARI AUTOMATION DASHBOARD                                      ║
║  ${new Date().toLocaleString().padEnd(66)}║
╚══════════════════════════════════════════════════════════════════════╝
`);
}

async function printPlatforms(): Promise<void> {
  const platforms = [
    { name: 'Safari Gateway', port: 3000 },
    { name: 'Instagram DM', port: 3100 },
    { name: 'TikTok DM', port: 3102 },
    { name: 'Twitter DM', port: 3003 },
    { name: 'Threads Comments', port: 3004 },
    { name: 'Instagram Comments', port: 3005 },
    { name: 'TikTok Comments', port: 3006 },
    { name: 'Twitter Comments', port: 3007 },
    { name: 'Scheduler', port: 3010 },
    { name: 'Upwork', port: 3104 },
    { name: 'LinkedIn', port: 3105 },
    { name: 'Market Research', port: 3106 },
    { name: 'Cloud Sync', port: 3200 },
  ];
  
  const results = await Promise.all(
    platforms.map(p => checkHealth(p.name, p.port))
  );
  
  console.log('┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│  📡 SERVICES                                                        │');
  console.log('├─────────────────────────────────────────────────────────────────────┤');
  
  for (const result of results) {
    const icon = result.isHealthy ? '✅' : '❌';
    const status = result.isHealthy ? 'Online' : 'Offline';
    console.log(`│  ${icon} ${result.name.padEnd(15)} Port ${String(result.port).padEnd(6)} ${status.padEnd(20)}│`);
  }
  
  console.log('└─────────────────────────────────────────────────────────────────────┘');
}

async function printResources(): Promise<void> {
  const sora = await getSoraCredits();
  const queue = await getSchedulerQueue();
  
  console.log('┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│  📊 RESOURCES                                                       │');
  console.log('├─────────────────────────────────────────────────────────────────────┤');
  console.log(`│  🎬 Sora Credits: ${String(sora.credits).padEnd(5)} (refreshes in ${sora.refreshIn.padEnd(10)})           │`);
  console.log(`│  📋 Queue: ${String(queue.pending).padEnd(3)} pending, ${String(queue.running).padEnd(3)} running, ${String(queue.completed).padEnd(3)} completed      │`);
  console.log('└─────────────────────────────────────────────────────────────────────┘');
}

async function printCloudSync(): Promise<void> {
  try {
    const response = await fetch('http://localhost:3200/api/status', {
      signal: AbortSignal.timeout(3000),
    });
    const data = await response.json() as {
      engine: { running: boolean; lastResults: any[] };
      dashboard: { notifications: number; dms: number; posts: number; pendingActions: number; activeLearnings: number };
    };

    console.log('┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│  ☁️  CLOUD SYNC                                                      │');
    console.log('├─────────────────────────────────────────────────────────────────────┤');
    const eng = data.engine.running ? '🟢 Running' : '🔴 Stopped';
    console.log(`│  Engine: ${eng.padEnd(58)}│`);
    console.log(`│  Notifications: ${String(data.dashboard.notifications).padEnd(6)} DMs: ${String(data.dashboard.dms).padEnd(6)} Posts: ${String(data.dashboard.posts).padEnd(15)}│`);
    console.log(`│  Pending Actions: ${String(data.dashboard.pendingActions).padEnd(5)} Active Learnings: ${String(data.dashboard.activeLearnings).padEnd(19)}│`);

    const synced = data.engine.lastResults?.filter((r: any) => r.itemsSynced > 0) || [];
    const errors = data.engine.lastResults?.filter((r: any) => r.error) || [];
    if (synced.length > 0) {
      console.log(`│  Last sync: ${synced.map((r: any) => `${r.platform}/${r.dataType}:${r.itemsSynced}`).join(', ').slice(0, 55).padEnd(55)}│`);
    }
    if (errors.length > 0) {
      console.log(`│  ⚠️  ${errors.length} platform(s) offline                                           │`);
    }
    console.log('└─────────────────────────────────────────────────────────────────────┘');
  } catch {
    console.log('┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│  ☁️  CLOUD SYNC — ❌ Offline                                         │');
    console.log('└─────────────────────────────────────────────────────────────────────┘');
  }
}

async function printTrilogies(): Promise<void> {
  const trilogies = [
    { id: 1, name: 'Volcanic Fury', status: '✅' },
    { id: 2, name: 'Abyssal Descent', status: '✅' },
    { id: 3, name: 'Neon Shadows', status: '✅' },
    { id: 4, name: 'Frozen Edge', status: '✅' },
    { id: 5, name: 'Titan Protocol', status: '✅' },
    { id: 6, name: 'Temporal Shift', status: '✅' },
    { id: 7, name: 'Midnight Run', status: '✅' },
    { id: 8, name: 'Way of the Dragon', status: '✅' },
    { id: 9, name: 'First Contact', status: '⏳' },
  ];
  
  console.log('┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│  🎬 SORA TRILOGIES                                                  │');
  console.log('├─────────────────────────────────────────────────────────────────────┤');
  
  for (const t of trilogies) {
    console.log(`│  ${t.status} ${String(t.id).padEnd(2)} ${t.name.padEnd(25)}                              │`);
  }
  
  console.log('└─────────────────────────────────────────────────────────────────────┘');
}

function printCommands(): void {
  console.log('┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│  ⌨️  QUICK COMMANDS                                                  │');
  console.log('├─────────────────────────────────────────────────────────────────────┤');
  console.log('│  npx tsx packages/scheduler/cli/scheduler-cli.ts start              │');
  console.log('│  npx tsx packages/scheduler/cli/scheduler-cli.ts resources          │');
  console.log('│  npx tsx packages/unified-dm/src/cli.ts health                      │');
  console.log('│  npx tsx scripts/sora-batch-trilogies.ts --list                     │');
  console.log('└─────────────────────────────────────────────────────────────────────┘');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const watch = args.includes('--watch') || args.includes('-w');
  
  if (watch) {
    // Refresh every 10 seconds
    while (true) {
      clearScreen();
      printHeader();
      await printPlatforms();
      console.log('');
      await printCloudSync();
      console.log('');
      await printResources();
      console.log('');
      await printTrilogies();
      console.log('');
      printCommands();
      console.log('\n  Press Ctrl+C to exit. Refreshing every 10s...\n');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  } else {
    printHeader();
    await printPlatforms();
    console.log('');
    await printCloudSync();
    console.log('');
    await printResources();
    console.log('');
    await printTrilogies();
    console.log('');
    printCommands();
    console.log('');
  }
}

main().catch(console.error);
