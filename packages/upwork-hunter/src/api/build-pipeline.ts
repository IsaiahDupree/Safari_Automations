/**
 * Autonomous Build Pipeline
 *
 * For high-scoring gigs, this module:
 * 1. Spawns a Claude Code agent via run-harness-v2.js to build the deliverable
 * 2. Pushes the built project to GitHub (isaiahdupree/upwork-{gig-id})
 * 3. Deploys to Vercel and captures the live URL
 * 4. Backs up to Passport drive if mounted
 * 5. Updates the proposal with demo URL + GitHub link
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase.js';
import type { UpworkJob } from '../types/index.js';

const execAsync = promisify(exec);

const BUILD_DIR = '/tmp/upwork-builds';
const HARNESS_PATH = '/Users/isaiahdupree/Documents/Software/autonomous-coding-dashboard/harness';
const PASSPORT_PATH = '/Volumes/My Passport/clients';

export interface BuildResult {
  success: boolean;
  jobId: string;
  buildPath?: string;
  githubUrl?: string;
  demoUrl?: string;
  passportBackup?: boolean;
  error?: string;
  logs?: string[];
}

/**
 * Check if Passport drive is mounted
 */
function isPassportMounted(): boolean {
  try {
    return fs.existsSync(PASSPORT_PATH);
  } catch {
    return false;
  }
}

/**
 * Create a PRD markdown file for the Claude Code agent to build from
 */
function generateBuildPRD(job: UpworkJob): string {
  const { title, description, budget } = job;

  return `# ${title}

## Project Brief
${description}

## Budget
${budget}

## Requirements
Extract key requirements from the description above and build a complete, production-ready deliverable.

## Technical Approach
- Use modern web technologies (Next.js, Tailwind CSS, etc.)
- Implement all features described in the job posting
- Include responsive design
- Add basic SEO optimization
- Deploy-ready code with clear documentation

## Deliverables
1. Fully functional web application or landing page
2. Clean, well-documented code
3. README with setup instructions
4. Deployment configuration (Vercel-ready)
`;
}

/**
 * Spawn a Claude Code agent to build the deliverable
 * Uses run-harness-v2.js with the upwork-builder.md prompt
 */
async function spawnBuildAgent(job: UpworkJob, buildPath: string): Promise<{ success: boolean; logs: string[] }> {
  const logs: string[] = [];
  const prdPath = path.join(buildPath, 'BUILD_PRD.md');

  // Create build directory
  if (!fs.existsSync(BUILD_DIR)) {
    fs.mkdirSync(BUILD_DIR, { recursive: true });
  }

  if (!fs.existsSync(buildPath)) {
    fs.mkdirSync(buildPath, { recursive: true });
  }

  // Write PRD
  const prdContent = generateBuildPRD(job);
  fs.writeFileSync(prdPath, prdContent, 'utf-8');
  logs.push(`Created PRD at ${prdPath}`);

  // Generate features.json from PRD
  const featuresPath = path.join(buildPath, 'features.json');
  const features = {
    prd: job.job_id,
    name: job.title,
    priority: 10,
    targetPath: buildPath,
    features: [
      { id: 'BUILD-001', name: 'Project structure setup', passes: false },
      { id: 'BUILD-002', name: 'Core functionality implementation', passes: false },
      { id: 'BUILD-003', name: 'UI/UX implementation', passes: false },
      { id: 'BUILD-004', name: 'Responsive design', passes: false },
      { id: 'BUILD-005', name: 'Documentation and README', passes: false },
    ],
  };
  fs.writeFileSync(featuresPath, JSON.stringify(features, null, 2), 'utf-8');
  logs.push(`Generated features.json`);

  return new Promise((resolve) => {
    // Spawn the harness agent
    const harnessCmd = 'node';
    const harnessArgs = [
      path.join(HARNESS_PATH, 'run-harness-v2.js'),
      '--project', buildPath,
      '--prompt', path.join(HARNESS_PATH, 'prompts/upwork-autonomous-builder.md'),
      '--features', featuresPath,
      '--max-iterations', '50',
    ];

    logs.push(`Spawning harness: ${harnessCmd} ${harnessArgs.join(' ')}`);

    const child = spawn(harnessCmd, harnessArgs, {
      cwd: buildPath,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Timeout after 30 minutes
    const timeout = setTimeout(() => {
      logs.push('Build timeout after 30 minutes');
      child.kill('SIGTERM');
    }, 30 * 60 * 1000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      logs.push(`Harness exited with code ${code}`);

      if (stdout) logs.push(`STDOUT: ${stdout.slice(0, 500)}`);
      if (stderr) logs.push(`STDERR: ${stderr.slice(0, 500)}`);

      // Check if features were completed
      try {
        const updatedFeatures = JSON.parse(fs.readFileSync(featuresPath, 'utf-8'));
        const completedCount = updatedFeatures.features.filter((f: { passes: boolean }) => f.passes).length;
        const totalCount = updatedFeatures.features.length;
        logs.push(`Features completed: ${completedCount}/${totalCount}`);

        // Consider success if at least 60% of features pass
        const success = code === 0 || completedCount / totalCount >= 0.6;
        resolve({ success, logs });
      } catch (err) {
        logs.push(`Failed to read features: ${err instanceof Error ? err.message : String(err)}`);
        resolve({ success: code === 0, logs });
      }
    });
  });
}

/**
 * Push built code to GitHub using gh CLI
 */
async function pushToGitHub(buildPath: string, jobId: string): Promise<string | null> {
  try {
    const repoName = `upwork-${jobId}`;

    // Initialize git repo
    await execAsync('git init', { cwd: buildPath });
    await execAsync('git add .', { cwd: buildPath });
    await execAsync('git commit -m "Initial commit - Upwork deliverable"', { cwd: buildPath });

    // Create GitHub repo using gh CLI
    const { stdout } = await execAsync(
      `gh repo create isaiahdupree/${repoName} --public --source=. --remote=origin --push`,
      { cwd: buildPath }
    );

    const githubUrl = `https://github.com/isaiahdupree/${repoName}`;
    console.log(`[build-pipeline] Pushed to GitHub: ${githubUrl}`);
    return githubUrl;
  } catch (err) {
    console.error('[build-pipeline] GitHub push failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Deploy to Vercel and capture live URL
 */
async function deployToVercel(buildPath: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('npx vercel --yes --prod', {
      cwd: buildPath,
      env: { ...process.env },
    });

    // Extract URL from Vercel output (last line usually contains the URL)
    const lines = stdout.trim().split('\n');
    const urlLine = lines.find((line) => line.includes('https://')) || lines[lines.length - 1];
    const match = urlLine.match(/https:\/\/[^\s]+/);

    if (match) {
      console.log(`[build-pipeline] Deployed to Vercel: ${match[0]}`);
      return match[0];
    }

    return null;
  } catch (err) {
    console.error('[build-pipeline] Vercel deploy failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Backup to Passport drive
 */
async function backupToPassport(buildPath: string, jobId: string): Promise<boolean> {
  if (!isPassportMounted()) {
    console.log('[build-pipeline] Passport drive not mounted, skipping backup');
    return false;
  }

  try {
    const backupPath = path.join(PASSPORT_PATH, `upwork-${jobId}`);
    await execAsync(`cp -r "${buildPath}" "${backupPath}"`);
    console.log(`[build-pipeline] Backed up to ${backupPath}`);
    return true;
  } catch (err) {
    console.error('[build-pipeline] Passport backup failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Update proposal in Supabase with demo URL and GitHub link
 */
async function updateProposalWithUrls(jobId: string, githubUrl: string | null, demoUrl: string | null): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = getSupabaseClient();

    // Get current proposal
    const { data: proposal } = await supabase
      .from('upwork_proposals')
      .select('proposal_text')
      .eq('job_id', jobId)
      .single();

    if (!proposal) return;

    // Prepend demo URLs to proposal
    const demoSection = [
      '🚀 I already built this for you. Here\'s a live demo:',
      demoUrl ? `Demo: ${demoUrl}` : null,
      githubUrl ? `Source: ${githubUrl}` : null,
      '',
      'If you approve, I can ship this today.',
      '',
      '---',
      '',
      proposal.proposal_text,
    ]
      .filter(Boolean)
      .join('\n');

    // Update proposal
    await supabase
      .from('upwork_proposals')
      .update({
        proposal_text: demoSection,
        demo_url: demoUrl,
        github_url: githubUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('job_id', jobId);

    console.log(`[build-pipeline] Updated proposal with URLs for job ${jobId}`);
  } catch (err) {
    console.error('[build-pipeline] Failed to update proposal:', err instanceof Error ? err.message : err);
  }
}

/**
 * Run full build pipeline for a job
 */
export async function runBuildPipeline(job: UpworkJob): Promise<BuildResult> {
  const jobId = job.job_id.replace(/[^a-zA-Z0-9-]/g, '-');
  const buildPath = path.join(BUILD_DIR, jobId);
  const logs: string[] = [`Starting build pipeline for job ${jobId}`];

  try {
    // 1. Spawn Claude Code agent to build
    logs.push('Step 1: Spawning build agent...');
    const buildResult = await spawnBuildAgent(job, buildPath);
    logs.push(...buildResult.logs);

    if (!buildResult.success) {
      return {
        success: false,
        jobId,
        buildPath,
        error: 'Build agent failed to complete project',
        logs,
      };
    }

    // 2. Push to GitHub
    logs.push('Step 2: Pushing to GitHub...');
    const githubUrl = await pushToGitHub(buildPath, jobId);
    if (githubUrl) logs.push(`GitHub: ${githubUrl}`);

    // 3. Deploy to Vercel
    logs.push('Step 3: Deploying to Vercel...');
    const demoUrl = await deployToVercel(buildPath);
    if (demoUrl) logs.push(`Demo: ${demoUrl}`);

    // 4. Backup to Passport
    logs.push('Step 4: Backing up to Passport drive...');
    const passportBackup = await backupToPassport(buildPath, jobId);

    // 5. Update proposal with URLs
    logs.push('Step 5: Updating proposal with demo URLs...');
    await updateProposalWithUrls(job.job_id, githubUrl, demoUrl);

    return {
      success: true,
      jobId,
      buildPath,
      githubUrl: githubUrl || undefined,
      demoUrl: demoUrl || undefined,
      passportBackup,
      logs,
    };
  } catch (err) {
    logs.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    return {
      success: false,
      jobId,
      buildPath,
      error: err instanceof Error ? err.message : String(err),
      logs,
    };
  }
}

/**
 * Check if a job is eligible for autonomous building
 * (score >= 70, no existing build)
 */
export async function isEligibleForAutoBuild(job: UpworkJob): Promise<boolean> {
  // Minimum score threshold for auto-building
  if (job.score < 70) return false;

  // Check if we already attempted a build
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('upwork_proposals')
        .select('demo_url, github_url')
        .eq('job_id', job.job_id)
        .single();

      // Skip if already has demo URL (build already attempted)
      if (data?.demo_url || data?.github_url) {
        return false;
      }
    } catch {
      // If query fails, proceed with build attempt
    }
  }

  return true;
}
