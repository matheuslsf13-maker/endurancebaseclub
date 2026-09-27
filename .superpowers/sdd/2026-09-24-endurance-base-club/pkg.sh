#!/usr/bin/env bash
# review package excluding lockfiles/binaries: pkg.sh BASE HEAD  (run from repo root)
set -euo pipefail
base=$1; head=$2
W="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$W/review-$(git rev-parse --short "$base")..$(git rev-parse --short "$head").diff"
git merge-base --is-ancestor "$base" "$head" || { echo "HEAD not descendant of BASE" >&2; exit 3; }
EX=(-- . ':(exclude)package-lock.json' ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.xlsx')
{ echo "# Review package: ${base}..${head} (package-lock.json and binary files excluded from the diff body)"; echo; echo "## Commits"; git log --oneline "${base}..${head}"; echo; echo "## Files changed"; git diff --stat "${base}..${head}"; echo; echo "## Diff"; git diff -U10 "${base}..${head}" "${EX[@]}"; } > "$out"
echo "wrote $out: $(git rev-list --count "${base}..${head}") commit(s), $(wc -c < "$out" | tr -d ' ') bytes"
