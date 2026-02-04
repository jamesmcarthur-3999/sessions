#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Ensuring BaleyBots build + patch..."
node scripts/ensure-baleybots.mjs

echo "Starting Tauri dev..."
npm run tauri:dev
