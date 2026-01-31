/**
 * Logger utility for Safari Client
 */

export const logger = {
  info: (message: string, data?: Record<string, unknown>) => {
    console.log(`[INFO] ${message}`, data ?? '');
  },
  
  debug: (message: string, data?: Record<string, unknown>) => {
    console.debug(`[DEBUG] ${message}`, data ?? '');
  },
  
  warn: (message: string, data?: Record<string, unknown>) => {
    console.warn(`[WARN] ${message}`, data ?? '');
  },
  
  error: (message: string, data?: unknown) => {
    console.error(`[ERROR] ${message}`, data ?? '');
  },
  
  success: (message: string, data?: Record<string, unknown>) => {
    console.log(`[SUCCESS] ${message}`, data ?? '');
  },
};
