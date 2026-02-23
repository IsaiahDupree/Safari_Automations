/**
 * Action Verifier
 * 
 * Executes verification checks and captures proof artifacts.
 */

import type { 
  ActionType, 
  ProofArtifact,
  SuccessCriteria,
  ActionRecord,
} from './types';
import { SUCCESS_CRITERIA, MIN_VERIFICATION_SCORE } from './types';
import { AuditLogger } from './audit-logger';

export interface VerifierConfig {
  screenshotOnEveryAction: boolean;
  domSnapshotOnEveryAction: boolean;
  strictMode: boolean; // Fail if any required proof missing
  retryOnFailure: boolean;
}

const DEFAULT_CONFIG: VerifierConfig = {
  screenshotOnEveryAction: true,
  domSnapshotOnEveryAction: false,
  strictMode: true,
  retryOnFailure: true,
};

export class ActionVerifier {
  private config: VerifierConfig;
  private auditLogger: AuditLogger;
  
  // Callbacks for actual Safari operations
  private takeScreenshot?: () => Promise<Buffer>;
  private executeJS?: (code: string) => Promise<string | null>;
  private getCurrentURL?: () => Promise<string>;

  /** Escape a string for safe interpolation inside single-quoted JS strings */
  private static escapeJS(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  }

  constructor(
    auditLogger: AuditLogger,
    config: Partial<VerifierConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.auditLogger = auditLogger;
  }

  /**
   * Set Safari operation callbacks
   */
  setCallbacks(callbacks: {
    takeScreenshot?: () => Promise<Buffer>;
    executeJS?: (code: string) => Promise<string | null>;
    getCurrentURL?: () => Promise<string>;
  }): void {
    this.takeScreenshot = callbacks.takeScreenshot;
    this.executeJS = callbacks.executeJS;
    this.getCurrentURL = callbacks.getCurrentURL;
  }

  /**
   * Verify an action with full proof capture
   */
  async verifyAction(
    actionId: string,
    actionType: ActionType,
    verificationChecks: VerificationCheck[]
  ): Promise<VerificationResult> {
    const criteria = SUCCESS_CRITERIA[actionType];
    const results: CheckResult[] = [];
    
    // Run each verification check
    for (const check of verificationChecks) {
      try {
        const result = await this.runCheck(actionId, check);
        results.push(result);
      } catch (error) {
        results.push({
          check,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        this.auditLogger.addError(actionId, 'verify', `Check failed: ${check.type}`);
      }
    }
    
    // Calculate overall result
    const passedRequired = results
      .filter(r => r.check.required)
      .every(r => r.passed);
    
    const passedCount = results.filter(r => r.passed).length;
    const totalCount = results.length;
    
    const score = totalCount > 0 
      ? Math.round((passedCount / totalCount) * 100) 
      : 0;
    
    const verified = passedRequired && score >= MIN_VERIFICATION_SCORE;
    
    return {
      verified,
      score,
      checks: results,
      summary: this.generateSummary(results),
    };
  }

  /**
   * Run a single verification check
   */
  private async runCheck(actionId: string, check: VerificationCheck): Promise<CheckResult> {
    switch (check.type) {
      case 'screenshot':
        return this.checkScreenshot(actionId, check);
      
      case 'element_exists':
        return this.checkElementExists(actionId, check);
      
      case 'element_visible':
        return this.checkElementVisible(actionId, check);
      
      case 'text_contains':
        return this.checkTextContains(actionId, check);
      
      case 'text_exact':
        return this.checkTextExact(actionId, check);
      
      case 'url_contains':
        return this.checkURLContains(actionId, check);
      
      case 'url_exact':
        return this.checkURLExact(actionId, check);
      
      case 'element_state_changed':
        return this.checkElementStateChanged(actionId, check);
      
      case 'custom':
        return this.checkCustom(actionId, check);
      
      default:
        return {
          check,
          passed: false,
          error: `Unknown check type: ${check.type}`,
        };
    }
  }

  /**
   * Screenshot verification
   */
  private async checkScreenshot(
    actionId: string, 
    check: VerificationCheck
  ): Promise<CheckResult> {
    if (!this.takeScreenshot) {
      return { check, passed: false, error: 'Screenshot callback not set' };
    }
    
    try {
      const imageData = await this.takeScreenshot();
      const proof = await this.auditLogger.addScreenshotProof(
        actionId,
        check.phase === 'before' ? 'screenshot_before' : 'screenshot_after',
        imageData
      );
      
      return {
        check,
        passed: proof.valid,
        proof,
      };
    } catch (error) {
      return {
        check,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if element exists
   */
  private async checkElementExists(
    actionId: string,
    check: VerificationCheck
  ): Promise<CheckResult> {
    if (!this.executeJS || !check.selector) {
      return { check, passed: false, error: 'JS callback or selector not set' };
    }
    
    const js = `
      (function() {
        var el = document.querySelector('${ActionVerifier.escapeJS(check.selector)}');
        return el ? 'found' : 'not_found';
      })();
    `;
    
    const result = await this.executeJS(js);
    const found = result === 'found';
    
    const proof = this.auditLogger.addElementProof(
      actionId,
      check.selector,
      found
    );
    
    return {
      check,
      passed: found,
      proof,
      details: { selector: check.selector, found },
    };
  }

  /**
   * Check if element is visible
   */
  private async checkElementVisible(
    actionId: string,
    check: VerificationCheck
  ): Promise<CheckResult> {
    if (!this.executeJS || !check.selector) {
      return { check, passed: false, error: 'JS callback or selector not set' };
    }
    
    const js = `
      (function() {
        var el = document.querySelector('${ActionVerifier.escapeJS(check.selector)}');
        if (!el) return JSON.stringify({ found: false, visible: false });
        
        var rect = el.getBoundingClientRect();
        var style = window.getComputedStyle(el);
        var visible = rect.width > 0 && rect.height > 0 && 
                      style.visibility !== 'hidden' && 
                      style.display !== 'none' &&
                      style.opacity !== '0';
        
        return JSON.stringify({ 
          found: true, 
          visible: visible,
          text: el.innerText?.substring(0, 100)
        });
      })();
    `;
    
    const result = await this.executeJS(js);
    let data = { found: false, visible: false, text: '' };
    
    try {
      if (result) data = JSON.parse(result);
    } catch {}
    
    const proof = this.auditLogger.addElementProof(
      actionId,
      check.selector,
      data.found,
      { visible: data.visible, text: data.text }
    );
    
    return {
      check,
      passed: data.visible,
      proof,
      details: data,
    };
  }

  /**
   * Check if text contains expected value
   */
  private async checkTextContains(
    actionId: string,
    check: VerificationCheck
  ): Promise<CheckResult> {
    if (!this.executeJS || !check.expected) {
      return { check, passed: false, error: 'JS callback or expected text not set' };
    }
    
    const selector = check.selector || 'body';
    const js = `
      (function() {
        var el = document.querySelector('${ActionVerifier.escapeJS(selector)}');
        return el ? el.innerText : '';
      })();
    `;
    
    const result = await this.executeJS(js);
    const actual = result || '';
    
    const proof = this.auditLogger.addTextMatchProof(
      actionId,
      check.expected,
      actual,
      false // contains match
    );
    
    return {
      check,
      passed: proof.valid,
      proof,
      details: { expected: check.expected, found: proof.valid },
    };
  }

  /**
   * Check if text exactly matches
   */
  private async checkTextExact(
    actionId: string,
    check: VerificationCheck
  ): Promise<CheckResult> {
    if (!this.executeJS || !check.expected || !check.selector) {
      return { check, passed: false, error: 'Missing required parameters' };
    }
    
    const js = `
      (function() {
        var el = document.querySelector('${ActionVerifier.escapeJS(check.selector!)}');
        return el ? el.innerText.trim() : '';
      })();
    `;
    
    const result = await this.executeJS(js);
    const actual = result || '';
    
    const proof = this.auditLogger.addTextMatchProof(
      actionId,
      check.expected,
      actual,
      true // exact match
    );
    
    return {
      check,
      passed: proof.valid,
      proof,
    };
  }

  /**
   * Check if URL contains expected value
   */
  private async checkURLContains(
    actionId: string,
    check: VerificationCheck
  ): Promise<CheckResult> {
    if (!this.getCurrentURL || !check.expected) {
      return { check, passed: false, error: 'URL callback or expected not set' };
    }
    
    const actual = await this.getCurrentURL();
    const proof = this.auditLogger.addURLProof(actionId, check.expected, actual);
    
    return {
      check,
      passed: proof.valid,
      proof,
    };
  }

  /**
   * Check if URL exactly matches
   */
  private async checkURLExact(
    actionId: string,
    check: VerificationCheck
  ): Promise<CheckResult> {
    if (!this.getCurrentURL || !check.expected) {
      return { check, passed: false, error: 'URL callback or expected not set' };
    }
    
    const actual = await this.getCurrentURL();
    const matches = actual === check.expected;
    
    const proof = this.auditLogger.addURLProof(actionId, check.expected, actual);
    
    return {
      check,
      passed: matches,
      proof,
    };
  }

  /**
   * Check if element state changed (e.g., like button -> unlike button)
   */
  private async checkElementStateChanged(
    actionId: string,
    check: VerificationCheck
  ): Promise<CheckResult> {
    if (!this.executeJS || !check.selector || !check.expectedState) {
      return { check, passed: false, error: 'Missing required parameters' };
    }
    
    const js = `
      (function() {
        var el = document.querySelector('${ActionVerifier.escapeJS(check.selector!)}');
        if (!el) return JSON.stringify({ found: false });
        
        var ariaLabel = el.getAttribute('aria-label') || '';
        var className = el.className || '';
        var dataState = el.getAttribute('data-state') || '';
        
        return JSON.stringify({
          found: true,
          ariaLabel: ariaLabel,
          className: className,
          dataState: dataState
        });
      })();
    `;
    
    const result = await this.executeJS(js);
    let data = { found: false, ariaLabel: '', className: '', dataState: '' };
    
    try {
      if (result) data = JSON.parse(result);
    } catch {}
    
    // Check if any indicator matches expected state
    const stateMatched = 
      data.ariaLabel.toLowerCase().includes(check.expectedState.toLowerCase()) ||
      data.className.toLowerCase().includes(check.expectedState.toLowerCase()) ||
      data.dataState.toLowerCase().includes(check.expectedState.toLowerCase());
    
    const proof = this.auditLogger.addElementProof(
      actionId,
      check.selector,
      data.found,
      { 
        visible: true, 
        attributes: { 
          'aria-label': data.ariaLabel,
          'data-state': data.dataState 
        } 
      }
    );
    
    return {
      check,
      passed: stateMatched,
      proof,
      details: { ...data, expectedState: check.expectedState, stateMatched },
    };
  }

  /**
   * Run custom verification function
   */
  private async checkCustom(
    actionId: string,
    check: VerificationCheck
  ): Promise<CheckResult> {
    if (!check.customValidator) {
      return { check, passed: false, error: 'Custom validator not provided' };
    }
    
    try {
      const result = await check.customValidator();
      return {
        check,
        passed: result.passed,
        details: result.details,
      };
    } catch (error) {
      return {
        check,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(results: CheckResult[]): string[] {
    return results.map(r => {
      const status = r.passed ? '✓' : '✗';
      const desc = r.check.description || r.check.type;
      const error = r.error ? ` (${r.error})` : '';
      return `${status} ${desc}${error}`;
    });
  }
}

export interface VerificationCheck {
  type: 
    | 'screenshot'
    | 'element_exists'
    | 'element_visible'
    | 'text_contains'
    | 'text_exact'
    | 'url_contains'
    | 'url_exact'
    | 'element_state_changed'
    | 'custom';
  description?: string;
  required: boolean;
  phase?: 'before' | 'after';
  selector?: string;
  expected?: string;
  expectedState?: string;
  customValidator?: () => Promise<{ passed: boolean; details?: unknown }>;
}

export interface CheckResult {
  check: VerificationCheck;
  passed: boolean;
  proof?: ProofArtifact;
  error?: string;
  details?: unknown;
}

export interface VerificationResult {
  verified: boolean;
  score: number;
  checks: CheckResult[];
  summary: string[];
}
