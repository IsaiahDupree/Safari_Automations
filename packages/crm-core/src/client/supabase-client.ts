/**
 * Supabase Client Factory
 * Creates a configured Supabase client that can be used across the CRM.
 * Supports both browser and server environments.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface CRMClientConfig {
  supabaseUrl: string;
  supabaseKey: string;
  options?: {
    autoRefreshToken?: boolean;
    persistSession?: boolean;
  };
}

let clientInstance: SupabaseClient | null = null;
let currentConfig: CRMClientConfig | null = null;

/**
 * Initialize the CRM client with Supabase credentials.
 * Call this once at application startup.
 */
export function initializeCRMClient(config: CRMClientConfig): SupabaseClient {
  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new Error('CRM Client requires supabaseUrl and supabaseKey');
  }

  clientInstance = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      autoRefreshToken: config.options?.autoRefreshToken ?? true,
      persistSession: config.options?.persistSession ?? false,
    },
  });

  currentConfig = config;
  return clientInstance;
}

/**
 * Get the initialized CRM client.
 * Throws if client hasn't been initialized.
 */
export function getCRMClient(): SupabaseClient {
  if (!clientInstance) {
    throw new Error('CRM Client not initialized. Call initializeCRMClient() first.');
  }
  return clientInstance;
}

/**
 * Check if the CRM client has been initialized.
 */
export function isClientInitialized(): boolean {
  return clientInstance !== null;
}

/**
 * Get the current configuration (without sensitive key).
 */
export function getClientConfig(): { url: string } | null {
  if (!currentConfig) return null;
  return { url: currentConfig.supabaseUrl };
}

/**
 * Reset the client (useful for testing).
 */
export function resetCRMClient(): void {
  clientInstance = null;
  currentConfig = null;
}
