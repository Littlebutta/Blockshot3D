# Art

Put custom art files here. They're served at `/art/<file>`.

## Custom player model
1. Export a glTF binary (`.glb`) with the model standing on the origin, facing +Z, about 1.5 units tall.
2. Name any material that should take the player's color with "tint" in it (e.g. `Tint_Body`).
3. Save it here as `player.glb` and set in `public/js/config.js`:

       playerModel: '/art/player.glb',
       playerModelScale: 1,
       playerModelYOffset: 0,

The gun and block bubble are still added on top by `public/js/art.js`; edit `buildPlayerModel()` there to change them.

## Other art hooks
- Colors, team palettes, arena themes and platform-height colors: `ART` in `public/js/config.js`.
- Menu/HUD colors and font: the variables at the top of `public/css/style.css`.
- Card pictures: `cards/<card>/art.png` (700×500 (7:5) recommended; other sizes are cropped to fit).
- Arena blocks: `setLevel()` and `bandMaterial()` in `public/js/render.js`.
