#!/usr/bin/env bash
set -euo pipefail

git submodule update --remote --merge vendor/baleybots
git -C vendor/baleybots log --oneline -n 15
node scripts/ensure-baleybots.mjs
