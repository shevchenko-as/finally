#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
IMAGE_NAME="finally"
CONTAINER_NAME="finally"
VOLUME_NAME="finally-data"
PORT=8000

cd "$PROJECT_DIR"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop and try again."
  exit 1
fi

# Create .env from .env.example if not present
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo "⚠️  .env file not found. Created from .env.example."
    echo "   Please edit .env and set your OPENROUTER_API_KEY before continuing."
    echo ""
  else
    echo "❌ Neither .env nor .env.example found. Cannot start."
    exit 1
  fi
fi

# Determine if we need to build
FORCE_BUILD=false
for arg in "$@"; do
  if [ "$arg" = "--build" ]; then
    FORCE_BUILD=true
  fi
done

IMAGE_EXISTS=false
if docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  IMAGE_EXISTS=true
fi

if [ "$FORCE_BUILD" = true ] || [ "$IMAGE_EXISTS" = false ]; then
  echo "🔨 Building Docker image..."
  docker build -t "$IMAGE_NAME" .
  echo "✅ Image built."
fi

# Stop and remove existing container if running
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "🛑 Stopping existing container..."
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

# Run the container
echo "🚀 Starting FinAlly..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -v "${VOLUME_NAME}:/app/db" \
  -p "${PORT}:8000" \
  --env-file .env \
  "$IMAGE_NAME"

# Wait for health check (up to 30s)
echo "⏳ Waiting for FinAlly to become healthy..."
MAX_WAIT=30
WAITED=0
until curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1; do
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    echo "❌ FinAlly did not become healthy within ${MAX_WAIT}s."
    echo "   Check logs with: docker logs $CONTAINER_NAME"
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

echo "✅ FinAlly is running at http://localhost:${PORT}"
open "http://localhost:${PORT}" 2>/dev/null || true
