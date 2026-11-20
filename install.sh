#!/usr/bin/env bash
# marketing-analytics-hub installer.
#
#   ./install.sh                 skills into ~/.claude/skills (all projects)
#   ./install.sh --project       skills into ./.claude/skills (this project only)
#   ./install.sh --hub DIR       also copy the worker template to DIR (never overwrites)
#
# Existing skills with the same name are backed up to <name>.bak.<timestamp> first.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude"; HUB=""
while [ $# -gt 0 ]; do
  case "$1" in
    --project) DEST="$(pwd)/.claude" ;;
    --hub) HUB="${2:?--hub needs a folder}"; shift ;;
    -h|--help) sed -n 2,8p "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

mkdir -p "$DEST/skills"
for s in "$HERE"/skills/*/; do
  name="$(basename "$s")"
  if [ -d "$DEST/skills/$name" ]; then
    mv "$DEST/skills/$name" "$DEST/skills/$name.bak.$(date +%s)"
    echo "backed up existing $name"
  fi
  cp -R "$s" "$DEST/skills/$name"
  echo "installed skill $name"
done

if [ -n "$HUB" ]; then
  if [ -e "$HUB" ]; then
    echo "$HUB exists, not touching it" >&2
  else
    cp -R "$HERE/templates/worker" "$HUB"
    cp "$HUB/wrangler.toml.example" "$HUB/wrangler.toml"
    cp "$HERE/templates/analytics-profile.md" "$HUB/analytics-profile.md"
    echo "worker template ready at $HUB"
    echo "next: cd $HUB && npx wrangler d1 create marketing-hub, then follow skills/analytics-hub-setup/SKILL.md"
  fi
fi

command -v python3 >/dev/null || command -v py >/dev/null || \
  echo "note: the helper scripts need Python 3.11+ (standard library only)."
command -v node >/dev/null || echo "note: the worker needs Node 22+ and Wrangler to deploy."
echo "done. Try: \"set up the analytics hub\" or \"morning report\""
