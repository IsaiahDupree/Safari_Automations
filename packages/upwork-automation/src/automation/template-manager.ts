/**
 * Proposal Template Manager
 * In-memory + file-backed template storage for Upwork proposals
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ProposalTemplate {
  id: string;
  name: string;
  category: string;
  template: string;
  tone: 'professional' | 'friendly' | 'technical';
  createdAt: string;
  updatedAt: string;
}

const TEMPLATES_DIR = join(homedir(), '.upwork-automation');
const TEMPLATES_FILE = join(TEMPLATES_DIR, 'templates.json');

// In-memory store
let templates: ProposalTemplate[] = [];

// Initialize template storage
function init(): void {
  if (!existsSync(TEMPLATES_DIR)) {
    mkdirSync(TEMPLATES_DIR, { recursive: true });
  }

  if (existsSync(TEMPLATES_FILE)) {
    try {
      const data = readFileSync(TEMPLATES_FILE, 'utf-8');
      templates = JSON.parse(data);
    } catch (err) {
      console.error('[Templates] Failed to load templates:', err);
      templates = [];
    }
  }
}

// Persist templates to disk
function persist(): void {
  try {
    writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Templates] Failed to persist templates:', err);
  }
}

// Get all templates
export function listTemplates(): ProposalTemplate[] {
  if (templates.length === 0) init();
  return templates;
}

// Get template by ID
export function getTemplateById(id: string): ProposalTemplate | null {
  if (templates.length === 0) init();
  return templates.find(t => t.id === id) || null;
}

// Create new template
export function createTemplate(
  name: string,
  category: string,
  template: string,
  tone: 'professional' | 'friendly' | 'technical'
): ProposalTemplate {
  if (templates.length === 0) init();

  const newTemplate: ProposalTemplate = {
    id: `tpl_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    name,
    category,
    template,
    tone,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  templates.push(newTemplate);
  persist();

  return newTemplate;
}

// Delete template by ID
export function deleteTemplate(id: string): boolean {
  if (templates.length === 0) init();

  const index = templates.findIndex(t => t.id === id);
  if (index === -1) return false;

  templates.splice(index, 1);
  persist();

  return true;
}

// Initialize on module load
init();
