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

## Development

```sh
npm install
npm test
npm run typecheck
npm run format
```
