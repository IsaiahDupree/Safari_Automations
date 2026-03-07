export { SafariDriver, getDefaultDriver } from './automation/safari-driver.js';
export { TabCoordinator } from './automation/tab-coordinator.js';
export { queue } from './automation/command-queue.js';
export {
  getSoraUsage,
  submitGeneration,
  waitForGeneration,
  downloadLatestVideo,
  removeWatermark,
  SORA_URL,
  SORA_PATTERN,
} from './automation/sora-operations.js';
export type {
  Command,
  CommandType,
  CommandStatus,
  CommandPayload,
  CommandResult,
  SoraUsage,
  TelemetryEvent,
} from './automation/types.js';
