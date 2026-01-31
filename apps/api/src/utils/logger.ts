/**
 * Simple logger for Safari Automation API
 */

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const levels: Record<string, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = levels[LOG_LEVEL] ?? 2;

function formatTime(): string {
  return new Date().toISOString().slice(11, 23);
}

export const logger = {
  error: (msg: string, ...args: any[]) => {
    if (currentLevel >= 0) {
      console.error(`[${formatTime()}] ❌ ${msg}`, ...args);
    }
  },
  warn: (msg: string, ...args: any[]) => {
    if (currentLevel >= 1) {
      console.warn(`[${formatTime()}] ⚠️ ${msg}`, ...args);
    }
  },
  info: (msg: string, ...args: any[]) => {
    if (currentLevel >= 2) {
      console.log(`[${formatTime()}] ℹ️ ${msg}`, ...args);
    }
  },
  debug: (msg: string, ...args: any[]) => {
    if (currentLevel >= 3) {
      console.log(`[${formatTime()}] 🔍 ${msg}`, ...args);
    }
  },
};
