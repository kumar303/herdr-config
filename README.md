# Herdr Config

Personal configuration for [Herdr](https://github.com/ogulcancelik/herdr).

## Setup

Required: Node.js, `tmux`, Vim, and Ghostty.

1. Install the Herdr skill:

   ```sh
   npx skills add ogulcancelik/herdr
   ```

2. Link the configuration files and reload Herdr:

   ```sh
   ./setup.sh
   ```

The setup script prompts before replacing existing files. Run it again when
this repository adds a configuration file or script. Herdr's runtime files
remain untouched.

[View the Herdr configuration](dot-config/herdr/config.toml).

The setup script links the tracked
[Ghostty configuration](dot-config/ghostty/config.ghostty) to
`$XDG_CONFIG_HOME/ghostty/config.ghostty`, or
`~/.config/ghostty/config.ghostty` when `XDG_CONFIG_HOME` is unset. It maps
`Option+Backspace` to `Control+W` before the key reaches Herdr.

## Vim pane toggle

[`split-vim-above.js`](dot-config/herdr/scripts/split-vim-above.js) toggles a
dedicated Vim pane above the focused pane. It uses `tmux` to keep one Vim
process per working directory and reconnects to that process when reopened.
The pane takes 80% of the split and leaves unrelated Vim panes alone.

Session metadata lives in `~/.cache/herdr-config-kumar303`. A background reaper
stops sessions that the shortcut has not opened for over two hours.

## Development

```sh
npm install
npm test
npm run typecheck
npm run format
```
