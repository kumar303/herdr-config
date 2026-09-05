#!/usr/bin/env bash
set -euo pipefail

for dependency in herdr jq; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "split-vim-above: required command not found: $dependency" >&2
    exit 1
  fi
done

pane_json=""
panes_json="$(herdr pane list)"

# A custom command may inherit the source pane ID. Prefer it when available.
if [ -n "${HERDR_PANE_ID:-}" ]; then
  pane_json="$(jq -c --arg id "$HERDR_PANE_ID" \
    '.result.panes[] | select(.pane_id == $id)' <<<"$panes_json" | head -n 1)"
fi

# pane current needs Herdr's pane environment. Only trust a focused result here;
# detached custom commands may otherwise resolve stale pane context.
if [ -z "$pane_json" ]; then
  current_json="$(herdr pane current 2>/dev/null || true)"
  if [ "$(jq -r '.result.pane.focused // false' <<<"$current_json" 2>/dev/null)" = "true" ]; then
    pane_json="$(jq -c '.result.pane' <<<"$current_json")"
  fi
fi

# Detached commands may have no pane environment, so fall back to UI focus.
if [ -z "$pane_json" ]; then
  pane_json="$(jq -c '.result.panes[] | select(.focused)' \
    <<<"$panes_json" | head -n 1)"
fi

pane_id="$(jq -r '.pane_id // empty' <<<"$pane_json")"
cwd="$(jq -r '.cwd // empty' <<<"$pane_json")"
if [ -z "$pane_id" ] || [ -z "$cwd" ]; then
  echo "split-vim-above: could not determine the focused pane and cwd" >&2
  exit 1
fi

if ! split_json="$(herdr pane split --pane "$pane_id" --direction down \
  --cwd "$cwd" --no-focus)"; then
  echo "split-vim-above: failed to split pane $pane_id" >&2
  exit 1
fi

new_pane="$(jq -r '.result.pane.pane_id // empty' <<<"$split_json")"
if [ -z "$new_pane" ]; then
  echo "split-vim-above: split did not return a new pane ID" >&2
  exit 1
fi

cleanup() {
  herdr pane close "$new_pane" >/dev/null 2>&1 || true
}
trap cleanup ERR

herdr pane swap --pane "$new_pane" --direction up
herdr pane run "$new_pane" vim "$cwd"

trap - ERR
