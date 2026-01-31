/**
 * Command Handler
 * Routes commands to appropriate handlers and manages command state
 */

import { v4 as uuidv4 } from 'uuid';
import {
  CommandEnvelope,
  CommandState,
  CommandStatus,
  CommandType,
  SoraGeneratePayload,
  SoraBatchPayload,
} from './types';
import { telemetryEmitter } from './event-emitter';

// In-memory command store (replace with DB for production)
const commands: Map<string, CommandState> = new Map();
const idempotencyKeys: Map<string, string> = new Map();

// Command queue
const commandQueue: CommandEnvelope[] = [];
let processing = false;

export function createCommand(envelope: Partial<CommandEnvelope>): CommandState {
  // Check idempotency
  if (envelope.idempotency_key) {
    const existingId = idempotencyKeys.get(envelope.idempotency_key);
    if (existingId) {
      const existing = commands.get(existingId);
      if (existing) {
        return existing;
      }
    }
  }

  const command_id = envelope.command_id || uuidv4();
  const now = new Date().toISOString();

  const command: CommandEnvelope = {
    version: '1.0',
    command_id,
    requested_at: now,
    type: envelope.type || 'flow.run',
    payload: envelope.payload || {},
    ...envelope,
  };

  const state: CommandState = {
    command_id,
    status: 'CREATED',
    created_at: now,
    updated_at: now,
  };

  commands.set(command_id, state);

  if (envelope.idempotency_key) {
    idempotencyKeys.set(envelope.idempotency_key, command_id);
  }

  // Queue for processing
  queueCommand(command);

  return state;
}

export function getCommand(command_id: string): CommandState | undefined {
  return commands.get(command_id);
}

export function updateCommandStatus(
  command_id: string,
  status: CommandStatus,
  result?: Record<string, unknown>,
  error?: string
): CommandState | undefined {
  const state = commands.get(command_id);
  if (!state) return undefined;

  state.status = status;
  state.updated_at = new Date().toISOString();

  if (status === 'RUNNING' && !state.started_at) {
    state.started_at = state.updated_at;
  }

  if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status)) {
    state.completed_at = state.updated_at;
  }

  if (result) state.result = result;
  if (error) state.error = error;

  // Emit status change event
  telemetryEmitter.emit('status.changed', {
    command_id,
    status,
    result,
    error,
  }, {
    severity: status === 'FAILED' ? 'error' : 'info',
    command_id,
  });

  return state;
}

export function cancelCommand(command_id: string): boolean {
  const state = commands.get(command_id);
  if (!state) return false;

  if (['CREATED', 'QUEUED', 'RUNNING'].includes(state.status)) {
    updateCommandStatus(command_id, 'CANCELLED');
    return true;
  }

  return false;
}

export function listCommands(filters?: {
  status?: CommandStatus;
  type?: CommandType;
  since?: string;
}): CommandState[] {
  let results = Array.from(commands.values());

  if (filters?.status) {
    results = results.filter((c) => c.status === filters.status);
  }

  if (filters?.since) {
    const sinceDate = new Date(filters.since);
    results = results.filter((c) => new Date(c.created_at) >= sinceDate);
  }

  return results.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

function queueCommand(command: CommandEnvelope): void {
  commandQueue.push(command);
  updateCommandStatus(command.command_id, 'QUEUED');
  processQueue();
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (commandQueue.length > 0) {
    const command = commandQueue.shift();
    if (!command) continue;

    try {
      await executeCommand(command);
    } catch (error) {
      updateCommandStatus(
        command.command_id,
        'FAILED',
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  processing = false;
}

async function executeCommand(command: CommandEnvelope): Promise<void> {
  updateCommandStatus(command.command_id, 'RUNNING');

  switch (command.type) {
    case 'sora.generate':
      await executeSoraGenerate(command);
      break;
    case 'sora.batch':
      await executeSoraBatch(command);
      break;
    case 'sora.usage':
      await executeSoraUsage(command);
      break;
    default:
      // Placeholder for other command types
      updateCommandStatus(command.command_id, 'SUCCEEDED', {
        message: `Command type ${command.type} executed (stub)`,
      });
  }
}

async function executeSoraGenerate(command: CommandEnvelope): Promise<void> {
  const payload = command.payload as unknown as SoraGeneratePayload;

  telemetryEmitter.emit('sora.prompt.submitted', {
    prompt: payload.prompt,
    character: payload.character || 'isaiahdupree',
  }, { command_id: command.command_id });

  try {
    // Dynamic import to avoid circular dependencies
    const { SoraFullAutomation } = await import('../../services/src/sora/sora-full-automation');
    const sora = new SoraFullAutomation();

    telemetryEmitter.emit('sora.polling.started', {}, { command_id: command.command_id });

    const result = await sora.fullRun(payload.prompt);

    if (result.download?.success) {
      telemetryEmitter.emit('sora.video.ready', {
        video_url: result.poll?.videoUrl,
      }, { command_id: command.command_id });

      telemetryEmitter.emit('sora.video.downloaded', {
        file_path: result.download.filePath,
        file_size: result.download.fileSize,
      }, { command_id: command.command_id });

      updateCommandStatus(command.command_id, 'SUCCEEDED', {
        video_path: result.download.filePath,
        file_size: result.download.fileSize,
        duration_ms: result.totalTimeMs,
      });
    } else {
      updateCommandStatus(command.command_id, 'FAILED', undefined,
        result.download?.error || result.poll?.error || result.submit.error || 'Unknown error'
      );
    }
  } catch (error) {
    updateCommandStatus(command.command_id, 'FAILED', undefined,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

async function executeSoraBatch(command: CommandEnvelope): Promise<void> {
  const payload = command.payload as unknown as SoraBatchPayload;
  const results: Array<{ prompt: string; success: boolean; path?: string; error?: string }> = [];

  try {
    const { SoraFullAutomation } = await import('../../services/src/sora/sora-full-automation');
    const sora = new SoraFullAutomation();

    for (const prompt of payload.prompts) {
      telemetryEmitter.emit('sora.prompt.submitted', {
        prompt,
        batch_index: results.length,
        batch_total: payload.prompts.length,
      }, { command_id: command.command_id });

      const result = await sora.fullRun(prompt);

      results.push({
        prompt: prompt.slice(0, 50) + '...',
        success: result.download?.success || false,
        path: result.download?.filePath,
        error: result.download?.error || result.poll?.error || result.submit.error,
      });

      // Wait between generations
      if (results.length < payload.prompts.length) {
        await new Promise((r) => setTimeout(r, 10000));
      }
    }

    const successCount = results.filter((r) => r.success).length;

    updateCommandStatus(command.command_id, 'SUCCEEDED', {
      total: payload.prompts.length,
      successful: successCount,
      failed: payload.prompts.length - successCount,
      results,
    });
  } catch (error) {
    updateCommandStatus(command.command_id, 'FAILED', { results },
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

async function executeSoraUsage(command: CommandEnvelope): Promise<void> {
  try {
    const { SoraFullAutomation } = await import('../../services/src/sora/sora-full-automation');
    const sora = new SoraFullAutomation();

    const usage = await sora.getUsage();

    telemetryEmitter.emit('sora.usage.checked', {
      video_gens_left: usage.videoGensLeft,
      free_count: usage.freeCount,
      paid_count: usage.paidCount,
      next_available_date: usage.nextAvailableDate,
    }, { command_id: command.command_id });

    if (usage.success) {
      updateCommandStatus(command.command_id, 'SUCCEEDED', {
        video_gens_left: usage.videoGensLeft,
        free_count: usage.freeCount,
        paid_count: usage.paidCount,
        next_available_date: usage.nextAvailableDate,
      });
    } else {
      updateCommandStatus(command.command_id, 'FAILED', undefined, usage.error);
    }
  } catch (error) {
    updateCommandStatus(command.command_id, 'FAILED', undefined,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}
