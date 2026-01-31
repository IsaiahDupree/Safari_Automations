/**
 * Audit Logger
 * 
 * Captures and stores verifiable proof of all automation actions.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  ActionType,
  ActionRecord,
  ActionTarget,
  ActionResult,
  ActionError,
  ProofArtifact,
  ProofType,
  VerificationStatus,
  ScreenshotProof,
  ElementProof,
  TextMatchProof,
  URLMatchProof,
  TimestampProof,
  DOMSnapshotProof,
} from './types';
import { PROOF_STORAGE, MIN_VERIFICATION_SCORE, SUCCESS_CRITERIA } from './types';

export class AuditLogger {
  private baseDir: string;
  private records: Map<string, ActionRecord> = new Map();
  
  constructor(baseDir: string = PROOF_STORAGE.baseDir) {
    this.baseDir = baseDir;
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.baseDir,
      path.join(this.baseDir, PROOF_STORAGE.screenshots),
      path.join(this.baseDir, PROOF_STORAGE.dom),
      path.join(this.baseDir, PROOF_STORAGE.logs),
    ];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Start tracking a new action
   */
  startAction(
    actionType: ActionType,
    platform: string,
    target: ActionTarget,
    input: Record<string, unknown> = {}
  ): string {
    const id = this.generateId(actionType);
    
    const record: ActionRecord = {
      id,
      actionType,
      platform,
      target,
      status: 'pending',
      requestedAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      verifiedAt: null,
      input,
      proofs: [],
      result: null,
      verificationScore: 0,
      verificationNotes: [],
      errors: [],
      retryCount: 0,
    };
    
    this.records.set(id, record);
    this.log(id, `Action started: ${actionType} on ${platform}`);
    
    return id;
  }

  /**
   * Add a screenshot proof
   */
  async addScreenshotProof(
    actionId: string,
    type: 'screenshot_before' | 'screenshot_after',
    imageData: Buffer
  ): Promise<ProofArtifact> {
    const record = this.getRecord(actionId);
    const timestamp = new Date();
    const filename = `${actionId}_${type}_${timestamp.getTime()}.png`;
    const filepath = path.join(this.baseDir, PROOF_STORAGE.screenshots, filename);
    
    // Save screenshot
    fs.writeFileSync(filepath, imageData);
    
    // Calculate hash for integrity
    const hash = crypto.createHash('sha256').update(imageData).digest('hex');
    
    const proof: ProofArtifact = {
      type,
      timestamp,
      data: {
        type: 'screenshot',
        filepath,
        hash,
        dimensions: { width: 0, height: 0 }, // Would be extracted from image
        fileSize: imageData.length,
      } as ScreenshotProof,
      valid: true,
    };
    
    record.proofs.push(proof);
    this.log(actionId, `Screenshot captured: ${type} (${hash.substring(0, 8)}...)`);
    
    return proof;
  }

  /**
   * Add element found proof
   */
  addElementProof(
    actionId: string,
    selector: string,
    found: boolean,
    details: Partial<ElementProof> = {}
  ): ProofArtifact {
    const record = this.getRecord(actionId);
    
    const proof: ProofArtifact = {
      type: 'element_found',
      timestamp: new Date(),
      data: {
        type: 'element',
        selector,
        found,
        visible: details.visible ?? found,
        enabled: details.enabled ?? found,
        text: details.text,
        attributes: details.attributes,
      } as ElementProof,
      valid: found,
      validationError: found ? undefined : `Element not found: ${selector}`,
    };
    
    record.proofs.push(proof);
    this.log(actionId, `Element check: ${selector} - ${found ? 'FOUND' : 'NOT FOUND'}`);
    
    return proof;
  }

  /**
   * Add text match proof
   */
  addTextMatchProof(
    actionId: string,
    expected: string,
    actual: string,
    exactMatch: boolean = false
  ): ProofArtifact {
    const record = this.getRecord(actionId);
    
    const contains = actual.includes(expected);
    const exact = actual === expected;
    const matches = exactMatch ? exact : contains;
    
    const proof: ProofArtifact = {
      type: 'text_match',
      timestamp: new Date(),
      data: {
        type: 'text_match',
        expected,
        actual: actual.substring(0, 500), // Truncate for storage
        contains,
        exact,
      } as TextMatchProof,
      valid: matches,
      validationError: matches ? undefined : `Text not found: "${expected.substring(0, 50)}..."`,
    };
    
    record.proofs.push(proof);
    this.log(actionId, `Text match: ${matches ? 'VERIFIED' : 'FAILED'}`);
    
    return proof;
  }

  /**
   * Add URL match proof
   */
  addURLProof(
    actionId: string,
    expected: string,
    actual: string
  ): ProofArtifact {
    const record = this.getRecord(actionId);
    
    const matches = actual.includes(expected) || expected.includes(actual);
    
    const proof: ProofArtifact = {
      type: 'url_match',
      timestamp: new Date(),
      data: {
        type: 'url_match',
        expected,
        actual,
        matches,
      } as URLMatchProof,
      valid: matches,
      validationError: matches ? undefined : `URL mismatch: expected ${expected}, got ${actual}`,
    };
    
    record.proofs.push(proof);
    this.log(actionId, `URL check: ${matches ? 'MATCH' : 'MISMATCH'}`);
    
    return proof;
  }

  /**
   * Add DOM snapshot proof
   */
  addDOMProof(
    actionId: string,
    selector: string,
    html: string,
    elementCount: number
  ): ProofArtifact {
    const record = this.getRecord(actionId);
    const timestamp = new Date();
    
    // Save DOM snapshot to file
    const filename = `${actionId}_dom_${timestamp.getTime()}.html`;
    const filepath = path.join(this.baseDir, PROOF_STORAGE.dom, filename);
    fs.writeFileSync(filepath, html);
    
    const proof: ProofArtifact = {
      type: 'dom_snapshot',
      timestamp,
      data: {
        type: 'dom_snapshot',
        html: filepath, // Store path instead of full HTML
        selector,
        elementCount,
      } as DOMSnapshotProof,
      valid: elementCount > 0,
    };
    
    record.proofs.push(proof);
    this.log(actionId, `DOM snapshot: ${elementCount} elements matching ${selector}`);
    
    return proof;
  }

  /**
   * Record an error
   */
  addError(
    actionId: string,
    phase: 'pre' | 'execute' | 'verify' | 'post',
    message: string,
    code?: string,
    screenshot?: string
  ): void {
    const record = this.getRecord(actionId);
    
    const error: ActionError = {
      timestamp: new Date(),
      phase,
      message,
      code,
      screenshot,
    };
    
    record.errors.push(error);
    this.log(actionId, `ERROR [${phase}]: ${message}`);
  }

  /**
   * Complete an action and calculate verification score
   */
  completeAction(
    actionId: string,
    result: ActionResult
  ): ActionRecord {
    const record = this.getRecord(actionId);
    
    record.completedAt = new Date();
    record.result = result;
    
    // Add timestamp proof
    const timestampProof: ProofArtifact = {
      type: 'timestamp',
      timestamp: new Date(),
      data: {
        type: 'timestamp',
        action: record.actionType,
        startTime: record.startedAt!,
        endTime: record.completedAt,
        durationMs: record.completedAt.getTime() - record.startedAt!.getTime(),
      } as TimestampProof,
      valid: true,
    };
    record.proofs.push(timestampProof);
    
    // Calculate verification score
    const { score, notes, status } = this.calculateVerificationScore(record);
    record.verificationScore = score;
    record.verificationNotes = notes;
    record.status = status;
    record.verifiedAt = new Date();
    
    // Save to disk
    this.saveRecord(record);
    
    this.log(actionId, `Action completed: ${status} (score: ${score})`);
    
    return record;
  }

  /**
   * Calculate verification score based on proofs
   */
  private calculateVerificationScore(record: ActionRecord): {
    score: number;
    notes: string[];
    status: VerificationStatus;
  } {
    const criteria = SUCCESS_CRITERIA[record.actionType];
    if (!criteria) {
      return { score: 0, notes: ['No criteria defined'], status: 'failed' };
    }
    
    const notes: string[] = [];
    let totalScore = 0;
    let possibleScore = 0;
    
    for (const criterion of criteria.required) {
      possibleScore += criterion.weight;
      
      // Find matching proof
      const proof = record.proofs.find(p => p.type === criterion.type);
      
      if (proof && proof.valid) {
        totalScore += criterion.weight;
        notes.push(`✓ ${criterion.description}`);
      } else if (proof && !proof.valid) {
        notes.push(`✗ ${criterion.description}: ${proof.validationError || 'Invalid'}`);
      } else {
        notes.push(`✗ ${criterion.description}: No proof captured`);
      }
    }
    
    // Calculate percentage
    const score = possibleScore > 0 ? Math.round((totalScore / possibleScore) * 100) : 0;
    
    // Determine status
    let status: VerificationStatus;
    if (score >= MIN_VERIFICATION_SCORE && record.result?.success) {
      status = 'verified';
    } else if (score >= 50) {
      status = 'manual_review';
    } else {
      status = 'failed';
    }
    
    // Check for errors
    if (record.errors.length > 0) {
      notes.push(`⚠ ${record.errors.length} error(s) during execution`);
      if (status === 'verified') {
        status = 'manual_review';
      }
    }
    
    return { score, notes, status };
  }

  /**
   * Save record to disk
   */
  private saveRecord(record: ActionRecord): void {
    const date = new Date().toISOString().split('T')[0];
    const filename = `${date}_${record.id}.json`;
    const filepath = path.join(this.baseDir, PROOF_STORAGE.logs, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(record, null, 2));
  }

  /**
   * Load records from disk
   */
  loadRecords(date?: string): ActionRecord[] {
    const logsDir = path.join(this.baseDir, PROOF_STORAGE.logs);
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.json'));
    
    const records: ActionRecord[] = [];
    for (const file of files) {
      if (date && !file.startsWith(date)) continue;
      
      const content = fs.readFileSync(path.join(logsDir, file), 'utf-8');
      records.push(JSON.parse(content));
    }
    
    return records.sort((a, b) => 
      new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );
  }

  /**
   * Get verification report
   */
  getReport(startDate?: Date, endDate?: Date): VerificationReport {
    const records = Array.from(this.records.values());
    
    const filtered = records.filter(r => {
      if (startDate && new Date(r.requestedAt) < startDate) return false;
      if (endDate && new Date(r.requestedAt) > endDate) return false;
      return true;
    });
    
    const byStatus: Record<VerificationStatus, number> = {
      pending: 0,
      verified: 0,
      failed: 0,
      timeout: 0,
      manual_review: 0,
    };
    
    const byPlatform: Record<string, { total: number; verified: number }> = {};
    const byAction: Record<ActionType, { total: number; verified: number; avgScore: number }> = {} as any;
    
    let totalScore = 0;
    
    for (const record of filtered) {
      byStatus[record.status]++;
      totalScore += record.verificationScore;
      
      // By platform
      if (!byPlatform[record.platform]) {
        byPlatform[record.platform] = { total: 0, verified: 0 };
      }
      byPlatform[record.platform].total++;
      if (record.status === 'verified') {
        byPlatform[record.platform].verified++;
      }
      
      // By action
      if (!byAction[record.actionType]) {
        byAction[record.actionType] = { total: 0, verified: 0, avgScore: 0 };
      }
      byAction[record.actionType].total++;
      if (record.status === 'verified') {
        byAction[record.actionType].verified++;
      }
    }
    
    // Calculate averages
    for (const action of Object.keys(byAction) as ActionType[]) {
      const actionRecords = filtered.filter(r => r.actionType === action);
      const sum = actionRecords.reduce((s, r) => s + r.verificationScore, 0);
      byAction[action].avgScore = actionRecords.length > 0 
        ? Math.round(sum / actionRecords.length) 
        : 0;
    }
    
    return {
      period: {
        start: startDate || new Date(0),
        end: endDate || new Date(),
      },
      summary: {
        total: filtered.length,
        verified: byStatus.verified,
        failed: byStatus.failed,
        pendingReview: byStatus.manual_review,
        verificationRate: filtered.length > 0 
          ? Math.round((byStatus.verified / filtered.length) * 100) 
          : 0,
        avgScore: filtered.length > 0 
          ? Math.round(totalScore / filtered.length) 
          : 0,
      },
      byStatus,
      byPlatform,
      byAction,
    };
  }

  /**
   * Get a specific record
   */
  getRecord(actionId: string): ActionRecord {
    const record = this.records.get(actionId);
    if (!record) {
      throw new Error(`Action record not found: ${actionId}`);
    }
    return record;
  }

  /**
   * Generate unique action ID
   */
  private generateId(actionType: ActionType): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${actionType}_${timestamp}_${random}`;
  }

  /**
   * Internal logging
   */
  private log(actionId: string, message: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[AUDIT ${actionId}] ${timestamp}: ${message}`);
  }
}

export interface VerificationReport {
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    total: number;
    verified: number;
    failed: number;
    pendingReview: number;
    verificationRate: number;
    avgScore: number;
  };
  byStatus: Record<VerificationStatus, number>;
  byPlatform: Record<string, { total: number; verified: number }>;
  byAction: Record<ActionType, { total: number; verified: number; avgScore: number }>;
}
