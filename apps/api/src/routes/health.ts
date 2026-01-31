/**
 * Health check routes
 */

import { logger } from '../utils/logger.js';

// Read env vars at request time (not import time) so .env is loaded
function getEnvVars() {
  return {
    MODAL_TOKEN_ID: process.env.MODAL_TOKEN_ID,
    MODAL_TOKEN_SECRET: process.env.MODAL_TOKEN_SECRET,
    REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  };
}

async function checkModalHealth(): Promise<boolean> {
  const env = getEnvVars();
  if (!env.MODAL_TOKEN_ID || !env.MODAL_TOKEN_SECRET) return false;
  
  try {
    const modalUrl = `https://isaiahdupree33--blanklogo-watermark-removal-health.modal.run`;
    const response = await fetch(modalUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${env.MODAL_TOKEN_ID}:${env.MODAL_TOKEN_SECRET}`,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function checkReplicateHealth(): Promise<boolean> {
  const env = getEnvVars();
  if (!env.REPLICATE_API_TOKEN) return false;
  
  try {
    const response = await fetch('https://api.replicate.com/v1/models', {
      headers: {
        'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function checkSupabaseHealth(): Promise<boolean> {
  const env = getEnvVars();
  if (!env.SUPABASE_URL) return false;
  
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
      headers: {
        'apikey': env.SUPABASE_ANON_KEY || '',
      },
    });
    return response.status !== 0;
  } catch {
    return false;
  }
}

export const healthRouter = {
  async health(req: any, res: any) {
    const [modal, replicate, supabase] = await Promise.all([
      checkModalHealth(),
      checkReplicateHealth(),
      checkSupabaseHealth(),
    ]);

    const env = getEnvVars();
    const status = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        modal,
        replicate,
        supabase,
      },
      config: {
        modal_configured: !!env.MODAL_TOKEN_ID,
        replicate_configured: !!env.REPLICATE_API_TOKEN,
        supabase_configured: !!env.SUPABASE_URL,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  },
};
