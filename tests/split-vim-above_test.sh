#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$repo_root/dot-config/herdr/scripts/split-vim-above.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/home"

cat >"$tmp/bin/herdr" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail

{
  first=true
  for arg in "$@"; do
    if $first; then
      printf '%s' "$arg"
      first=false
    else
      printf '\t%s' "$arg"
    fi
  done
  printf '\n'
} >>"$HERDR_MOCK_LOG"

case "${1:-} ${2:-}" in
  "pane list")
    cat "$HERDR_MOCK_PANES"
    ;;
  "pane current")
    exit 1
    ;;
  "pane split")
    shift 2
    source_pane=""
    cwd=""
    marker=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --pane) source_pane="$2"; shift 2 ;;
        --cwd) cwd="$2"; shift 2 ;;
        --env) marker="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    next="$(($(cat "$HERDR_MOCK_COUNTER") + 1))"
    printf '%s\n' "$next" >"$HERDR_MOCK_COUNTER"
    new_pane="w1:p$next"
    pane="$(jq -c --arg id "$source_pane" \
      'first(.result.panes[] | select(.pane_id == $id))' "$HERDR_MOCK_PANES")"
    new_terminal="term_$next"
    jq --arg id "$new_pane" --arg terminal "$new_terminal" --arg cwd "$cwd" \
      --arg tab "$(jq -r '.tab_id' <<<"$pane")" \
      --arg workspace "$(jq -r '.workspace_id' <<<"$pane")" \
      '.result.panes += [{pane_id: $id, terminal_id: $terminal, cwd: $cwd,
        tab_id: $tab, workspace_id: $workspace, focused: false}]' \
      "$HERDR_MOCK_PANES" >"$HERDR_MOCK_PANES.tmp"
    mv "$HERDR_MOCK_PANES.tmp" "$HERDR_MOCK_PANES"
    jq -n --arg id "$new_pane" --arg terminal "$new_terminal" --arg marker "$marker" \
      '{result: {pane: {pane_id: $id, terminal_id: $terminal}, marker: $marker}}'
    ;;
  "pane close")
    pane_id="$3"
    jq --arg id "$pane_id" '.result.panes |= map(select(.pane_id != $id))' \
      "$HERDR_MOCK_PANES" >"$HERDR_MOCK_PANES.tmp"
    mv "$HERDR_MOCK_PANES.tmp" "$HERDR_MOCK_PANES"
    printf '%s\n' '{"result":{}}'
    ;;
  "pane swap"|"pane run")
    printf '%s\n' '{"result":{}}'
    ;;
  *)
    echo "unexpected mock invocation" >&2
    exit 1
    ;;
esac
MOCK
chmod +x "$tmp/bin/herdr"

fail() {
  echo "not ok - $*" >&2
  exit 1
}

assert_count() {
  expected="$1"
  pattern="$2"
  actual="$(grep -cF "$pattern" "$HERDR_MOCK_LOG" || true)"
  [ "$actual" = "$expected" ] || fail "expected $expected occurrences of '$pattern', got $actual"
}

reset_case() {
  name="$1"
  panes="$2"
  case_dir="$tmp/$name"
  mkdir -p "$case_dir/state"
  HERDR_MOCK_LOG="$case_dir/calls.log"
  HERDR_MOCK_PANES="$case_dir/panes.json"
  HERDR_MOCK_COUNTER="$case_dir/counter"
  export HERDR_MOCK_LOG HERDR_MOCK_PANES HERDR_MOCK_COUNTER
  : >"$HERDR_MOCK_LOG"
  printf '%s\n' "$panes" >"$HERDR_MOCK_PANES"
  printf '%s\n' 100 >"$HERDR_MOCK_COUNTER"
  export XDG_STATE_HOME="$case_dir/state"
}

run_toggle() {
  HERDR_ACTIVE_PANE_ID="$1" \
    HOME="$tmp/home" \
    PATH="$tmp/bin:$PATH" \
    "$script"
}

base_panes='{"result":{"panes":[{"pane_id":"w1:p1","terminal_id":"term_source","cwd":"/tmp/a dir","tab_id":"w1:t1","workspace_id":"w1","focused":true}]}}'

# 1. No marked pane opens Vim above the source pane.
reset_case opens "$base_panes"
run_toggle w1:p1
assert_count 1 $'pane\tsplit\t--pane\tw1:p1\t--direction\tdown\t--cwd\t/tmp/a dir\t--env\tHERDR_CONFIG_VIM_EDIT_PANE=w1/w1:t1\t--no-focus'
assert_count 1 $'pane\tswap\t--pane\tw1:p101\t--direction\tup'
assert_count 1 $'pane\trun\tw1:p101\tvim\t/tmp/a dir'
echo "ok - no marked pane opens Vim above the source pane"

# 2. A marked pane in this tab closes without another split.
: >"$HERDR_MOCK_LOG"
run_toggle w1:p1
assert_count 1 $'pane\tclose\tw1:p101'
assert_count 0 $'pane\tsplit'
echo "ok - marked pane in current tab closes"

# 3. A marker in another workspace/tab does not affect this tab.
other_panes='{"result":{"panes":[{"pane_id":"w1:p1","terminal_id":"term_current","cwd":"/current","tab_id":"w1:t1","workspace_id":"w1","focused":true},{"pane_id":"w2:p9","terminal_id":"term_other","cwd":"/other","tab_id":"w2:t9","workspace_id":"w2","focused":true}]}}'
reset_case other_tab "$other_panes"
other_state="$XDG_STATE_HOME/herdr-config/vim-pane-toggle"
mkdir -p "$other_state"
printf '%s\n' '{"pane_id":"w2:p9","terminal_id":"term_other"}' >"$other_state/w2__w2:t9.pane"
run_toggle w1:p1
assert_count 1 $'pane\tsplit\t--pane\tw1:p1'
assert_count 0 $'pane\tclose\tw2:p9'
echo "ok - marker in another tab is ignored"

# 4. An unrelated Vim pane is not treated as the shortcut pane.
unrelated_panes='{"result":{"panes":[{"pane_id":"w1:p1","terminal_id":"term_source","cwd":"/current","tab_id":"w1:t1","workspace_id":"w1","focused":true},{"pane_id":"w1:p8","terminal_id":"term_manual","cwd":"/current","tab_id":"w1:t1","workspace_id":"w1","focused":false,"title":"vim"}]}}'
reset_case unrelated_vim "$unrelated_panes"
run_toggle w1:p1
assert_count 1 $'pane\tsplit\t--pane\tw1:p1'
assert_count 0 $'pane\tclose\tw1:p8'
echo "ok - unrelated Vim pane is left alone"

# A stale record cannot close a different pane that reused the pane ID.
reset_case stale "$base_panes"
stale_state="$XDG_STATE_HOME/herdr-config/vim-pane-toggle"
mkdir -p "$stale_state"
printf '%s\n' '{"pane_id":"w1:p1","terminal_id":"old_terminal"}' >"$stale_state/w1__w1:t1.pane"
run_toggle w1:p1
assert_count 0 $'pane\tclose\tw1:p1'
assert_count 1 $'pane\tsplit\t--pane\tw1:p1'
echo "ok - stale marker opens without closing a reused pane ID"

# 5. Open, close, then open again with a cwd containing spaces.
reset_case repeated "$base_panes"
run_toggle w1:p1
run_toggle w1:p1
run_toggle w1:p1
assert_count 2 $'pane\tsplit\t--pane\tw1:p1\t--direction\tdown\t--cwd\t/tmp/a dir'
assert_count 1 $'pane\tclose\tw1:p101'
assert_count 1 $'pane\trun\tw1:p102\tvim\t/tmp/a dir'
echo "ok - open, close, open preserves cwd containing spaces"
