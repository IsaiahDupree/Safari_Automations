/**
 * Environment Configuration
 * Handles environment-specific configuration for server portability.
 */

export interface CRMConfig {
  supabase: {
    url: string;
    anonKey: string;
    serviceKey?: string;
  };
  rateLimits: {
    messagesPerHour: number;
    messagesPerDay: number;
    minDelayMs: number;
    maxDelayMs: number;
    activeHoursStart: number;
    activeHoursEnd: number;
  };
  scoring: {
    weights: {
      recency: number;
      resonance: number;
      needClarity: number;
      valueDelivered: number;
      reliability: number;
      consent: number;
    };
  };
}

const DEFAULT_CONFIG: CRMConfig = {
  supabase: {
    url: '',
    anonKey: '',
  },
  rateLimits: {
    messagesPerHour: 10,
    messagesPerDay: 30,
    minDelayMs: 60000,
    maxDelayMs: 300000,
    activeHoursStart: 9,
    activeHoursEnd: 21,
  },
  scoring: {
    weights: {
      recency: 0.20,
      resonance: 0.20,
      needClarity: 0.15,
      valueDelivered: 0.20,
      reliability: 0.15,
      consent: 0.10,
    },
  },
};

let currentConfig: CRMConfig = { ...DEFAULT_CONFIG };

/**
 * Load configuration from environment variables.
 */
export function loadConfigFromEnv(env: Record<string, string | undefined>): CRMConfig {
  currentConfig = {
    supabase: {
      url: env.SUPABASE_URL || env.CRM_SUPABASE_URL || DEFAULT_CONFIG.supabase.url,
      anonKey: env.SUPABASE_ANON_KEY || env.CRM_SUPABASE_ANON_KEY || DEFAULT_CONFIG.supabase.anonKey,
      serviceKey: env.SUPABASE_SERVICE_KEY || env.CRM_SUPABASE_SERVICE_KEY,
    },
    rateLimits: {
      messagesPerHour: parseInt(env.CRM_RATE_MESSAGES_PER_HOUR || '') || DEFAULT_CONFIG.rateLimits.messagesPerHour,
      messagesPerDay: parseInt(env.CRM_RATE_MESSAGES_PER_DAY || '') || DEFAULT_CONFIG.rateLimits.messagesPerDay,
      minDelayMs: parseInt(env.CRM_RATE_MIN_DELAY_MS || '') || DEFAULT_CONFIG.rateLimits.minDelayMs,
      maxDelayMs: parseInt(env.CRM_RATE_MAX_DELAY_MS || '') || DEFAULT_CONFIG.rateLimits.maxDelayMs,
      activeHoursStart: parseInt(env.CRM_ACTIVE_HOURS_START || '') || DEFAULT_CONFIG.rateLimits.activeHoursStart,
      activeHoursEnd: parseInt(env.CRM_ACTIVE_HOURS_END || '') || DEFAULT_CONFIG.rateLimits.activeHoursEnd,
    },
    scoring: {
      weights: {
        recency: parseFloat(env.CRM_SCORE_WEIGHT_RECENCY || '') || DEFAULT_CONFIG.scoring.weights.recency,
        resonance: parseFloat(env.CRM_SCORE_WEIGHT_RESONANCE || '') || DEFAULT_CONFIG.scoring.weights.resonance,
        needClarity: parseFloat(env.CRM_SCORE_WEIGHT_NEED_CLARITY || '') || DEFAULT_CONFIG.scoring.weights.needClarity,
        valueDelivered: parseFloat(env.CRM_SCORE_WEIGHT_VALUE || '') || DEFAULT_CONFIG.scoring.weights.valueDelivered,
        reliability: parseFloat(env.CRM_SCORE_WEIGHT_RELIABILITY || '') || DEFAULT_CONFIG.scoring.weights.reliability,
        consent: parseFloat(env.CRM_SCORE_WEIGHT_CONSENT || '') || DEFAULT_CONFIG.scoring.weights.consent,
      },
    },
  };
  
  return currentConfig;
}

/**
 * Set configuration directly.
 */
export function setConfig(config: Partial<CRMConfig>): CRMConfig {
  currentConfig = {
    ...currentConfig,
    ...config,
    supabase: { ...currentConfig.supabase, ...config.supabase },
    rateLimits: { ...currentConfig.rateLimits, ...config.rateLimits },
    scoring: {
      ...currentConfig.scoring,
      weights: { ...currentConfig.scoring.weights, ...config.scoring?.weights },
    },
  };
  return currentConfig;
}

/**
 * Get current configuration.
 */
export function getConfig(): CRMConfig {
  return { ...currentConfig };
}

/**
 * Reset to default configuration.
 */
export function resetConfig(): void {
  currentConfig = { ...DEFAULT_CONFIG };
}

/**
 * Validate configuration has required fields.
 */
export function validateConfig(config: CRMConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!config.supabase.url) {
    errors.push('Missing supabase.url');
  }
  if (!config.supabase.anonKey) {
    errors.push('Missing supabase.anonKey');
  }
  
  // Validate weights sum to ~1.0
  const weightsSum = Object.values(config.scoring.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(weightsSum - 1.0) > 0.01) {
    errors.push(`Scoring weights should sum to 1.0, got ${weightsSum.toFixed(2)}`);
  }
  
  return { valid: errors.length === 0, errors };
}
