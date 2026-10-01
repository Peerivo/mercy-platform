#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SHA="${1:-}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

[[ "${EXPECTED_SHA}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "::error::expected main SHA must be a 40-character lowercase commit SHA"
  exit 1
}

current_tree="$(
  gh api "repos/${GITHUB_REPOSITORY}/git/commits/${EXPECTED_SHA}"     --jq '.tree.sha'
)"
[[ "${current_tree}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "::error::could not resolve the exact current-main tree"
  exit 1
}

pulls="$(
  gh api     -H "Accept: application/vnd.github+json"     "repos/${GITHUB_REPOSITORY}/commits/${EXPECTED_SHA}/pulls?per_page=100"
)"

pr_count="$(
  printf '%s' "${pulls}"     | jq -r --arg sha "${EXPECTED_SHA}"       '[.[] | select(.merged_at != null and .merge_commit_sha == $sha)] | length'
)"
[[ "${pr_count}" == "1" ]] || {
  echo "::error::expected exactly one merged pull request for current main; found ${pr_count}"
  exit 1
}

pr_number="$(
  printf '%s' "${pulls}"     | jq -r --arg sha "${EXPECTED_SHA}"       '.[] | select(.merged_at != null and .merge_commit_sha == $sha) | .number'
)"
head_sha="$(
  printf '%s' "${pulls}"     | jq -r --arg sha "${EXPECTED_SHA}"       '.[] | select(.merged_at != null and .merge_commit_sha == $sha) | .head.sha'
)"
[[ "${pr_number}" =~ ^[0-9]+$ ]]
[[ "${head_sha}" =~ ^[0-9a-f]{40}$ ]]

runs="$(
  gh api     "repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${head_sha}&status=success&per_page=100"
)"

run_id="$(
  printf '%s' "${runs}"     | jq -r --argjson pr "${pr_number}" '
        [
          .workflow_runs[]
          | select(
              .status == "completed"
              and .conclusion == "success"
              and any(.pull_requests[]?; .number == $pr)
            )
        ]
        | sort_by(.run_number)
        | last
        | .id // empty
      '
)"
[[ "${run_id}" =~ ^[0-9]+$ ]] || {
  echo "::error::no successful pull-request CI run is bound to merged PR #${pr_number}"
  exit 1
}

artifacts="$(
  gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${run_id}/artifacts?per_page=100"
)"
prefix="mercy-tested-tree-${pr_number}-${run_id}-"
mapfile -t evidence_names < <(
  printf '%s' "${artifacts}"     | jq -r --arg prefix "${prefix}" '
        .artifacts[]
        | select(.expired == false and (.name | startswith($prefix)))
        | .name
      '
)

[[ "${#evidence_names[@]}" == "1" ]] || {
  echo "::error::expected exactly one trusted tested-tree artifact for CI run ${run_id}; found ${#evidence_names[@]}"
  exit 1
}

tested_tree="${evidence_names[0]#${prefix}}"
[[ "${tested_tree}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "::error::tested-tree artifact name is malformed"
  exit 1
}

[[ "${tested_tree}" == "${current_tree}" ]] || {
  echo "::error::current main tree does not match the successful PR CI tested tree"
  exit 1
}

echo "Verified current main tree ${current_tree} against successful PR CI run ${run_id} for PR #${pr_number}."
