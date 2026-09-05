#!/usr/bin/env bash
set -euo pipefail

for dependency in herdr jq; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "split-vim-above: required command not found: $dependency" >&2
    exit 1
  fi
done

panes_json="$(herdr pane list)"
pane_json=""

# Keybindings supply HERDR_ACTIVE_PANE_ID. HERDR_PANE_ID is also available
# when this script is launched from inside a pane.
for candidate in "${HERDR_ACTIVE_PANE_ID:-}" "${HERDR_PANE_ID:-}"; do
  [ -n "$candidate" ] || continue
  pane_json="$(jq -c --arg id "$candidate" \
    'first(.result.panes[] | select(.pane_id == $id)) // empty' \
    <<<"$panes_json")"
  [ -z "$pane_json" ] || break
done

# pane current needs Herdr's pane environment. Only trust a focused result here;
# detached custom commands may otherwise resolve stale pane context.
if [ -z "$pane_json" ]; then
  current_json="$(herdr pane current 2>/dev/null || true)"
  if [ "$(jq -r '.result.pane.focused // false' <<<"$current_json" 2>/dev/null)" = "true" ]; then
    pane_json="$(jq -c '.result.pane' <<<"$current_json")"
  fi
fi

# Last resort: use the focused pane, constrained by active tab/workspace when
# Herdr supplied those values to the detached custom command.
if [ -z "$pane_json" ]; then
  pane_json="$(jq -c \
    --arg tab "${HERDR_ACTIVE_TAB_ID:-}" \
    --arg workspace "${HERDR_ACTIVE_WORKSPACE_ID:-}" \
    'first(.result.panes[] | select(
      .focused and
      ($tab == "" or .tab_id == $tab) and
      ($workspace == "" or .workspace_id == $workspace)
    )) // empty' <<<"$panes_json")"
fi

pane_id="$(jq -r '.pane_id // empty' <<<"$pane_json")"
tab_id="$(jq -r '.tab_id // empty' <<<"$pane_json")"
workspace_id="$(jq -r '.workspace_id // empty' <<<"$pane_json")"
cwd="$(jq -r '.cwd // empty' <<<"$pane_json")"
if [ -z "$pane_id" ] || [ -z "$tab_id" ] || [ -z "$workspace_id" ] || [ -z "$cwd" ]; then
  echo "split-vim-above: could not determine the focused pane, tab, and cwd" >&2
  exit 1
fi

state_root="${HERDR_VIM_TOGGLE_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/herdr-config/vim-pane-toggle}"
mkdir -p "$state_root"
chmod 700 "$state_root" 2>/dev/null || true
state_file="$state_root/${workspace_id}__${tab_id}.pane"
lock_dir="$state_file.lock"

if ! mkdir "$lock_dir" 2>/dev/null; then
  lock_pid="$(cat "$lock_dir/pid" 2>/dev/null || true)"
  if [[ "$lock_pid" =~ ^[0-9]+$ ]] && kill -0 "$lock_pid" 2>/dev/null; then
    # Another keypress is already handling this tab.
    exit 0
  fi
  rm -rf "$lock_dir"
  mkdir "$lock_dir"
fi
printf '%s\n' "$$" >"$lock_dir/pid"
release_lock() {
  rm -rf "$lock_dir"
}
trap release_lock EXIT

marked_pane=""
marked_terminal=""
if [ -f "$state_file" ]; then
  marked_pane="$(jq -r '.pane_id // empty' "$state_file" 2>/dev/null || true)"
  marked_terminal="$(jq -r '.terminal_id // empty' "$state_file" 2>/dev/null || true)"
fi

if [ -n "$marked_pane" ] && [ -n "$marked_terminal" ]; then
  marked_exists="$(jq -r \
    --arg id "$marked_pane" \
    --arg terminal "$marked_terminal" \
    --arg tab "$tab_id" \
    --arg workspace "$workspace_id" \
    'any(.result.panes[];
      .pane_id == $id and .terminal_id == $terminal and
      .tab_id == $tab and .workspace_id == $workspace
    )' <<<"$panes_json")"
  if [ "$marked_exists" = "true" ]; then
    herdr pane close "$marked_pane" >/dev/null
    rm -f "$state_file"
    exit 0
  fi
fi

# The record is missing, invalid, or refers to a pane that was closed.
rm -f "$state_file"

if ! split_json="$(herdr pane split --pane "$pane_id" --direction down \
  --cwd "$cwd" --env "HERDR_CONFIG_VIM_EDIT_PANE=$workspace_id/$tab_id" \
  --no-focus)"; then
  echo "split-vim-above: failed to split pane $pane_id" >&2
  exit 1
fi

new_pane="$(jq -r '.result.pane.pane_id // empty' <<<"$split_json")"
if [ -z "$new_pane" ]; then
  echo "split-vim-above: split did not return a new pane ID" >&2
  exit 1
fi

cleanup_new_pane() {
  herdr pane close "$new_pane" >/dev/null 2>&1 || true
}
trap cleanup_new_pane ERR

herdr pane swap --pane "$new_pane" --direction up >/dev/null
herdr pane run "$new_pane" vim "$cwd" >/dev/null

new_terminal="$(jq -r '.result.pane.terminal_id // empty' <<<"$split_json")"
if [ -z "$new_terminal" ]; then
  new_terminal="$(herdr pane get "$new_pane" | jq -r '.result.pane.terminal_id // empty')"
fi
if [ -z "$new_terminal" ]; then
  echo "split-vim-above: could not determine the new pane terminal ID" >&2
  false
fi

state_tmp="$state_file.$$"
jq -n --arg pane "$new_pane" --arg terminal "$new_terminal" \
  '{pane_id: $pane, terminal_id: $terminal}' >"$state_tmp"
mv "$state_tmp" "$state_file"
trap - ERR
