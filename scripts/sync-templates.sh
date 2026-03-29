#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# sync-templates.sh — Dev-only: copy templates from the main syntropic137 repo
#
# Usage:  npm run sync-templates
#         ./scripts/sync-templates.sh [/path/to/syntropic137]
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NPX_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATES_DIR="$NPX_ROOT/templates"

# Resolve main repo path (argument or default sibling directory)
MAIN_REPO="${1:-$(cd "$NPX_ROOT/.." && pwd)/syntropic137}"

if [ ! -d "$MAIN_REPO/docker" ]; then
  echo "Error: Main repo not found at $MAIN_REPO"
  echo "Usage: $0 [/path/to/syntropic137]"
  exit 1
fi

DOCKER_DIR="$MAIN_REPO/docker"

echo "Syncing templates from: $DOCKER_DIR"
echo "                    to: $TEMPLATES_DIR"
echo ""

# Files to sync (must match TEMPLATE_FILES in src/constants.ts)
FILES=(
  "docker-compose.syntropic137.yaml"
  "selfhost-entrypoint.sh"
  "selfhost.env.example"
  "init-db/01-create-databases.sql"
)

for file in "${FILES[@]}"; do
  src="$DOCKER_DIR/$file"
  dest="$TEMPLATES_DIR/$file"

  if [ ! -f "$src" ]; then
    echo "  ! Missing: $file (skipped)"
    continue
  fi

  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"

  if diff -q "$src" "$dest" > /dev/null 2>&1; then
    echo "  ✓ $file"
  else
    echo "  ✓ $file (updated)"
  fi
done

echo ""
echo "Done. Review changes with: git diff templates/"
