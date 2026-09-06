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

## Keybindings

| Key                        | Action                                                        |
| -------------------------- | ------------------------------------------------------------- |
| `Control+backtick`         | Toggle an 80%-height Vim pane above the focused pane          |
| `prefix+Shift+E`           | Fallback for the Vim pane toggle                              |
| `Control+Command+backtick` | Focus the next tab                                            |
| `Command+Shift+K`          | Close the current tab                                         |
| `Command+Option+backtick`  | Create and focus a default-named tab in the current directory |

The Vim toggle tracks only panes that it creates. It does not close unrelated
Vim panes.

## Development

```sh
npm install
npm test
npm run typecheck
npm run format
```
