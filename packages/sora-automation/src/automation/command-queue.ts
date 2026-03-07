/**
 * In-memory command queue for async Sora automation jobs.
 * Exposes: enqueue, get, list, cancel
 */

import { randomUUID } from 'crypto';
import type { Command, CommandType, CommandPayload, CommandResult } from './types.js';

class CommandQueue {
  private _commands = new Map<string, Command>();
  private _seq = 0;

  enqueue(type: CommandType, payload: CommandPayload): Command {
    const seq = ++this._seq;
    const cmd: Command = {
      id: randomUUID(),
      type,
      payload,
      status: 'PENDING',
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      _seq: seq,
    } as Command & { _seq: number };
    this._commands.set(cmd.id, cmd);
    return cmd;
  }

  get(id: string): Command | undefined {
    return this._commands.get(id);
  }

  list(): Command[] {
    return Array.from(this._commands.values()).sort((a, b) => {
      const tDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (tDiff !== 0) return tDiff;
      // Stable tiebreaker: higher seq = newer
      return ((b as Command & { _seq: number })._seq ?? 0) - ((a as Command & { _seq: number })._seq ?? 0);
    });
  }

  markRunning(id: string): void {
    const cmd = this._commands.get(id);
    if (cmd) { cmd.status = 'RUNNING'; cmd.startedAt = new Date().toISOString(); }
  }

  markSucceeded(id: string, result: CommandResult): void {
    const cmd = this._commands.get(id);
    if (cmd) { cmd.status = 'SUCCEEDED'; cmd.result = result; cmd.completedAt = new Date().toISOString(); }
  }

  markFailed(id: string, error: string): void {
    const cmd = this._commands.get(id);
    if (cmd) { cmd.status = 'FAILED'; cmd.error = error; cmd.completedAt = new Date().toISOString(); }
  }

  cancel(id: string): boolean {
    const cmd = this._commands.get(id);
    if (cmd && cmd.status === 'PENDING') {
      cmd.status = 'CANCELLED';
      cmd.completedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  /** Prune completed commands older than maxAgeMs (default 24h). */
  prune(maxAgeMs = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, cmd] of this._commands) {
      if (cmd.completedAt && new Date(cmd.completedAt).getTime() < cutoff) {
        this._commands.delete(id);
      }
    }
  }
}

export const queue = new CommandQueue();
