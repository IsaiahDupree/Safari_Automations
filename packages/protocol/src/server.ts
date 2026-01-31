/**
 * Safari Manager Protocol Server
 * Starts both Control Plane (HTTP) and Telemetry Plane (WebSocket)
 */

import { startControlServer } from './control-server';
import { startTelemetryServer } from './telemetry-server';

const CONTROL_PORT = parseInt(process.env.CONTROL_PORT || '7070', 10);
const TELEMETRY_PORT = parseInt(process.env.TELEMETRY_PORT || '7071', 10);

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║   SAFARI MANAGER PROTOCOL SERVER                       ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

// Start Control Plane
startControlServer(CONTROL_PORT);

// Start Telemetry Plane
startTelemetryServer(TELEMETRY_PORT);

console.log('\n[SERVER] Both planes started successfully');
console.log(`[SERVER] Control API: http://localhost:${CONTROL_PORT}`);
console.log(`[SERVER] Telemetry WS: ws://localhost:${TELEMETRY_PORT}`);
console.log('\n[SERVER] Example commands:');
console.log(`  curl http://localhost:${CONTROL_PORT}/health`);
console.log(`  curl http://localhost:${CONTROL_PORT}/v1/sora/usage`);
console.log(`  curl -X POST http://localhost:${CONTROL_PORT}/v1/commands -H "Content-Type: application/json" -d '{"type":"sora.usage"}'`);
