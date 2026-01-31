/**
 * Verification & Audit System
 * 
 * Provides verifiable proof of all automation actions.
 */

export { AuditLogger } from './audit-logger';
export type { VerificationReport } from './audit-logger';

export { ActionVerifier } from './verifier';
export type { 
  VerifierConfig, 
  VerificationCheck, 
  CheckResult, 
  VerificationResult 
} from './verifier';

export type {
  ActionType,
  ActionRecord,
  ActionTarget,
  ActionResult,
  ActionError,
  ProofArtifact,
  ProofType,
  VerificationStatus,
  SuccessCriteria,
  CriteriaItem,
} from './types';

export { 
  SUCCESS_CRITERIA, 
  MIN_VERIFICATION_SCORE,
  PROOF_STORAGE 
} from './types';
