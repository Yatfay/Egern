#!/usr/bin/env bash
# Install the self-contained egern-docs skill into an agent skills directory.
#
#   install-skill.sh                          # -> ~/.claude/skills
#   install-skill.sh ~/.agents/skills         # any other skills dir
#
# The skill directory carries its own docs snapshot, so one symlink is enough.
# Symlinked (not copied) so it always reads the current snapshot.
set -euo pipefail

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -f "$SOURCE/SKILL.md" ]; then
  echo "error: SKILL.md not found next to this script's parent" >&2
  exit 1
fi
SKILLS_DIR="${1:-$HOME/.claude/skills}"
TARGET="$SKILLS_DIR/egern-docs"

if [ ! -d "$SOURCE" ]; then
  echo "error: skill source not found at $SOURCE" >&2
  exit 1
fi

mkdir -p "$SKILLS_DIR"

if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  echo "error: $TARGET exists and is not a symlink; move it away first" >&2
  exit 1
fi

ln -sfn "$SOURCE" "$TARGET"

echo "installed: $TARGET -> $SOURCE"
