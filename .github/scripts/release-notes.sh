#!/usr/bin/env bash
# Prints the CHANGELOG.md section for one version (e.g. v1.2.0), without its heading.
set -euo pipefail
awk -v v="$1" '
  /^## v[0-9]/ { if (found) exit; if (index($0, "## " v) == 1) { found = 1; next } }
  found { print }
' CHANGELOG.md
