# Herdr Config

Personal configuration for [Herdr](https://github.com/ogulcancelik/herdr).

## Setup

1. Install the Herdr skill:

   ```sh
   npx skills add ogulcancelik/herdr
   ```

2. Link the configuration files:

   ```sh
   ./setup.sh
   ```

Run `./setup.sh` again whenever new configuration files or scripts are added.
Herdr's runtime files remain untouched.

## Vim pane shortcut

After running `./setup.sh`, press `prefix+shift+E` to split the focused pane
and open Vim above it using the same working directory.

Close the new pane if needed with:

```sh
herdr pane close <id>
```
