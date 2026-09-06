# Herdr Config

Personal configuration for [Herdr](https://github.com/ogulcancelik/herdr).

## Setup

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

The tracked [Ghostty configuration](dot-config/ghostty/config.ghostty) maps
`Option+Backspace` to `Control+W`. Ghostty must translate this key before it
reaches Herdr because the default terminal sequence drops the Option modifier.

## Vim pane toggle

[`split-vim-above.js`](dot-config/herdr/scripts/split-vim-above.js) toggles a
dedicated Vim pane above the focused pane. It uses the same working directory,
takes 80% of the split, tracks one pane per tab, and leaves unrelated Vim panes
alone.

## Development

```sh
npm install
npm test
npm run typecheck
npm run format
```
