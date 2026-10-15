# Blockshot 3D

Round-based arena shooter. Lose a round, pick an upgrade card. Solo against bots or networked multiplayer, free-for-all or team deathmatch, third or first person.

## Playing the test build (easiest)

Unzip **Blockshot3D-Windows.zip** and double-click **Blockshot3D.exe**. Nothing else to install.
Windows may warn that the app isn't signed: click *More info* then *Run anyway*.

## Steam friends

With Steam running: **Multiplayer → Host for Steam friends → Invite Steam friends**. Friends who accept join your lobby automatically (also works from "Join game" in the Steam friends list, even if their game was closed). Traffic goes through Steam's relay network, so nobody sets up a server or forwards ports.

- **Friends' games list**: the Multiplayer menu lists Steam friends who are hosting with a free spot (an empty slot, or a bot you can replace), in the lobby or mid-match, with a Join button. It refreshes every few seconds. Hosts advertise their open spots through Steam rich presence; the list is read with `electron/steamfriends.cjs` (steamworks.js has no friends API, so it calls Steam's own `steam_api64.dll` through the small `koffi` package).
- **Join codes**: the pause menu shows the room's join code (4 letters on a local network, a long number on Steam). Pasting a Steam code into **Join** works too.

- Until the game has its own Steam App ID, builds use Valve's shared test app **480 (Spacewar)**. Steam will show you as "playing Spacewar"; invites and joining still work between friends running this build.
- When you register on Steamworks you get your own App ID. Put it in `steam.config.json`, rebuild, and everything else stays the same.
- Without Steam running, solo play and local testing still work.

## PC only

Blockshot 3D is a PC game (keyboard and mouse). Phones and touch-only tablets that open the game's address get a "PC game" notice instead of the game (the check is a small script in `index.html`; the desktop app never sees it). Other PCs on your network can still open the address shown when the game starts and play in a browser.

**Windows firewall:** the first time the desktop app starts, Windows asks whether Blockshot3D may use the network. Allow it on private networks if you want other PCs on your network to join in a browser.

## Testing multiplayer by yourself

In the desktop app: **Multiplayer → Host a game**, then **Open a test window** (or Ctrl+Shift+N) and join from the new window with the room code. Both windows run on your PC.

## Running from source (for development)

1. Install [Node.js](https://nodejs.org) 18 or newer.
2. In this folder: `npm install`
3. `npm run app` starts the desktop app (with Steam support).
   `npm start` instead runs a plain web server at http://localhost:3000 for browser play over your local network.
4. `npm run build:win` makes the Windows build in `dist/Blockshot3D-win32-x64/`.

## Playing over a local network in browsers

With `npm start`, friends on your network open `http://<your-LAN-address>:3000` (shown in the terminal and lobby), choose **Multiplayer**, and join your room code or pick it from the room list. Over the internet this needs port 3000 forwarded; use Steam instead.

How it works: the host runs the full simulation (including bots). Other players send their inputs and receive game state 30 times a second. There's no client-side prediction yet, so players far from the host feel a little input delay.

## Late joins and reconnects

Players can join a match that's already running (from a friend's list entry, an invite, the room list or the pause-menu code). They watch until the next round starts.

- **Returning players** (same Steam account, or same browser/PC on a local network) get their previous cards, kills/damage and round wins back.
- **New players** get catch-up picks at the next card screen: as many as the average number of cards the other players hold, on top of a normal loser pick, with **50% more time** per pick.
- If the match is full, a bot gives up its seat at the start of the next round.

## Lobby options

Top-right shows a kill feed (who knocked out whom, colored by player). When a match ends you get a table of damage dealt, kills and deaths for every player, and the host can choose **Keep playing** to raise the target by 1, 3 or 5 rounds and carry on with the same cards, or start a new match. In Co-op waves, Keep playing adds waves after a win, or retries the wave the squad fell on after a wipe.

During a match the scoreboard sits top-left: one row per player (or team) in their color with a pip for each round won. Hover a row to see everyone's cards. In first person, press **Alt** to free the cursor for this, and click to aim again.

**Hover a player** in the arena (or put your crosshair on them in first person) for a small card with their name, round wins and current cards.

Every match, including solo, starts in a lobby so you can test the same settings you'd use online. Pick a mode with the big buttons; only the settings that apply to that mode show up under it. Map options are folded into **Arena**.

| Option | Shown for | What it does |
|---|---|---|
| Add bot | all but practice | Up to 20 players total. Each bot has its own difficulty. |
| Mode | | Free for all, Team deathmatch (up to 4 teams; each player picks a team, the host can change anyone's), Co-op waves, or Practice range (solo lobby only). |
| Rounds to win / Waves to survive | FFA, TDM, waves | 3, 5, 7 or 10. |
| Co-op difficulty | waves | Easy, Normal, Hard or Nightmare: the Game Master's credit budget, enemy toughness, how often Elites show up, and how hard the final boss hits (see Co-op waves). |
| Friendly fire | TDM, waves | Bullets can hurt teammates. |
| Shuffle teams | TDM | Randomly redistributes players across the teams in use. |
| ⚡ Speed mode | FFA, TDM, waves | Two card picks per pick phase. The hand refreshes after the first pick, and the card screen explains that. |
| Dummies, behavior, health, "You can't die" | practice | See Practice range. |
| Rerolls per match | FFA, TDM, waves | Off, or 1–5 rerolls each player can spend on the card screen. |
| Pick time | FFA, TDM, waves | 15 s to 2 min, or no limit. Each player has their own timer (Speed mode resets it for the second pick). |
| Combo cards | FFA, TDM, waves | Matching card pairs merge (see Combos). |
| Commander mode | FFA, TDM, waves | A bot plays for you; you choose the cards. |
| Arena → Maps, Map themes, Map hazards | | Generated/classic/mixed/Lava Lake; standard, experimental, all, or one specific theme; random hazard rounds. |

**Cursed cards, holy cards, weapon mods and shield mods are always in the deck**; they're not lobby toggles. Weapon and shield mods show up as often as legendary cards.

**Your color**: the lobby shows all 20 player colors as swatches under the player list; click one to take it (colors other players have are greyed out; your choice is remembered). Clicking your own dot in the player list opens the same picker. In Team deathmatch everyone wears team shades. The 20 colors are `ART.ffaColors` in `config.js`.

## AMON (autobattler mode)
Pick **AMON** in the lobby. Everyone (players and lobby bots) is on one team with shared health (100).
- **Store:** 4 offers at store level 1, one more per level up to 8. Every offer costs 3 gold; reroll 1 gold. Upgrading costs 4 + 2 x level, and that price drops by 1 every time a battle starts. Store odds stop improving at level 8; every level above adds +5% health and damage to all your units. Income depends on your store level (5 + 3 per level). Press **Ready** (or Enter); the battle starts when everyone is ready (or after 75 s with the lobby's Store timer).
- **Cards:** 45 unit groups (tiers I-VI, inspired by RTS units: siege tank, bilelings, carrier, knights, trebuchet, Kirov...) and tactic cards. Every stat card from the other modes is also a tactic card here (its stat changes become unit buffs) plus 22 AMON tactics (Amplifier Core, Queen's Gambit, Veteran Drill, Field Promotion, Echo Chamber...). Buying a card you already own ranks it up (more units, +50% stats per rank).
- **Board:** 5x5, row 0 is the front. Tactic cards reach squares in chess patterns (adjacent, diagonal, king ring, knight, row, column, bishop, rook, queen). Front-row melee gets +10% health, back-two-row ranged units +1 m range, the center square +10%. Hover a card to see what it reaches and what boosts it.
- **Battle:** each player's board fights its own copy of the Game Master's wave (bought from a value budget). When a field is decided, survivors walk onto a field still fighting. Enemies standing at the end cost team health based on their value. Boss on round 10 (Warden Prime) and round 20 (Amon, the Fallen).
- **End:** on a loss or after beating Amon, the host picks +10 harder rounds, PvP (boards fight each other round-robin) or the lobby. **Tab** shows the leaderboard (board score = unit value x stats + store upgrades).
- **Enemy factions:** every wave belongs to one of 17 factions (Tank Commander, Endless Swarm, Undead Legion, Sky Fleet, Artillery Corps, Pyro Cult, Winter Court, Iron Legion, Wild Hunt, Machine Hive, Void Cult, Scrap Raiders, Plague Bearers, Black Crusade, Storm Coven, Shadow Clan, and the Chaos Horde, which takes any unit that fits the point budget). The store shows the next faction, its troops and its points next to your army's points, updated live as you change the board.
- **Points:** a card's value is its base value (unit value x level x units) times a multiplier for the number and kinds of bonuses it gets from other cards. The leaderboard shows army points.
- **Income:** 5 + 3 x your store level, every round.
- **Battle flow:** armies fan out into a wide line, march together at the pace of their slowest walker, and break formation once one of their units attacks or is hit.
- **Take control:** in battle, click one of your units and press Space. WASD moves it, the mouse aims, left button attacks, right button blocks (only units that can block: shield bearers, barrier units, cards with a block bonus). Space again lets go.
- **Every shooter card is an AMON card:** all stat effects (encore, blocks, barriers, counter shots, drain, drills, mines, knockback, sticky bombs, sentry turrets, drones, meteors...) have AMON versions. Tactic offers can also roll Holy (no downsides) or Cursed (stronger, worse downsides).
- **Art gallery** (main menu): every card picture, every AMON unit, enemy, tactic card and faction emblem. Tactic art and emblems are drawn by `tools/amon-art.py` into `art/amon/`.
- Tuning lives in `public/js/amondata.js` (AMON constants, units, enemies, tactics) and `public/js/amon.js` (Game Master budget, damage formula).

## Card screen

- A **stats window** shows everyone's key numbers (health, damage, fire rate, ammo, bullet speed, bounces, regen, lifesteal, bullets per shot, move speed). Everyone sees it, including players waiting for others to pick.
- **Card tips** (Settings): a small 💡 note on the offered card that fits your build best, naming the cards it pairs with. Nothing shows if no card clearly stands out. The pairings are in `public/js/synergy.js`.

## Practice range

Title screen → **Practice range** (or pick it as the mode in the solo lobby). You against target dummies that respawn, no rounds and no score. The practice panel (**P** to show/hide):

- add any card (search, filter by rarity), remove any card you hold, remove all, add random;
- a damage meter: DPS over the last 5 seconds, total damage, biggest single hit;
- dummy count (1–6), behavior (stand still, walk around, fight back), dummy health (100–1000), "You can't die", and New arena.

Round losers pick cards: in free-for-all everyone except the round winner picks; in team deathmatch every member of the losing teams picks.

## Reading platform heights

- Each colored stripe on a block's side is exactly **one jump** tall.
- A platform's top edge color tells you its height: blue = 1 jump, yellow = 2 jumps (needs a step), pink = 3 jumps (needs steps). The legend is shown in the bottom-right during matches.
- A shadow disc under every player shows exactly where they'll land.
- Arena walls have invisible colliders well above their visible height, so nobody can jump or get knocked out of the map.

(Overclocked Legs raises your jump, so you may reach a bit higher than the stripes suggest.)

## Settings (per player)

Name, **language**, third/first person, field of view, mouse sensitivity, master/music/effects volume, particle amount, shadows, screen shake, grass/pebble decorations, **color-blind mode**, **card tips** and the **AI slop filter**.

- **Language**: English, Español, Français, Deutsch, Português. Also in the bottom-right corner of the title screen. Menus are translated by matching their English text in `public/js/i18n.js`; add a column there for another language. Card names/descriptions stay as written in card.json.
- **Color-blind mode**: Protanopia, Deuteranopia or Tritanopia. Applies a daltonization color filter to the whole screen, switches the platform height colors to a palette that stays distinct for every type, and marks card stat lines ▲/▼. See `public/js/a11y.js`.
- **AI slop filter**: googly eyes (three now), nine-fingered noodle arms (and a bonus arm), wobbling bodies, floating emoji, rainbow arenas and bullets, a chromatic-aberration Comic Sans interface, a drifting "free trial" watermark, cursor sparkles, confetti banners, a fake assistant that pops up with unhelpful tips, ™-stamped card names with typos and "AI-Enhanced" badges, and overexcited text everywhere. It only changes what you see, so it's safe in multiplayer. Jokes live in `public/js/slop.js`. Open them from the title screen, the lobby, or the pause menu (Esc). Settings are saved in each player's own browser.

## Cards

Every card is a folder in `cards/`:

    cards/
      heavy-slugs/
        card.json
        art.png        <- optional picture, 700×500 (7:5) recommended; other sizes are cropped to fit

Ways to add a card:
1. **In game:** Card directory → Create a card. Fill in the form, add a picture, Save. (Saving works on the computer running the server.)
2. **By hand:** copy `cards/_TEMPLATE`, rename the folder, edit `card.json`, add `art.png`, then press **Reload cards** in the directory (or restart the match).

Folders starting with `_` are ignored. Broken cards are listed in the directory with the reason they were skipped.

### card.json

```json
{
  "id": "heavy-slugs",
  "name": "Heavy Slugs",
  "rarity": "common",
  "icon": "🔩",
  "description": "Big, slow, painful rounds.",
  "image": "art.png",
  "modifiers": [
    { "stat": "damage",     "op": "mul", "value": 1.7 },
    { "stat": "bulletSize", "op": "mul", "value": 1.4 },
    { "stat": "fireRate",   "op": "mul", "value": 0.75 }
  ]
}
```

- `id`: unique, lowercase letters/digits/dashes. Should match the folder name.
- `rarity`: `common`, `uncommon`, `rare`, `legendary`, `mod` (weapon mod), `shieldmod` (shield mod), `cursed` or `holy`. Each card's chance to be offered is its rarity weight: common 1, uncommon 0.55, rare 0.28, legendary 0.12, weapon mod 0.12, shield mod 0.12 (any one common card is about 8× as likely as any one legendary). Cursed and holy cards use their original card's weight × 0.045. The Card directory shows the live odds. Change weights in `RARITY` in `public/js/config.js`.

### Cursed cards

Every regular card automatically gets a **Cursed** version: **upsides three times as strong, downsides five times as strong**. Mods, combos, holy cards and the two special cards (Regretful Pact, Repentance) don't. For example Heavy Slugs (+70% damage, −25% fire rate) becomes Cursed Heavy Slugs (+210% damage, −76% fire rate). Percent penalties compound rather than multiply (−25% five times over is −76%, not −125%), so nothing drops to zero. Cards with no downside get one small built-in penalty, which is then made five times as strong.

Cursed cards also carry **life drain**: you siphon 4 health per second (per cursed card) from the nearest enemy you can see within 8 m, healed back to you; a block bubble or shield stops it, and a thin red line shows who's being drained. The curse still drains you as before (5% of max health every 2 s, never below 1 health).

Add `"noCursed": true` to a card.json to skip its cursed version, or hand-write your own with `"rarity": "cursed"` (it gets the drain and life drain automatically). Cursed cards show up at their original card's rarity × `CURSED_ODDS` in `config.js` (0.045 now, up from 0.03).

### Holy cards

Every regular card also gets a **Holy** version: its upsides twice as strong with none of the downsides. Cards whose upside can't be doubled (on/off effects like SCP) get +20% health as their blessing instead. Mods, combos and specials don't get one. Holy cards show up at their original card's rarity × `HOLY_ODDS` (0.045).

**Holy and cursed cards exclude each other per player.** Once you hold a holy card you're never offered cursed cards or Regretful Pact; once you hold a cursed card (or the Pact) you're never offered holy cards. (The practice range lets you add anything.) Add `"noHoly": true` to skip a card's holy version.

### Health and size

A player's size (and hitbox) grows with max health, following its square root: 100 health is normal size, 150 is 1.22×, 250 is 1.58×, capped at 1.8×; low health shrinks you down to 0.75×. Size changes speed noticeably: the smallest players are 20% faster, 250 health is about 24% slower, and the biggest size is 32% slower. Tweak `sizeFor` and `speedFor` in `config.js`.
- `op`: `"mul"` multiplies (1.25 = +25%, 0.8 = −20%); `"add"` adds (ammo +2); `"set"` resets the stat to the value when the card is taken (cards taken later still change it; the Critter mod uses this for fire rate).
- The stat lines on the card are generated from `modifiers`. To write them yourself, add `"displayLines": [{ "text": "+50%", "label": "Something", "good": true }]`.

### Stat reference

| Stat | Starts at | Shown as |
|---|---|---|
| health | 100 | Health |
| damage | 24 | Damage |
| fireRate | 3.6 | Fire rate |
| ammo | 3 | Ammo |
| reloadTime | 1.5 | Reload time (lower is better) |
| bulletSpeed | 28 | Bullet speed |
| bulletSize | 0.14 | Bullet size |
| bounces | 0 | Bounces |
| projectiles | 1 | Bullets per shot |
| spread | 0.1 | Spread (lower is better) |
| lifesteal | 0 | Lifesteal |
| explosive | 0 | Explosion size |
| homing | 0 | Homing |
| moveSpeed | 8.5 | Move speed |
| jump | 9.5 | Jump |
| blockCooldown | 3.5 | Block cooldown (lower is better) |
| counterShots | 0 | Bullets on block |
| regen | 0 | Health regen |
| skyfall | 0 | Sky strike |
| blockBarricade | 0 | Sandbag wall health |
| blockEcho | 0 | Echo blocks |
| revive | 0 | Revive health |
| growOnHit | 0 | Damage dealt → max health |
| blockDuration | 0.35 | Block duration |
| blockSize | 1 | Block size |
| blockDeploy | 0 | Deployable shield wall |
| blockHeal | 0 | Healing field |
| blockMines | 0 | Mines on block |
| blockPush | 0 | Block shove |
| blockDash | 0 | Block dash |
| reflectBoost | 0 | Reflected bullet damage |
| blockShock | 0 | Shock bubble damage (also zaps enemies touching a deployed shield wall) |
| blockLeech | 0 | Blocked damage → health (bubble or deployed shield, not sandbags/concrete) |
| blockConcrete | 0 | Concrete wall health |
| knockback | 0 | Knockback |
| drill | 0 | Drill power |
| healAllies | 0 | Damage dealt → heals allies |
| summonTwin | 0 | AI twins |
| summonTurret | 0 | Turret units |
| summonDrone | 0 | Drones |
| poison | 0 | Poison |
| ignite | 0 | Ignite |
| chill | 0 | Chill |
| hex | 0 | Hex |
| chain | 0 | Chain lightning |
| limpet | 0 | Sticky bombs |
| shrapnel | 0 | Shrapnel |
| noSelfDamage | 0 | No self damage |
| drain | 0 | Health drain / 2 s (lower is better) |
| lifeDrain | 0 | Life drain from enemies (health/s, nearest visible enemy within 8 m) |
| bounceTarget | 0 | Bounces re-aim at the nearest visible enemy |
| bounceExplode | 0 | Explode on bounce (45% of the bullet's damage per level) |
| bounceBoost | 0 | Damage per bounce (+fraction; half of it as speed) |
| bounceSplit | 0 | Extra bullets split off per bounce (60% damage; splits don't split) |
| napalm | 0 | Napalm Rounds: impacts leave fire splats that ignite enemies (5 s) |
| slowField | 0 | Bullet Time: field slowing bullets that can hurt you to 25% speed; each copy widens it |
| encore | 0 | Encore: expected free follow-up shots (no ammo used) fired right after each shot (1.5 = one, plus a 50% chance of a second) |
| ringHit | 0 | Hit ring radius in meters (hits players, ignores walls) |
| tank | 0 | Tiny tank (set by the Tiny Tank weapon mod): no jumping, gun is the tank barrel |

Stats are clamped to safe ranges listed in `STAT_INFO` in `public/js/config.js`.

### Adding a brand-new behavior

Most ideas are stat changes. For new behavior, open `public/js/effects.js`. Each entry there is a behavior tied to a stat name, with hooks that run when a player blocks, every tick, on death, or at round start. Sandbag Barricade, Echo Shield, Counter Pulse and Phoenix Protocol are all written this way and are good examples to copy.

1. Add your stat to `DEFAULT_STATS` (starting at 0) and `STAT_INFO` (label and limits) in `config.js`.
2. Add an entry with the same name to `EFFECTS` in `effects.js`.
3. Any card can now use it: `{ "stat": "yourStat", "op": "add", "value": 1 }`.

For changes to how bullets are fired or fly, see `tryShoot` and `updateBullets` in `sim.js`.

## Combos

With **Combo cards** on in the lobby, owning both cards of a pair merges them into a combo card (a mix of both, plus a twist). Combo cards are never offered directly; the Card directory lists them all.

| Ingredients | Becomes |
|---|---|
| Thruster + Heavy Slugs | **Battering Ram** |
| Overclocked Legs + Phase Step | **Blink Runner** |
| Twin Barrel + Rapid Cycler | **Bullet Hose** |
| Sandbag Barricade + Bulwark | **Fortify** |
| Seeker Chip + Orbital Drop | **Guided Meteor** |
| Hydra Rounds + Ricochet Rounds | **Hydra Swarm** |
| Bastion Wall + Big Bubble | **Iron Curtain** |
| Heavy Slugs + Railgun Coil | **Mass Driver** |
| Mine Layer + Volatile Payload | **Minefield** |
| Ricochet Rounds + Volatile Payload | **Pinball Bomb** |
| Echo Shield + Counter Pulse | **Reverb Barrage** |
| Mending Field + Nanite Repair | **Sanctuary** |
| Quick Hands + Extended Mag | **Speed Loader** |
| Glass Core + Reinforced Plating | **Tempered Glass** |
| Drill Rounds + Railgun Coil | **Tunnel Borer** |
| Leech Rounds + Nanite Repair | **Vampiric Nanites** |
| Tommy Gun + Extended Mag | **War Drum** |
| Bank Shot + Ricochet Rounds | **Trick Shot** |
| Incendiary Rounds + Shrapnel Rounds | **Wildfire** |
| Venom Rounds + Field Medic | **Plague Doctor** |
| Arc Rounds + Frost Rounds | **Storm Caller** |
| Hex Rounds + Leech Rounds | **Curse Eater** |
| Padded Vest + Troll Blood | **Thick Hide** |
| Stutter Trigger + Hair Trigger | **Overture** |
| Sticky Bombs + Volatile Payload | **Demolition** |

To add a combo, make a card folder with `"rarity": "combo"` and `"combo": ["first-card-id", "second-card-id"]`.

## Special cards and modes

- **Regretful Pact** turns your future offers cursed (with a rare chance of a normal card) in exchange for its power. While you hold it, a very rare **Repentance** card can show up; picking it removes the Pact and restores your normal offers. Cursed cards are otherwise very rare.
- **Unique cards** (like Tommy Gun) are only offered if you don't already have them (`"unique": true`).
- **Commander mode** (lobby option): a bot plays your character; you pick the cards. Your mouse and keys never aim or move it. Unlocks unit cards: Twin Protocol (a copy of you), Sentry Unit (a two-gun turret that can't move), Wasp Drone (tiny health, light damage, flies at the height of the tallest pillar).
- **Co-op waves** (lobby mode): everyone teams up against waves of raiders that get tougher each wave. Clear a wave and everyone picks a card; if the whole squad falls, it's over. Field Medic (heals nearby allies when you deal damage) only shows up here. Works with Commander mode too. Details in **Co-op waves** below.
- Cards can be limited to modes with `"modes": ["waves"]` or `["commander"]`.

## Map features

- **Arena shapes**: generated maps are a rectangle about a third of the time, otherwise a full polygon: hexagon, octagon, triangle, trapezoid or pentagon. Polygons are scaled so the playable area stays about the same. Players, crates and bullets all treat the angled walls as walls (bullets bounce off them). Spawns follow the edge, and the ground outside is raised and themed. Shapes are in `levelgen.js` (`shapeVerts`); `clampToArena` in `physics.js` keeps things inside.
- Platform heights follow tiers: 0.8 m (low enough to shoot over from first person), 2.0 m (needs a step), 3.2 m (tall cover). Side stripes match the tiers, one stripe per jump.
- Maps include moving platforms, pillars that slowly rise and sink, and crates and barrels that get shoved by bullets, explosions and players.
- **Lava Lake**: the floor is lava; fight on floating platforms that drift when hit and spring back. Everyone spawns on their own platform, from a mirror-symmetric ring around the edge with stepping stones between neighbors. Touching lava or the arena's edge field hurts. Block at the moment you touch either and you take no damage and get launched back (high enough to land on a platform).
- **Map hazards** (lobby checkbox): some rounds get one event: a slow laser sweep you jump over, spinning saw blades sticking out of pillars, or a rogue two-gun turret in the middle that shoots everyone and raises a shield when threatened.
- Blocking a bullet reflects it back (it becomes yours: it can now hurt the shooter, not you) but it **keeps the shooter's color, bullet effects and damage**; only your Reflected damage card adds to it. Blocking also extends your block: 0.42 s for the first reflect, each further one in the same block 25% less, at most 1.2 s extra in total.
- **Block size** scales every deployable: the bubble, deployed shield walls (Bastion, Holy Bastion, Iron Curtain), the Turret mod's bubble, the Pillar Shield pillar and box, sandbags, concrete and mines.
- **Health bars**: a slowly pulsing green outline while someone is regenerating (has regen and isn't full), and a quick green flash on every one-off heal (lifesteal, Siphon Shield, healing field, Field Medic, Bloodforge). Shown on the floating bars and your HUD bar.
- **Sandbags and concrete** (Sandbag Barricade, Concrete Barrier): placed a fixed distance straight ahead of you (see Deployable layout), long side facing you, at any angle. Concrete is a taller 1.6 m slab. No limit on how many. A wall placed on another wall stacks on top of it (with both cards you get concrete with sandbags on top), walls drop down if what they stand on breaks, and you can stand on them. Concrete wears a stripe in its owner's color; on sandbags the middle row of bags is tinted with it. Concrete has 4× the health of sandbags.
- **Siphon Shield**: damage your block stops (bullets, explosions, bites) heals you for half of it, including through a deployed shield wall. Sandbags and concrete don't count.
- Every hit carries a hidden knockback that grows with its damage (on top of the Knockback stat).
- Bullets drop over distance, and bigger bullets drop harder (`bulletGravityFor` in `config.js`). Bullet size grows a little with damage, damage grows a little with bullet speed, and explosion size is set by damage. Aiming (yours and the bots') compensates for drop.
- **Homing** only locks onto targets the bullet can see; it won't curve toward someone behind a wall. Extra explosive levels add follow-up blasts a second later.
- Rounds that drag past 100 seconds go to **Overtime**: everyone slowly loses health so nothing can stall forever.
- Phoenix-style revives take about a second and a half, marked by a column of light where you fell.

## Cash, the shop and bets

- **Cash** (💰, shown on the title screen and in the shop) is earned by finishing matches: 25 for finishing, +10 per round (or wave) your side won, +5 per kill, +2 per 100 damage, +60 for winning. "Keep playing" pays again for what happens after. Practice range pays nothing. Tuning: `PAY` in `public/js/economy.js`.
- **Shop**: title screen → **Shop & Customize**. Items with 🔒 and a price are locked: picking one lets you try it on in the preview, then **Buy**. Randomize only uses what you own. Prices are in `PRICES` in `economy.js` (None and the Cube gun are free). The first time this version runs, whatever you're already wearing becomes owned.
- **Bets** (multiplayer only, at least 2 people): during a match a small panel (top center, and in the Esc menu) lets you bet cash on yourself (your team / the squad) winning: +10, +50, +100 or all in, as often as you like. Bets close once the first round (or wave) is decided, so you can't wait until you're clearly winning. Win the match and you get **2×** what you bet; lose (or leave early) and it's gone. Everyone sees a notice when someone bets. Tuning: `BET` in `economy.js`.
- Cash, owned items and bets are saved per PC with your settings (like your name and color).

## Customize

Title screen → **Shop & Customize**: hats, facial hair, eyewear and neckwear in fixed colors, so they never clash with team colors, plus a **gun skin**. The preview stands still; **Spin** toggles a slow turn and you can drag it to rotate. Other players see your choices; bots get random ones. Add more in `buildCosmetics()` in `public/js/art.js` plus a label in `COSMETICS` in `config.js`.

**Gun skins**: Cube (the original), Blaster (the old first-person gun), Solid gold, Neon, Camo, Toy blaster, Retro ray gun, Candy cane, Banana, Baguette, Rubber duck, Fish, Carrot. Each skin is one model used in both views (third person on your character, first person in the overlay), and syncs to every player. Built in `buildGunSkin()` in `art.js`; Cube, Blaster, Neon and Camo carry your player color.

## Weapon mods, bullet effects and status effects

- **Weapon mods** (always in the deck, as common as a legendary card): Flamethrower, Riot Shield, Scattergun, Grenade Launcher, Beam Rifle, Critter, Tiny Tank, Katana. **One weapon mod and one shield mod at a time**: taking a new one replaces the old one, and this is enforced on every path (picks, practice range, rejoins) in `oneModEach()` in `sim.js`. A card with `"weaponMod": "<n>"` and `"rarity": "mod"` swaps your gun; the behavior lives in `fireMod()` / `updateShieldGun()` in `sim.js`.
- **Critter**: every shot sends a critter in your color running at the nearest enemy. Its speed is 60% of your bullet speed (kept between 10 and 24), its bite is your bullet damage, its health is 10% of yours, and it lasts 12 s. At most 6 at once per player: firing at the cap replaces your oldest one and shows you (only you) a "Max critters" notice, and the HUD shows your own critter count. Weapon-mod critters steer like wave critters (they brake harder the faster they are and hold just inside bite range). Tuning: `CRITTER_MAX`, `CRITTER_SPEED` in `sim.js`.
- **Scattergun**: 10 pellets per shot in a tight cone, each 32% of your damage (3.2x per shot if all land), fire rate x0.6, +0.5 knockback. Tuning: `SCATTER` in `sim.js`. Taking the card resets your fire rate to 1 shot per second; fire-rate cards you take afterwards still raise it.
- **Riot Shield**: a fixed arc held in front of you that reflects enemy bullets crossing it (and critter bites from the front). 4 hits, then it turns red and recharges for 3 s; an intact shield regains a hit every 2.5 s (blue rim = healthy, orange = low, red = recharging; the HUD shows a Shield bar, and in first person you see the arc). Fire sends a wave of normal bullets: your bullets per shot, +1 per 0.35 s held, up to +5. Wave bullets keep every bullet effect from your cards. 1 ammo per wave. Tuning: `RIOT` in `sim.js`.
- **Deployable layout**: everything one block places goes straight ahead of you at fixed distances, nearest first: turret, then walls (concrete / sandbags / Bastion wall), then a row of mines. Each extra kind pushes the next ones further out (`planDeploys()` in `sim.js`).
- **Katana**: your gun becomes a sword (third and first person). **Click** to slash: everyone in a ~126° arc in front of you within 2.1 m (× your size) takes 140% of your bullet damage with all your bullet effects (poison, fire, chill, hex, chain, limpets, knockback, lifesteal; Explosive bullets burst on each target without hurting you). Bubbles, riot shields and pillar boxes stop the blade. For 0.16 s each slash also **cuts enemy bullets** in the arc: they vanish with no impact, so no explosion, shrapnel, fire or damage. **Hold** to charge (bar in the HUD; full in 1.1 s at the base fire rate, faster with more fire rate, slower with less) and **release** past 25% to throw a **slash wave**: it is one of your bullets, so every bullet card applies (bounces, homing, poison, explosions...), it is wider and stronger the more it's charged (up to 2.6× damage), passes through players and cuts the enemy bullets it touches (two waves cut each other). Extra bullets per shot widen the slash and fan out extra waves. No ammo and no reload. Bots close in and slash, or charge waves from range. Tuning: `KATANA` in `sim.js`.
- **Critters** stop about a meter short of their target and lunge-bite from there (`CRITTER_REACH` in `sim.js`).
- **Tiny Tank** (weapon mod): you drive a tiny tank in your color. Slower (−30% move speed), no jumping at all, +60% health, +20% damage and explosive shells (+1 explosion size) fired from the tank's barrel. The hull turns toward where you drive, the turret follows your aim, and your hat rides on the turret. **In first person** the camera sits over the tank's right shoulder (low and close; a wall behind pulls it straight in rather than up) and you aim with the crosshair as usual. Being a weapon mod, it can't be combined with Riot Shield or any other gun.
- **Bounce cards**: Bank Shot (after a bounce the bullet re-aims at the nearest enemy, player or bot, within 22 m that it can see, then keeps curving toward it until a wall blocks the view; `BANK_RANGE` in `sim.js`), Rebound Charge (explodes on every bounce), Kinetic Rebound (+25% damage per bounce), Splinter Bounce (each bounce splits off a 60%-damage bullet). Combo: **Trick Shot**.
- **Saturn Rounds**: bullets wear an outer ring. The ring isn't a physical hitbox (it passes through walls and shields) but counts as a hit on any player it touches.
- **Bullet effects**: Venom (poison ramps up after 3 s, +15% total), Incendiary (burn), Frost (slow), Hex (+25% damage taken), Arc (chain lightning), Sticky Bombs, Shrapnel.
- **Burn** is steady damage for a fixed time; **poison** starts slow and ramps up. Both show on the target: flames climbing the body or green bubbles rising off it, a glow that pulses with the damage, and an orange / green frame on the health bar (your own HUD bar and the screen edges glow too). Steady damage doesn't trigger the white hit flash, so the effect stays readable (`updateDot` in `render.js`).
- **Napalm Rounds** (legendary): every bullet impact splatters sticky fire onto the floor, platform top or wall it hit (a hit on a player puts it on the floor under them). The splat's size comes from the bullet's damage (`napalmRadius` in `sim.js`); it burns for 5 s and sets any enemy who touches it on fire (jumping over it is safe; it never burns you). Each flame is checked to sit on real level surface inside the splat circle, so nothing hangs past a ledge or above a wall's visible top, and crates, moving platforms and sandbags never hold fire. At most 2 splats per bullet, 40 at once. Tuning: `NAPALM` in `sim.js`.
- **Bullet Time** (legendary): a field around you slows every bullet that could hurt you to 25% of its speed (your own and allies' bullets aren't touched). The field is 4 m across the floor; each extra copy adds 2.5 m of radius and never more slow. Everyone sees it as a soft pulse in a lighter shade of your color that rolls out along the floor and settles at the field's edge. Tuning: `SLOWFIELD` in `sim.js`; the pulse is `updateField` in `render.js`.
- **Co-op wave bots** (raiders, Elites, wave turrets and drones) wear a dark visor with two slanted amber eye slits and a small dark crest (Elites keep their crown instead), so they read as enemies at a glance as well as by color (`addRaiderMarks` in `art.js`).
- **Cursed cards** drain 5% of max health every 2 s (never below 1 health) and show up at their original card's rarity times `CURSED_ODDS` in `config.js` (0.03 now; set 1 for the same odds as the normal card).
- **Friendly fire** only controls hurting allies. You can always hurt yourself (ricochets, explosions, mines) unless you have **SCP**.

## Shield mods

Like weapon mods, but for your block: one at a time, as common as a legendary card, never cursed or holy. A card with `"shieldMod": "<n>"` and `"rarity": "shieldmod"`; the behavior is in the "shield mods" section of `sim.js` (`tryBlock` calls into it). Bots use Clone, Turret, Pillar Shield and Ground Slam on purpose when there's a fight.

| Mod | What blocking does |
|---|---|
| **Clone** | No bubble and no block effects at all. Each block splits you: your health (max and current), damage and block stats (everything but the cooldown) are halved, and a clone with those same halved stats and all your cards and gun effects appears (block cooldown ×3.2, at most 2 clones). The next clone halves again; it all resets when the round ends. If you die while a clone is up you take over the clone. Phoenix Protocol only saves your last body. Tuning: `CLONE_SPLIT` in `sim.js`. |
| **Turret** | Normal block, plus a turret just ahead of you, always nearer to you than any wall or mines the block also places. The turret has its own block bubble (sized by Block size; health 50 × (Block duration / 0.35)^0.75 × √Block size). It breaks and comes back full 3 s later, and an intact bubble refills 10%/s after 2.5 s without a hit (`TURRET_SHIELD` in `sim.js`). Turret health = 70 × Block size (+ a share of wall health), lifetime = 6 s + 8 × Block duration, shots per volley = 1 + Echo blocks, ammo = 4 + Bullets on block, damage = 55% of yours × (1 + Reflected damage). Block cooldown ×1.5; Echo blocks come 5 s apart instead of 1 s; at most 3 turrets. |
| **Gun Nest** | Normal block, plus (if you don't already have one) a turret beside you on a clear spot: not in walls, shields, mines, Core drops or anyone's body, and walls, shields, mines, units and Core props placed later are pushed off it. Anyone can man it with Use (E) and leave with E again: you stand still, aim with your crosshair and your trigger fires the turret; its shots are yours while you're on it (team, kills), even if you're the caster's enemy. It fires a copy of the caster's gun as it was when built (every bullet stat and effect, gun mods except Critter) at 2× fire rate with its own ammo, and keeps those stats whoever mans it. Health = the caster's max health; it never heals and loses 1.2% of it per second (`MOUNT` in `sim.js`). One per player. Block cooldown ×1.3. |
| **Pillar Shield** | A tall, extra-wide pillar (wider with Block size) rises under you and lifts you up, boxed in by a square gold shield that lines up with the pillar's walls and rises with it (HUD: Pillar bar). The shield belongs to the pillar, not to you: it stops enemy bullets, explosions, bites, beams, slams and life drain coming from outside, protects whoever stands inside, and doesn't protect you once you step off. It lasts until it has soaked 120 damage (× Block size, × √(Block duration / 0.35)) or the pillar goes. Blocking again replaces the pillar and its shield. Block cooldown ×1.5. |
| **Rewind Blink** | Blinks you back to where you were 1.5 seconds ago (skipping spots that got walled off since), with your normal short bubble when you land. Replaces block dashes. |
| **Bullet Catcher** | Bubble lasts 2.5× longer and catches enemy bullets instead of reflecting them; when it drops, every caught bullet fires at the nearest enemy you can see with +25% damage. |
| **Super Saiyan Hair** | No bubble. Your hat is replaced by spiky hair. **Hold block** to power up: you can't move, jump or shoot while charging, and the hair fills a health pool worth **7× your max health** (recalculated after every card) that takes damage before your own health. It never counts toward your size. Full hair is huge, golden and glowing; drained hair is a small dull grey tuft (HUD: Hair bar). Charging speed: full in 8 s × (Block cooldown / 3.5) / √(Block duration / 0.35). It starts empty each round. Tapping block still fires your other block cards (walls, mines, counter shots...) on the normal cooldown. Bots charge when nobody can see them. Tuning: `HAIR` in `sim.js`. |
| **Pentagram** | No bubble. **Hold block** to draw a purple pentagram on the floor under you (you can't move or shoot while charging; let go before it's finished and it fades). Once fully drawn, candles light up at its points, your other block cards fire, and it **stays put** until the ritual is done, so you can walk away and come back. Hold block **inside** it to charge 3 levels; each level opens a portal that releases critters (3, then 5, then 8, × √Block size; ritual critters last 10 s and don't count toward the Critter mod's cap). The circle turns from purple to red over the three levels. Charge toward the next level is lost when you let go. After level 3 (or 30 s) it resolves and block goes on cooldown (× 1.4). Same charge-speed rule as the hair; radius 2.3 m × Block size. Tuning: `RITUAL` in `sim.js`. |
| **Ground Slam** | Launches you into the air. While airborne after the leap you move 60% faster and steer harder, so you can land on someone. When you land, a shockwave (radius 3.2 m × Block size) deals 28 + 90% of your bullet damage and throws enemies back (harder with Block shove). Tuning: `SLAM` in `sim.js`. |

## Co-op waves

Everything here lives in `public/js/coop.js`.

- **Spawns**: the squad starts on one end of the arena's long axis and the wave on the opposite end; reinforcements arrive on the side away from the squad. Co-op never uses Lava Lake (the bots can't handle the floating platforms), even with "Lava Lake only" picked.
- **Game Master**: every enemy has a credit cost (`UNIT_COSTS`): critter 1, raider 2, blob 3, turret 3, drone 3, Elite 8, boss 40. Each wave's budget is `(2 + 1.5 × wave) × (1 + 0.45 per extra player) × difficulty` (`waveBudget`). Unit types unlock by wave (blobs from 2, turrets from 3, drones from 4; `UNIT_PLAN`). The wave is split into an opening group (about 60% of the credits) and up to two reinforcement groups, which arrive when the field has thinned to 40% of the last group's value or after 28 s. A toast at the start of each wave shows what was bought.
- **Standard wave bots never get cards** any more; they scale through health and damage per wave.
- **Elite bots**: bought by chance (Easy 22%, Normal 38%, Hard 55%, Nightmare 75%; from wave 4/3/3/2). Every Elite gets a brand-new hand: one random card, then each next card is the best synergy fit (the card-tip scores from `synergy.js`) out of a random handful. 3 cards + 1 per 3 waves (±difficulty, 2-8). They wear a crown, get a title from their build ("Elite Venomist", "Elite Bomber"...), and their cards are announced and shown on hover.
- **Final boss: The Warden** appears on the final wave (and again at the new final wave after Keep playing). Health scales with squad size, difficulty, wave and how many cards the squad holds; it can't be knocked back and overtime is off during the fight. Attacks, all telegraphed on the floor (red fills in as the hit winds up and flashes just before it lands):
  - **Orb volley**: a fan of big slow orbs. Block them to reflect them back at it.
  - **Cleave**: a wide cone at the nearest player (front and back in phase 3).
  - **Meteors**: circles on every player plus extra ones.
  - **Beams**: lines from the boss to each player (phase 2+).
  - **Shockwave**: a ring rolling out along the floor. Jump over it, or stand on a platform (phase 2+).
  - **In / out**: either a big ring with a safe spot right next to the boss, or a big circle around it to get away from (phase 2+).
  - **Leap**: an orange circle where it's about to land (also how it gets unstuck).
  - **Portals**: violet circles that open into portals spawning enemies from their own refilling credit budget. Shoot a portal to close it early (phase 2+, earlier on Hard/Nightmare).
  - **Cross**: four (later eight) beams through the boss (phase 3, never on Easy).
  - Blocking at the moment a hit lands stops it.
- **Boss scaling**: phases at 66% and 33% health (more projectiles and circles, shorter gaps, phase-3 combos), faster cooldowns and shorter wind-ups the longer the fight runs, and an enrage after 3 minutes (+30% damage, one more attack at once). Difficulty sets wind-up time (Easy 30% longer, Nightmare 22% shorter), cooldowns, extra projectiles/circles/portals, how many attacks can overlap, which units portals bring (Elites on Hard/Nightmare phase 3) and damage. Later final waves add more circles and damage. Killing the boss removes everything it brought.
- **Squad bots dodge**: bots on your team step out of telegraphs about to land and hop shockwaves (hard bots almost always, easy bots about half the time).
- A health bar for the boss sits at the top of the screen, with phase pips.

## Combos are a choice

When a card you pick completes a combo, you get a **Combine / Keep separate** prompt. You're only asked again if you pick another copy of one of its pieces. Offered cards that would complete a combo are tagged with what they pair with. Combos stay hidden in the Card directory until you've seen them formed on this computer.

## Controls and pausing

- **Tab** switches between first person and the default view.
- **Esc** pauses the whole match when you're the only human (with any number of bots) or in Commander mode; everyone sees who paused it. In other multiplayer matches the menu opens without pausing.
- Each round starts with a 3-2-1 countdown.

## Map themes

Lobby **Map themes**: Standard, Experimental, All, or one specific theme.

- **Experimental themes**:
  - **Castle**: cobblestone, timber-framed houses, banners, battlements.
  - **Western**: sand, plank walls, cacti.
  - **Candy**: candy-cane pillars, lollipops, gumdrops.
  - **Forest**: pillars and tall walls become mossy boulders, and low walls become overturned logs with oyster mushroom shelves. Thick grass tufts, ferns and bushes; small mushrooms on the forest floor; trees outside the low banks, with a Bear's Head Tooth cascading off a trunk at the back.
  - **Tundra**: snow, frosted stone with snow caps, snowy pines, ice crystals and drifts.
  - **Neon**: synthwave night with glowing grid floor, neon trim, pylons and a striped sun.
  - **Sakura**: a Japanese temple garden. Raked gravel with stepping stones and fallen petals, shoji (paper and dark wood) walls, tatami tops, cherry trees and bamboo outside, a torii gate at the back, stone lanterns, drifting petals.
  - **Tropical**: a beach island. Sand with shells, bamboo walls and tops, palm trees, beach umbrellas, tiki torches and a rolling sea beyond the walls.
  - **Lunar**: a moon base. Cratered regolith, metal panel walls with hazard stripes, grate tops, satellite dishes, habitat modules, a starry sky and the Earth overhead.
  - **Volcano**: black basalt with glowing cracks (the floor is safe), obsidian walls with lava veins, obsidian spires and lava pools outside, rising embers and an erupting volcano in the distance.
- Experimental themes have their own skybox.
- **Platform tops** match the theme (stone slabs, planks, sprinkles, moss, snow, dark glass), with only a slight tint toward the height color. The bright edge line still gives the exact height.
- Standard themes have faint panel seams, grain and a soft bevel on the tops.
- Height stripes and edge colors work the same in every theme.
- The theme meshes are in `public/js/scenery.js`.
- Lava Lake is generated fresh each time with a set of moving platforms guaranteed.

Wave mode adds **critters** (small, fast, bite on contact) and **blobs** (slow, split in two twice when killed).

## Bots

Bots know every surface they can stand on (blocks, rising pillars, sliding and floating platforms) and plan routes across them: walking, climbing steps and jumping gaps. They go for high ground with a shot at their target, shuffle around while holding it, hop platforms on Lava Lake instead of waiting, and give up on a route that isn't working. Harder bots value height more. The logic is in `ai.js` (`planNav` / `followNav`).

## Testing

`node tools/simtest.mjs` runs the simulation headless (no browser): smoke runs of every mode including 20-player matches, plus checks for spawns, homing, walls, shields, knockback, speed scaling and bot movement.

## Sounds and music

See `sounds/README.md`. Drop files in `sounds/`, list them in `sounds/sounds.json`. Anything you haven't provided uses a built-in placeholder.

**Music** crossfades on every change:

- **Built-in songs**: two menu songs and four battle songs that cycle every 24-32 bars.
- **Boss theme**: plays while the co-op boss is up.
- **Suspense track**: starts automatically in a deciding round (anyone left could win the match with it) once only two fighters remain, and stays until the round ends.
- **Your own music**: each music entry in `sounds.json` can be a list of files, which becomes a playlist.

## Art

Card pictures for the built-in cards are drawn by `tools/card-art.py` (Pillow; `python3 tools/card-art.py` draws any listed card that has no art.png, `--force` redraws). Any `art.png` you drop into a card folder replaces it; cursed and holy versions reuse their original card's picture with a red or gold tint. See `art/README.md`. All colors, team palettes, arena themes (including the grass and pebble colors per theme, and `propDensity`), sandbag color and the height colors are in `ART` in `public/js/config.js`; menu colors and font are at the top of `public/css/style.css`; the player model can be swapped for your own `.glb`.

Level surfaces are small canvas textures drawn in `render.js` (no image files, so they cost almost nothing):
- **Standard themes:** floors are 2 m panels, each a slightly different tone, with worn seams, corner rivets and a few stains (`floorTexture`). Block sides shade darker toward the foot (`standardDetail`), platform tops have a soft sheen and corner screws (`topTexture`), and arena walls are 2 m panels with a lit cap line (`wallTexture`).
- **All themes:** a soft dark contact shadow where blocks and walls meet the floor (`addContact`). Crates have planks and a brace (`crateTex`), barrels have ribs and a label (`barrelTex`), and concrete walls are speckled (`speckleTex`).
- **Lava Lake:** the floor has dark crust plates over glowing lava that drift slowly (`lavaTexture`).
- Player and bot models are untouched.

## Project layout

    electron/            desktop app: starts the server, Steam lobbies/invites/networking, friends list (steamfriends.cjs)
    steam.config.json    Steam App ID (480 = Valve's test app until you have your own)
    tools/               Windows build helpers
    server.js            web server, card API, local-network room relay
    public/index.html    menus and HUD
    public/css/style.css menu/HUD styling
    public/js/
      main.js      screens, lobby, solo/host/join flow, input, HUD
      config.js    rules, base stats, rarities, bot difficulty, ART
      sim.js       game rules and simulation (runs on the host)
      economy.js   cash, shop prices, match pay and bets
      effects.js   card behaviors (sandbags, echo block, revive...) - add new ones here
      ai.js        bots (including platform navigation and boss dodging)
      coop.js      co-op: difficulty, Game Master credits, Elites, the final boss, portals
      scenery.js   theme meshes: rocks, logs, mushrooms, trees, pines, neon props
      physics.js   movement and collision
      levelgen.js  arena generator, classic layouts, spawn points
      cards.js     card loading, validation, stat changes
      render.js    3D drawing, cameras, health bars, effects
      art.js       player model (swap point for custom models)
      audio.js     sound effects and music
      net.js       multiplayer connection (local server rooms, Steam)
      settings.js  per-player settings
      i18n.js      interface languages
      a11y.js      color-blind filter and palettes
      synergy.js   card tips on the card screen
      slop.js      the AI slop filter's text and popups
    cards/       one folder per card
    sounds/      your audio files + sounds.json
    art/         your models/textures
