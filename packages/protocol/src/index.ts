/**
 * Safari Manager Protocol
 * Control Plane + Telemetry Plane for external command and data exchange
 */

// Types
export * from './types';

// Event Emitter
export { TelemetryEmitter, telemetryEmitter } from './event-emitter';

// Command Handler
export {
  createCommand,
  getCommand,
  updateCommandStatus,
  cancelCommand,
  listCommands,
} from './command-handler';

// Servers
export { startControlServer, app as controlApp } from './control-server';
export { startTelemetryServer, broadcast } from './telemetry-server';
