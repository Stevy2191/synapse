#!/usr/bin/env bash
# Lists releases that still need publishing, as JSON: [{"version":"v1.2.0","sha":"…"}].
# A version needs publishing when it has a "## vX.Y.Z" section in CHANGELOG.md, is at least
# MIN_VERSION, has no git tag yet, and some commit set backend/package.json to that version
# (the release is tagged at that commit).
set -euo pipefail
MIN_VERSION="${MIN_VERSION:-1.1.0}"
out="["
first=1
for v in $(grep -oE '^## v[0-9]+\.[0-9]+\.[0-9]+' CHANGELOG.md | sed 's/^## v//' | sort -V); do
  # skip versions older than MIN_VERSION
  [ "$(printf '%s\n%s\n' "$MIN_VERSION" "$v" | sort -V | head -1)" = "$MIN_VERSION" ] || continue
  git rev-parse -q --verify "refs/tags/v$v" >/dev/null && continue
  sha=$(git log --format=%H --reverse -S"\"version\": \"$v\"" -- backend/package.json | head -1)
  [ -n "$sha" ] || continue
  [ $first -eq 1 ] || out="$out,"
  out="$out{\"version\":\"v$v\",\"sha\":\"$sha\"}"
  first=0
done
echo "$out]"
