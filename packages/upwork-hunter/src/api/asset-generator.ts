/**
 * Preliminary Asset Generator
 *
 * Triggered when a human approves an Upwork proposal.
 * Generates a starter kit for the client project:
 *   - Folder structure
 *   - README.md with project brief, scope, and milestones
 *   - Initial code scaffold (TypeScript/Python based on job type)
 *   - .env.example
 *   - NOTES.md (pre-filled from proposal + job description)
 *
 * Saves to:
 *   1. /Volumes/My Passport/Coding_backup/Coding/clients/<slug>/
 *   2. Local backup: /tmp/upwork-assets/<slug>/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';

const PASSPORT_ROOT = '/Volumes/My Passport/Coding_backup/Coding/clients';
const LOCAL_BACKUP   = '/tmp/upwork-assets';

export interface AssetGeneratorInput {
  jobId: string;
  jobTitle: string;
  jobUrl: string;
  jobDescription: string;
  budget: string;
  proposalText: string;
  score: number;
}

export interface AssetGeneratorResult {
  success: boolean;
  slug: string;
  passportPath: string | null;
  localPath: string;
  filesCreated: string[];
  error?: string;
}

// ─── Slug from job title ──────────────────────────────────────────────────────

function slugify(title: string, jobId: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const short = jobId.slice(0, 6);
  return `${base}-${short}`;
}

// ─── Project type detection ───────────────────────────────────────────────────

type ProjectType = 'n8n' | 'python-automation' | 'typescript-api' | 'claude-api' | 'generic';

function detectProjectType(desc: string): ProjectType {
  const t = desc.toLowerCase();
  if (t.includes('n8n') || t.includes('zapier') || t.includes('make.com')) return 'n8n';
  if (t.includes('claude') || t.includes('openai') || t.includes('anthropic') || t.includes('llm')) return 'claude-api';
  if (t.includes('python') || t.includes('scraping') || t.includes('browser automation')) return 'python-automation';
  if (t.includes('api') || t.includes('typescript') || t.includes('node')) return 'typescript-api';
  return 'generic';
}

// ─── Claude-generated README ──────────────────────────────────────────────────

async function generateReadme(input: AssetGeneratorInput, projectType: ProjectType): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are a freelance AI automation consultant. Generate a professional project README.md for a client project.

Job Title: ${input.jobTitle}
Budget: ${input.budget}
Project Type: ${projectType}

Job Description (excerpt):
${input.jobDescription.slice(0, 1000)}

My Proposal (excerpt):
${input.proposalText.slice(0, 800)}

Generate a README.md with these sections:
1. # Project: [title] — one-line description
2. ## Client Brief — 2-3 sentences summarizing what client needs
3. ## Scope of Work — bullet list of 4-6 deliverables based on proposal
4. ## Technical Stack — tools/languages based on project type
5. ## Milestones — 3-4 milestones with estimated days (total ≤ 14 days)
6. ## Setup Instructions — placeholder steps for the stack
7. ## Notes — any open questions or assumptions

Keep it concise, professional, client-facing. Use markdown formatting.`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });

  return (message.content[0] as { type: string; text: string }).text;
}

// ─── Scaffold files by project type ──────────────────────────────────────────

function getScaffoldFiles(projectType: ProjectType, slug: string): Record<string, string> {
  const files: Record<string, string> = {};

  if (projectType === 'claude-api' || projectType === 'typescript-api') {
    files['src/index.ts'] = `import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function main() {
  // TODO: implement main workflow
  console.log('[${slug}] Starting...');
}

main().catch(console.error);
`;
    files['package.json'] = JSON.stringify({
      name: slug,
      version: '0.1.0',
      type: 'module',
      scripts: { start: 'tsx src/index.ts', build: 'tsc' },
      dependencies: { '@anthropic-ai/sdk': '^0.39.0', 'dotenv': '^16.0.0' },
      devDependencies: { 'tsx': '^4.0.0', 'typescript': '^5.0.0' },
    }, null, 2);
    files['tsconfig.json'] = JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
        outDir: 'dist', strict: true, esModuleInterop: true,
      },
      include: ['src/**/*'],
    }, null, 2);
    files['.env.example'] = 'ANTHROPIC_API_KEY=\nSUPABASE_URL=\nSUPABASE_KEY=\n';

  } else if (projectType === 'python-automation') {
    files['main.py'] = `"""${slug} — main entry point"""
import os
from dotenv import load_dotenv

load_dotenv()

def main():
    # TODO: implement main workflow
    print(f"[${slug}] Starting...")

if __name__ == "__main__":
    main()
`;
    files['requirements.txt'] = 'anthropic\npython-dotenv\nrequests\nbeautifulsoup4\nplaywright\n';
    files['.env.example'] = 'ANTHROPIC_API_KEY=\nSUPABASE_URL=\nSUPABASE_KEY=\n';

  } else if (projectType === 'n8n') {
    files['workflow-spec.md'] = `# N8n Workflow Specification

## Trigger
- [ ] Webhook / Schedule / Manual

## Steps
1. [ ] Input collection
2. [ ] Data transformation
3. [ ] AI processing (Claude/OpenAI node)
4. [ ] Output delivery (Email / Slack / CRM)

## Credentials Needed
- [ ] HTTP Header Auth
- [ ] API keys (fill in)

## Test Cases
- Happy path: ...
- Error path: ...
`;
    files['.env.example'] = 'N8N_URL=http://localhost:5678\nN8N_API_KEY=\n';

  } else {
    files['main.py'] = `"""${slug} — starter"""
def main():
    print("TODO: implement")
if __name__ == "__main__":
    main()
`;
    files['.env.example'] = 'ANTHROPIC_API_KEY=\n';
  }

  return files;
}

// ─── Write all files ──────────────────────────────────────────────────────────

function writeFiles(rootDir: string, files: Record<string, string>): string[] {
  const created: string[] = [];
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(rootDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    created.push(relPath);
  }
  return created;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateClientAssets(input: AssetGeneratorInput): Promise<AssetGeneratorResult> {
  const slug = slugify(input.jobTitle, input.jobId);
  const localDir = path.join(LOCAL_BACKUP, slug);
  const result: AssetGeneratorResult = {
    success: false,
    slug,
    passportPath: null,
    localPath: localDir,
    filesCreated: [],
  };

  try {
    const projectType = detectProjectType(input.jobDescription);
    console.log(`[asset-generator] Project type: ${projectType} | Slug: ${slug}`);

    // 1. Generate README via Claude Haiku
    let readme = '';
    try {
      readme = await generateReadme(input, projectType);
    } catch (e) {
      // Fallback README if Claude unavailable
      readme = `# ${input.jobTitle}\n\n**Budget:** ${input.budget}\n**Score:** ${input.score}/100\n**Job URL:** ${input.jobUrl}\n\n## Description\n${input.jobDescription.slice(0, 500)}\n\n## Proposal\n${input.proposalText.slice(0, 500)}\n`;
    }

    // 2. Build NOTES.md
    const notes = `# Project Notes — ${input.jobTitle}

**Approved:** ${new Date().toISOString().slice(0, 10)}
**Job URL:** ${input.jobUrl}
**Score:** ${input.score}/100
**Budget:** ${input.budget}

## Open Questions
- [ ] Confirm exact deliverables with client
- [ ] Clarify timeline expectations
- [ ] Confirm preferred communication channel

## Key Points from Description
${input.jobDescription.slice(0, 1200)}

## Proposal Sent
${input.proposalText.slice(0, 1200)}
`;

    // 3. Scaffold files
    const scaffoldFiles = getScaffoldFiles(projectType, slug);
    const allFiles: Record<string, string> = {
      'README.md': readme,
      'NOTES.md': notes,
      ...scaffoldFiles,
    };

    // 4. Write to local backup (always)
    fs.mkdirSync(localDir, { recursive: true });
    result.filesCreated = writeFiles(localDir, allFiles);
    console.log(`[asset-generator] Written to local: ${localDir} (${result.filesCreated.length} files)`);

    // 5. Write to Passport drive (if mounted)
    const passportDir = path.join(PASSPORT_ROOT, slug);
    const passportMounted = fs.existsSync('/Volumes/My Passport');
    if (passportMounted) {
      try {
        fs.mkdirSync(passportDir, { recursive: true });
        writeFiles(passportDir, allFiles);
        result.passportPath = passportDir;
        console.log(`[asset-generator] Written to Passport: ${passportDir}`);
      } catch (e) {
        console.warn(`[asset-generator] Passport write failed: ${(e as Error).message}`);
      }
    } else {
      console.warn('[asset-generator] Passport drive not mounted — skipping Passport write');
    }

    result.success = true;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error('[asset-generator] Failed:', result.error);
    return result;
  }
}
