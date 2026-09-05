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

After running `./setup.sh`, press `prefix+shift+E` to toggle a Vim pane above
the focused pane using the same working directory. Press it again from the
same tab to close the Vim pane created by the shortcut. Vim panes opened by
other means are left untouched.

You can also close the new pane directly with:

```sh
herdr pane close <id>
```
