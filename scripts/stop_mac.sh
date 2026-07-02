#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="finally"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
  echo "❌ Docker is not running."
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "🛑 Stopping FinAlly..."
  docker rm -f "$CONTAINER_NAME" >/dev/null
  echo "✅ FinAlly stopped. Your data is preserved."
else
  echo "ℹ️  No running container named '$CONTAINER_NAME' found."
fi
