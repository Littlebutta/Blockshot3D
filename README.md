<p align="center">
  <img src="docs/hero.png" alt="Blockshot 3D characters" width="100%">
</p>

<p align="center">
  <a href="https://github.com/Littlebutta/Blockshot3D/releases/latest/download/Blockshot3D_Windows.zip">
    <img src="https://img.shields.io/badge/%E2%AC%87%20DOWNLOAD%20FOR%20WINDOWS-Blockshot%203D-2ea043?style=for-the-badge&labelColor=1f6feb" alt="Download for Windows" height="56">
  </a>
</p>

<p align="center"><b>Arena duels with upgrade cards.</b> Lose a round, pick a card. First to the target score wins.</p>

## How to install

1. Click **Download for Windows** above.
2. Unzip it somewhere you can write to, such as your Desktop or Documents (not Program Files).
3. Open the `Blockshot3D` folder and run **Blockshot3D.exe**.

You only download it once. The game checks this page when it starts and grabs updates by itself; when one is ready, the title screen shows **Restart to update**.

Older versions are on the [Releases](https://github.com/Littlebutta/Blockshot3D/releases) page.

---

<sub>For the curious: `app/` holds the game files and `update/manifest.json` lists each file's SHA-256. The game downloads only the files that changed (`electron/updater.cjs`). New versions are published with `node tools/publish-update.cjs <resources/app> <this repo>`.</sub>
