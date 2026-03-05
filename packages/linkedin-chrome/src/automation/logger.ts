const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
type Level = keyof typeof LEVELS;

const COLORS: Record<Level, string> = {
  DEBUG: '\x1b[90m',
  INFO:  '\x1b[36m',
  WARN:  '\x1b[33m',
  ERROR: '\x1b[31m',
};
const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';

const MIN_LEVEL: Level = (process.env['LI_LOG_LEVEL'] as Level) ?? 'INFO';

export function log(level: Level, module: string, msg: string, extra?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const color = COLORS[level];
  const extraStr = extra ? ' ' + JSON.stringify(extra) : '';
  process.stderr.write(`${color}${BOLD}[${level}]${RESET}${color} ${ts} [${module}] ${msg}${extraStr}${RESET}\n`);
}

export function logInfo (mod: string, msg: string, extra?: Record<string, unknown>) { log('INFO',  mod, msg, extra); }
export function logWarn (mod: string, msg: string, extra?: Record<string, unknown>) { log('WARN',  mod, msg, extra); }
export function logError(mod: string, msg: string, extra?: Record<string, unknown>) { log('ERROR', mod, msg, extra); }
export function logDebug(mod: string, msg: string, extra?: Record<string, unknown>) { log('DEBUG', mod, msg, extra); }

export function logTiming(mod: string, op: string, startMs: number, extra?: Record<string, unknown>): void {
  const ms = Date.now() - startMs;
  logInfo(mod, `${op} completed`, { ms, ...extra });
}

export function extractErrorCode(err: unknown): { code: string; message: string } {
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    if (e['code']) return { code: String(e['code']), message: String(e['message'] ?? '') };
  }
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('429') || lower.includes('rate limit'))        return { code: 'RATE_LIMITED',    message: msg };
  if (lower.includes('authwall') || lower.includes('login'))        return { code: 'SESSION_EXPIRED', message: msg };
  if (lower.includes('timeout') || lower.includes('timed out'))     return { code: 'TIMEOUT',         message: msg };
  if (lower.includes('not found') || lower.includes('404'))         return { code: 'NOT_FOUND',       message: msg };
  if (lower.includes('econnrefused') || lower.includes('enotfound')) return { code: 'SERVICE_DOWN',   message: msg };
  return { code: 'ERROR', message: msg };
}
