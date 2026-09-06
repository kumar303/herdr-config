# Herdr Config

Personal configuration for [Herdr](https://github.com/ogulcancelik/herdr).

## Setup

Required: Node.js, Vim, and Ghostty.

1. Install the Herdr skill:

   ```sh
   npx skills add ogulcancelik/herdr
   ```

2. Link the configuration files and plugin, then reload Herdr:

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

The local [`split-vim-above`](plugins/split-vim-above) plugin keeps one
Vim pane per working directory and workspace. It parks the running pane in an
inactive Herdr tab, then moves the same pane above the focused pane when
reopened. The pane takes 80% of the split and leaves unrelated Vim panes alone.

Session metadata lives in Herdr's isolated `HERDR_PLUGIN_STATE_DIR`. The plugin
owns its JSON records and locks; Herdr owns the state directory location.

## Development

```sh
npm install
npm test
npm run typecheck
npm run format
```
