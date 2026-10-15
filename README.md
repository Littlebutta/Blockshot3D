# Blockshot 3D

Update channel for the Blockshot 3D desktop game.

- `app/` holds the game folder (what goes in `resources/app` of the Windows build).
- `update/manifest.json` lists every file with its SHA-256 and size.

The game checks this repo on launch and downloads only the files that changed, then installs them on restart
(`electron/updater.cjs`). New versions are published with `node tools/publish-update.cjs <resources/app> <this repo>`.
