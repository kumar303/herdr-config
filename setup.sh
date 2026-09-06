#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
herdr_src_dir="$repo_dir/dot-config/herdr"
herdr_dest_dir="$HOME/.config/herdr"

if [ ! -d "$herdr_src_dir" ]; then
  echo "Source directory not found: $herdr_src_dir" >&2
  exit 1
fi

link_file() {
  local src="$1"
  local dest="$2"

  mkdir -p "$(dirname "$dest")"

  if [ -e "$dest" ] || [ -L "$dest" ]; then
    if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
      echo "Already linked: $dest"
      return
    fi
    echo "Replace $dest with a symlink to $src"
    read -r -p "Overwrite $dest? [y/N] " answer
    case "$answer" in
      y|Y) ;;
      *) echo "Skipped: $dest"; return ;;
    esac
    rm -rf "$dest"
  fi

  ln -s "$src" "$dest"
  echo "Linked: $dest -> $src"
}

while IFS= read -r -d '' src; do
  relative_path="${src#"$herdr_src_dir"/}"
  link_file "$src" "$herdr_dest_dir/$relative_path"
done < <(find "$herdr_src_dir" -type f -print0)

legacy_script="$herdr_dest_dir/scripts/split-vim-above.js"
legacy_target="$repo_dir/dot-config/herdr/scripts/split-vim-above.js"
if [ -L "$legacy_script" ] && [ "$(readlink "$legacy_script")" = "$legacy_target" ]; then
  rm "$legacy_script"
  rmdir "$(dirname "$legacy_script")" 2>/dev/null || true
  echo "Removed legacy link: $legacy_script"
fi

ghostty_src="$repo_dir/dot-config/ghostty/config.ghostty"
ghostty_config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
ghostty_dest="$ghostty_config_home/ghostty/config.ghostty"
link_file "$ghostty_src" "$ghostty_dest"

echo "Linking split-vim-above Herdr plugin"
herdr plugin link "$repo_dir/plugins/split-vim-above" --enabled

echo "Reloading Herdr configuration"
herdr server reload-config
