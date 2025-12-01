#!/usr/bin/env bash
set -euo pipefail

# Detect changed schema files and dry-run compatibility against Apicurio.
# Usage: scripts/check-schemas.sh [base_ref]

BASE_REF="${1:-origin/main}"

changed_files=$(git diff --name-only "$BASE_REF"...HEAD -- 'schemas/*.json' | tr '\n' ' ')
if [[ -z "$changed_files" ]]; then
  echo "No schema changes detected."
  exit 0
fi

echo "Schema changes detected: $changed_files"

for file in $changed_files; do
  artifact='user-created'
  echo "Dry-run compatibility for $artifact from $file"
  bun run scripts/register-schema.ts --file="$file" --artifactId="$artifact" --dry-run
done

echo "Compatibility checks passed."
