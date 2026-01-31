#!/bin/bash
# Start the Safari Automation API Server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
API_DIR="$PROJECT_ROOT/apps/api"

echo "🚀 Starting Safari Automation API Server"
echo ""

# Check for .env file
if [ ! -f "$PROJECT_ROOT/.env" ]; then
  echo "⚠️  No .env file found. Copying from .env.example..."
  cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
  echo "   Please configure your .env file with:"
  echo "   - MODAL_TOKEN_ID and MODAL_TOKEN_SECRET (for AI watermark removal)"
  echo "   - REPLICATE_API_TOKEN (for AI upscaling)"
  echo ""
fi

# Load environment variables
source "$PROJECT_ROOT/.env" 2>/dev/null || true

# Check dependencies
if ! command -v ffmpeg &> /dev/null; then
  echo "❌ ffmpeg not found. Please install: brew install ffmpeg"
  exit 1
fi

if ! command -v node &> /dev/null; then
  echo "❌ node not found. Please install Node.js 18+"
  exit 1
fi

# Check if node_modules exists
if [ ! -d "$API_DIR/node_modules" ]; then
  echo "📦 Installing dependencies..."
  cd "$API_DIR"
  npm install
fi

# Start the server
echo "🌐 Control Plane: http://localhost:${CONTROL_PORT:-7070}"
echo "📡 WebSocket:     ws://localhost:${TELEMETRY_PORT:-7071}"
echo ""
echo "Endpoints:"
echo "  POST /api/v1/video/process  - Submit video for HQ processing"
echo "  GET  /api/v1/jobs/{id}      - Check job status"
echo "  GET  /api/v1/jobs/{id}/download - Download processed video"
echo "  GET  /health                - Health check"
echo ""

cd "$API_DIR"
npx tsx src/index.ts
