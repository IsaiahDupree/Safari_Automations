/**
 * CRM Core Library
 * 
 * Modular, platform-agnostic CRM components for relationship-first sales.
 * Can be used with any server or database backend.
 * 
 * @example
 * ```typescript
 * import { initializeCRMClient, calculateRelationshipScore, generateReplySuggestions } from '@safari-automation/crm-core';
 * 
 * // Initialize client
 * initializeCRMClient({ supabaseUrl: '...', supabaseKey: '...' });
 * 
 * // Calculate score
 * const score = calculateRelationshipScore({ contact, messages });
 * 
 * // Get reply suggestions
 * const suggestions = generateReplySuggestions({ contact, messages, templates });
 * ```
 */

// Client
export {
  initializeCRMClient,
  getCRMClient,
  isClientInitialized,
  getClientConfig,
  resetCRMClient,
  type CRMClientConfig,
} from './client/index.js';

// Models / Types
export * from './models/index.js';

// Engines
export {
  // Scoring
  calculateRelationshipScore,
  calculateRecencyScore,
  calculateResonanceScore,
  calculateNeedClarityScore,
  calculateValueDeliveredScore,
  calculateReliabilityScore,
  calculateConsentScore,
  determineActionLane,
  getScoreTier,
  type ScoringInput,
} from './engines/scoring-engine.js';

export {
  // Coaching
  analyzeConversation,
  applyRule,
  averageScore,
  analyzePacing,
  analyzeResponseRatio,
  analyzeQuestions,
  generateNextActionSuggestion,
  getDefaultCoachingRules,
  type CoachingInput,
} from './engines/coaching-engine.js';

export {
  // Copilot
  generateReplySuggestions,
  analyzeConversationContext,
  detectSentiment,
  detectTopic,
  getLanePriority,
  calculateTemplatePriority,
  personalizeTemplate,
  detectFitOpportunity,
  getDefaultTemplates,
  type CopilotInput,
} from './engines/copilot-engine.js';

// Utils / Config
export {
  loadConfigFromEnv,
  setConfig,
  getConfig,
  resetConfig,
  validateConfig,
  type CRMConfig,
} from './utils/index.js';
