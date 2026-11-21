# Ultimate Guitar for Obsidian

Search, preview, import, and practice Ultimate Guitar songs inside Obsidian.

## Features

- Search Ultimate Guitar by title or paste a song URL.
- Preview search results with rating, vote, and view statistics.
- Import songs as Markdown with stable `ug_imported` frontmatter.
- Render imported songs in a full-page Reading view.
- Switch to Editing mode from the same tab.
- Hide chord or structure-only rows in text-only mode.
- Use a per-song metronome with configurable BPM, sound, and vibration.

## Installation

### Community Plugins

After this plugin is approved, install it from **Settings → Community plugins → Browse** and search for **Ultimate Guitar**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. Copy them into `<vault>/.obsidian/plugins/ultimate-guitar/`.
3. Reload Obsidian and enable **Ultimate Guitar** under **Community plugins**.

## Development

```sh
npm install
npm run format
npm run format:check
npx tsc --noEmit
npm test
npm run build
npm run install:vault -- /path/to/vault
```

## Data and network

The plugin queries public Ultimate Guitar pages and stores the imported raw song markup and source metadata in the vault. Ultimate Guitar HTML and access restrictions may change; failed or blocked requests are reported to the user.
