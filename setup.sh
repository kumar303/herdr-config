#!/usr/bin/env bash
set -euo pipefail

src_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dot-config/herdr"
dest_dir="$HOME/.config/herdr"

if [ ! -d "$src_dir" ]; then
  echo "Source directory not found: $src_dir" >&2
  exit 1
fi

mkdir -p "$dest_dir"

shopt -s nullglob dotglob

for src in "$src_dir"/*; do
  [ -f "$src" ] || continue
  name="$(basename "$src")"
  dest="$dest_dir/$name"

  if [ -e "$dest" ] || [ -L "$dest" ]; then
    if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
      echo "Already linked: $dest"
      continue
    fi
    echo "Replace $dest with a symlink to $src"
    read -r -p "Overwrite $dest? [y/N] " answer
    case "$answer" in
      y|Y) ;;
      *) echo "Skipped: $dest"; continue ;;
    esac
    rm -rf "$dest"
  fi

  ln -s "$src" "$dest"
  echo "Linked: $dest -> $src"
done
