// v1.2.16: what changed in each update, for the title screen's Patch list (newest first). Add the new version at the top
// with every release; the window shows the first few as tabs and always opens on the newest.
export const PATCHES = [
  { v: '1.2.34', date: 'Oct 22', notes: {
    Changed: [
      'Spawns are spread through the whole map, not just along the walls, in every game with 3 or more players or teams. Everyone gets about the same share of open ground, clear of blocks and traps, and teammates still start together.',
      'Because nobody needs room on the walls any more, maps past 8 players are smaller: about 94 x 64 m at 20 players (was 102 x 70) and 192 x 132 m at 100 (was 270 x 186). Fights find you sooner in big lobbies.',
    ],
  } },
  { v: '1.2.33', date: 'Oct 22', notes: {
    Added: [
      'RTS: a second faction, the Hive. Pick it next to your name in the lobby (bots can be set to Steelborne, Hive or Random). Bug-like aliens that only use crystal (the blue one): no flux, no refineries.',
      'The Hive\'s troops hatch in broods: one order gives 4 Skitters, 3 Spitters, 2 Ravagers, 2 Crushers or 3 Wasps. Buildings: Brood Nest, Hive Node, Spawning Pit, Acid Spire, Gene Vault (card research, paid in crystal), Brood Chamber, Sky Roost.',
      'The hive network: each Brood Nest (22 m) and Hive Node (16 m) shows a purple ring on the ground. Hive buildings (except a new Nest) go up inside it. Units outside the network have a 5% chance every second to go feral: they leave you and attack anyone who isn\'t feral. Chain Hive Nodes to take your swarm further.',
    ],
    Changed: [
      'RTS runs on its own CPU threads now (like the other modes since 1.2.30), with path finding on any spare cores: in an 8-bot game the drawing thread went from about 10 to 2.6 ms a frame, and the long pauses when big armies moved are gone. Settings > Graphics > CPU threads = 1 keeps the old way.',
      'RTS: more units: the supply cap is 300 (was 200; 240 and 200 in 5-6 and 7+ player games, were 160 and 130), and the unit budget lets each player keep at least 40 units (was 24).',
      'RTS: every Steelborne unit costs about 30% less (Trooper 35 crystal, was 50).',
    ],
  } },
  { v: '1.2.32', date: 'Oct 22', notes: {
    Changed: [
      'Big solo matches no longer run in slow motion: every bot death paused time for a moment (the hit-stop meant for duels), which with 100 bots slowed the whole match to about 75% speed. In lobbies over 8 players only your own kills and deaths do it now.',
      'Shot budget is calmer: it goes by how many frames you actually got in the last half second (one long frame no longer counts as a slow game), waits half a second of real slowness before cutting (unless under 20 fps), and cuts less at once. In 1.2.31 every hitch made it hold back shots.',
    ],
  } },
  { v: '1.2.31', date: 'Oct 22', notes: {
    Added: [
      'No player limit: add as many bots and players as you like (new +100 bots button in the lobby). Steam lobbies hold up to 250 people, Steam\'s own maximum.',
    ],
    Changed: [
      'Smoother big matches: the regular dropped frame every quarter to half second in 100-bot matches is fixed. It was the browser pausing to clean up memory: the match view now crosses from the game thread packed, and the kill-cam recorder no longer copies every fighter every frame (about 60% less memory churn at 100 players).',
      'Shot budget reacts much faster: it checks four times a second using the current frame rate (it used to look back 2 seconds) and cuts in step with how slow things are (at 15 fps it halves the shots allowed at once), so heavy fights hold 30 fps instead of sinking first. While a match is running slow, cards don\'t add new critters or afterimages either.',
      'Clone card: half the block cooldown penalty (x1.6, was x3.2). Only the fighter you control can split: clones no longer make more clones.',
    ],
  } },
  { v: '1.2.30', date: 'Oct 22', notes: {
    Added: [
      'Settings > Graphics > CPU threads: how many CPU threads the game may use. Auto (the default) uses every core your PC has; 1 runs everything on one thread like before.',
    ],
    Changed: [
      'Multithreading: when you host (or play solo), the match itself now runs on its own CPU thread: the simulation, the bots\' thinking and the updates sent to everyone. Your main thread only draws, so the frame rate holds up much better in big matches (100 players: about 40% less work per frame on the drawing thread). Works in every mode except AMON and the RTS (those come later). Your own view of the match is about one frame behind your inputs when it\'s on; set CPU threads to 1 if you\'d rather not have that.',
      'Network window (N / F2) shows whether the game thread is on and how long the match takes to come back.',
    ],
  } },
  { v: '1.2.29', date: 'Oct 22', notes: {
    Added: [
      'Tournament: a Ready button on the matchup screen, next to the timer (Enter still works, now from any menu too).',
    ],
    Changed: [
      'Wall and block textures keep the same size and shape everywhere instead of stretching to fit each wall, tops included.',
      'Blocks of the same height that touch read as one shape: no colored outline along the seams between them.',
      'Team tournaments: the whole team shares one loss count, and the team only loses a life when every player on it lost their arena.',
      'Squid bullets have a flat drawn mouth that opens and chomps, matching the simple squid model.',
    ],
    Fixed: [
      'Tournament: the end of each round no longer says "Draw"; it says whether you (or your team) won the round or lost a life.',
      'Tournament: health drain, burns and other effects no longer tick during the matchup screen before the round.',
      'Tournament: opening the pause menu during the matchup screen shows the menu instead of hiding it behind the matchup screen.',
      'Tournament: the pick screen, pause menu and after-match screen show the red loss pips too.',
      'Tournament: Keep playing works (everyone gets that many more lives, the knocked out come back).',
    ],
  } },
  { v: '1.2.28', date: 'Oct 21', notes: {
    Added: [
      'The GUI now scales itself to your screen resolution and aspect ratio (from 16:9 up to 32:9 ultrawide). The GUI scale slider in Settings works on top of that.',
      'Tournament: before each new matchup, a 15 second intro shows your opponent\'s model on the left and their cards on the right (Enter: ready). In team tournaments you skip it when you join an ally\'s match after yours is over.',
      'RTS: every expansion site is revealed on the map from the start, so you can see where to expand.',
      'RTS: cards can be taken off a unit type again (the ✕ next to each upgrade in Research) so you can move upgrades around.',
    ],
    Changed: [
      'Tournament pips now count losses: red pips under your name, and your current opponents are listed right under you.',
      'Team colors now follow the players\' own colors as closely as possible when teams are set up.',
      'Lobby: the bot buttons and the rest of the lobby no longer move when players are added or removed.',
      '100 player matches: fighters far from the camera are drawn as light stand-ins, and the shot budget kicks in sooner, so big lobbies hold their frame rate. Players and bots now spawn spread evenly over the whole map.',
      'Bots find their way around shaped maps much better (a walking map of the floor), and get stuck less in big lobbies.',
      'RTS: the mouse stays inside the game window in windowed mode too, not only in fullscreen (Settings can turn this off).',
      'RTS: bigger bases and maps (232 m for 2 players up to 384 m for 8), four height levels instead of three.',
      'RTS: each unit type can carry up to 4 cards (Riggers any number); the Archive and Research panel say so.',
      'RTS: smoother terrain (rounded cliffs and slopes) and soft fog of war edges.',
    ],
    Fixed: [
      'Moving the music or any other volume slider no longer changes the size of the GUI (your saved GUI scale is now applied at start).',
      'RTS: units no longer get stuck on ramps when the target is to the side of the ramp.',
    ],
  } },
  { v: '1.2.27', date: 'Oct 20', notes: {
    Added: [
      'RTS mode (experimental; new mode tile in the lobby): real-time strategy for 2 to 8 players and bots, in the spirit of StarCraft, C&C Generals and Battle for Middle-earth. Build a base, mine, train an army and destroy every enemy building.',
      'First faction, The Steelborne: Riggers (workers that build on site and repair), Troopers, Lancers, Medics, cliff-jumping Vaulters, flamethrower Striders, Siege Crawlers with siege mode, Hornet jets, Spotter drones and Gunships. Buildings: Command Hub, Supply Depot, Refinery, Reclaimer, Barracks, Sentry Tower, Archive, Factory and Airfield.',
      'Resources: crystal fields that run dry and flux vents (build a Refinery on one), like StarCraft. Plus endless slow income like Generals: capture derricks on the map with infantry, or build Reclaimers.',
      'Research with cards: an Archive pulls 3 cards from the shooter\'s card pool; fit the one you take to any unit type and every unit of that type gets it, now and later. Keep cards in your hand for later.',
      'Randomly generated highland maps, much bigger than the arenas (208 m across for 2 players up to 344 m for 8; Small and Large in the lobby). Three cliff levels joined by ramps, hills, trees and rocks, open fields for battles, expansions, derricks and watchtowers.',
      'StarCraft vision: fog of war, explored ground stays dim, buildings are remembered where you last saw them, and you can\'t see up a cliff until something of yours is up there (air units see everything). Watchtowers show the area around them while you stand next to them. The Recon Flare lights up any spot.',
      'RTS controls and HUD: box select, double-click or Ctrl-click for all of a type, Shift to queue orders, control groups, attack-move, patrol, hold, a 3x5 command card with hotkeys and tooltips, a minimap you can click and right-click, idle worker and army buttons, alerts with Space to jump to them, rally points, production queues and an end screen with stats.',
      'Fullscreen (F11) keeps the mouse inside the window with a drawn cursor, so pushing against a screen edge always pans the camera. Settings has a switch for it.',
      'Unit budget: big armies are capped when the game gets slow, holding the players with the most units first (right-click the unit bar for details). Lobby switch to turn it off.',
      'Bots (easy, normal, hard) play the RTS: they expand, research, capture derricks and attack in waves. A player who leaves is replaced by a bot until they rejoin.',
    ],
    Changed: [
      'Shot budget has no fixed cap any more (it started at 700). Nothing is limited while the host and every player run at 30 fps or better; a cap only appears when someone drops under 30, and goes away again after a few smooth seconds. The RTS unit budget aims for 30 fps too. A window in the background no longer counts as a slow player.',
      'Right-click Shot budget in the lobby for an estimate of how many shots and entities a match with the players in the lobby puts in play.',
      'Lobby: the left-hand panel with your color and the bot buttons is back, next to the player list and the new mode tiles. People are listed above bots, so friends joining are easy to spot.',
      'Mode tiles use simple line icons instead of emoji.',
    ],
  } },
  { v: '1.2.26', date: 'Oct 20', notes: {
    Added: [
      'Tournament mode: deathmatch rules, but every round each player fights their own 1v1 in a separate arena (an odd player out makes one arena a 3-way). You only see and hear your own arena. Everyone has a set number of losses (default 4, 1 to 10 in the lobby); lose your arena and you lose one, at zero you\'re knocked out. Losers pick a card after each round. Last one standing wins.',
      'Tournament teams: arenas pair players from different teams. Win your arena and you\'re sent to help an ally whose fight is still on. During the card pick, press 🎁 on a card to offer it to an ally who is picking too; they trade one card from their own hand for it (or decline). Works with Speed mode\'s extra picks.',
      'Tournament HUD: your lives, how many arenas are still fighting and how many players are left. Out of the round, press Use (E) to watch another arena.',
      'Three new map shapes: Pods (a round room per player around a middle room, joined by corridors), Hive (hexagon rooms with doorways) and Bowtie (two halves joined by a narrow waist). Pick one in the lobby or let Shaped / Mixed choose.',
    ],
    Changed: [
      'Lobby redesign: modes are big icon tiles with one short line about the chosen mode, and the settings sit in three tabs (Match, Cards, Arena) as short rows. Right-click any mode or setting for a window that explains it.',
      'Commander mode: pan and zoom the camera like when spectating (move keys or drag, scroll to zoom, Jump to follow the fight).',
      'Wasp drones fly slower.',
    ],
    Fixed: [
      'Players sometimes teleported back to their spawn: a big launch (Thrust, explosions) that took you above 40 m, or past the arena edge, triggered a safety reset. Now you hit an invisible ceiling or get pushed back inside instead.',
      'With SCP, bees, squid and any other shot of yours that gets blocked back at you still count as yours: they can still go for you, but do no damage. Overpen fragments of a reflected shot keep the original shooter too.',
      'A clone, twin, drone, turret or critter left standing wins the round for its owner. When only units of different players are left and nobody has dealt damage for 10 seconds (turrets that can\'t reach each other), the round is a draw.',
    ],
  } },
  { v: '1.2.25', date: 'Oct 20', notes: {
    Added: [
      'Lobbies hold up to 100 players. The lobby has +10 and Clear bots buttons.',
      'Shot budget: in big lobbies there is a cap on how many shots can be in the air at once, so the game stays playable (it aims for at least 10 fps and leaves plenty of room above that). It never deletes a shot that is already flying. When the cap gets close, the players with the most shots out (their turrets, clones and critters count too) can\'t fire new ones until some of theirs land. You see a "Can\'t shoot" notice when it stops you.',
      'Shot budget bar at the top middle: shots in the air against the cap, with your own share as the bright line. Right-click it for an explanation. The cap adapts by itself, shrinking when the host\'s game or anyone\'s frame rate slows down and growing back when it\'s smooth. Turn it off in the lobby under Arena.',
      'Right-click info popups: things marked with them show what they do when you right-click them.',
    ],
    Changed: [
      'Four optimization passes for big lobbies. Game time per step: 50 players 12.4 ms to 4.4 ms, 100 players 63 ms to 14 ms (same bots, cards and map). Wall and box collision uses a grid on every map; sight lines only check the boxes they pass; bullets only check nearby players and shields; bots share their route searches and skip far-off options.',
      'Plain bullets draw as one batch when there are lots of them, instead of two draw calls per bullet.',
      'Big lobbies send fewer, fuller updates (30 a second up to 30 players, 20 up to 60, 15 above), which keeps each player\'s connection and the host\'s upload in check.',
      'Big lobbies: the scoreboard shows the top 10 and you plus a count of the rest; the card pick screen\'s player columns scroll.',
    ],
  } },
  { v: '1.2.24', date: 'Oct 20', notes: {
    Added: [
      'AMON commanders: before the first store everyone picks a commander, with no time limit (co-op and Versus; turn it off in the lobby). 36 to choose from: the leader of every enemy faction plus 18 new ones.',
      'Every commander has a passive bonus for all your units, its own unit cards that only show up in your store (enemy troops fighting for you), and a power it uses on its own in every battle: air strikes, storms, heals, rallies, shield walls, freezes, reinforcements, turncoats, snipes, quakes and more.',
      'AMON players panel (right side): everyone\'s commander, health (Versus) or army points and who is ready. Click a player to watch their field in battle, or their board in the store.',
      'Knocked out of AMON Versus: you keep watching, the store view follows the players still in, and you can switch between their fields and boards.',
    ],
    Changed: [
      'AMON card text audit: tactic cards say what they reach and what they give in short form ("Row + column: +80% damage, +3.6 m range"), and Holy / Cursed cards show their own numbers.',
      'AMON hover tips are much shorter (what it is, its numbers, its points); the rest (combat details, board bonuses, squadmates, how to use it) moved to the right-click details.',
    ],
  } },
  { v: '1.2.23', date: 'Oct 20', notes: {
    Added: [
      'Brawl item boxes drop onto the stage now and then: Bandage (-35%), Power Glove (hits launch farther), Anvil (heavier), Sneakers (faster) and Spring (higher jumps), 8 s each. Turn them off in the lobby (Item boxes).',
      'Five new Brawl stages: Canopy, Island Hop, Clocktower, Conveyor and Ruins.',
      'Core Defense: hold the use key next to the core to pick it up and carry it somewhere else (you move slower), press again to set it down. Raiders path to wherever it is.',
    ],
    Changed: [
      'Brawl HUD redone: fighter cards with a badge, a big damage % that shakes when hit, stock pips, round wins and the active power-up; your own card shows whether your air jump and dash are ready. The sudden death clock sits at the top.',
      'Brawl fighter builds rebalanced from hundreds of bot fights: Phantom Blade, Deep Diver, Bulwark and Overcharge lost a card each (they won 75-93% of fights); Fire Dancer, Star Caller, Rubber Ducky, Rushdown, Spore Lord and Bouncer got extra cards.',
      'Brawl balance: weight is capped, so huge-health builds still get launched (and very light ones aren\'t launched quite as far).',
      'Core Defense placing is more forgiving: longer reach to pick up and catch, place farther away, stack higher, and a piece that would just clip the edge of another slides off it onto the ground instead of perching on top.',
      'Core Defense: enemies never spawn near the core, wherever it is (also when it sits in a corner).',
    ],
  } },
  { v: '1.2.22', date: 'Oct 20', notes: {
    Added: [
      'Squid rework: squid now have little mouths, latch onto whoever they reach and gnaw on them (24% of their damage every 0.45 s for up to 3.6 s), healing you. Mash jump or block to knock them off; shaking them off stuns them before they hunt again. A warning shows when one is on you. They can\'t bite through shields, and a blocked squid turns on whoever blocked it.',
      'Behemoth (legendary): +175 health and +14 regen a second; you grow to match.',
      'Big Brother replaces Space King: charge for about 9 s (was 17) and a giant, slow copy of you with your gun and cards fights on your side.',
      'Pinch Alley trap arena: horizontal pistons slam together and kill anyone caught between them.',
      'Shaped arenas: Star (one leg per player), Cross, Ring, Flower and Wheel. Pick Star or Shaped arenas in the lobby\'s maps option; they also turn up now and then in Mixed.',
    ],
    Changed: [
      'Bees and Squid are weapon mods now (you keep your normal gun model).',
      'Stomping crushers are see-through, so you can see yourself underneath from the top-down view.',
      'Pillar Shield: the pillar is taller, the shield only wraps the top where you stand, and its health scales much harder with Block size and Block duration (300 base).',
      'Katana: a full charge fires the slash wave by itself and starts charging the next while you hold; holding only starts to count as charging after a short moment, so quick melee slashes are never turned into waves.',
      'Big lobbies get bigger maps, and spawns stay further apart (extra rings of spawns inside very big maps).',
    ],
  } },
  { v: '1.2.21', date: 'Oct 16', notes: {
    Added: [
      'Emote wheel is customizable: Shop & Customize > Emote wheel. Pick a slot, then an emote. 28 new emotes in the shop plus two new team pings.',
      'Spectators can emote; their emotes show in the kill feed for everyone.',
      'Max screen shake slider (Settings > General): the camera never shakes past it, however crazy the fight gets.',
      'Card details: a highlighted "Boosted by" row at the top shows which stats make the card stronger.',
      'Other players\' cards window: right-click a player (or the window) to keep it open until you click back into the game.',
    ],
    Changed: [
      'Round modifier splash is bigger, easier to read and stays longer; the modifier tag at the top shows its full text for a while afterwards and whenever you hover it, dead or alive.',
      'Emote wheel: Q by default (rebindable in Controls); middle mouse no longer opens it unless you bind it.',
      'Death recap stays up until the round ends.',
      'Bulwark is now uncommon and gives a smaller cooldown cut (x0.72, was x0.6).',
      'Iron Lung: +65 health (was +40), reloads only x1.2 slower (was x1.4).',
      'Seeker Chip turns much more gently (2 instead of 5) and now keeps 70% damage; stack it to lock on harder. Orbital strikes keep their homing.',
      'Venom Rounds: bullets keep their damage and poison on top (poison share 22% of max health, was 40% with no bullet damage).',
      'Match over: wins are in the damage/kills/deaths table (one table instead of two) and the table scrolls inside its box so the buttons stay visible.',
      'Sentry Unit, Twin Protocol (now legendary) and Wasp Drones are in the normal card pool, not just Commander mode.',
    ],
    Fixed: [
      'Other players\' cards window closing while the mouse was still on it.',
    ],
  } },
  { v: '1.2.20', date: 'Oct 15', notes: {
    Added: [
      'Gun Nest: whoever mans the turret gets a small shield. Hits on it damage the turret instead of you, until the turret is destroyed.',
      'Card details (right-click a card): a new Stacking & synergy section on how the card\'s stats stack, what makes them stronger, what they make stronger, which cards pair with it and which combos it is part of.',
      'Bees chasing you turn red on your screen.',
      'The end-of-round replay now opens and closes with a REPLAY wipe, and has a scanline look so it never reads as live play.',
    ],
    Changed: [
      'Gun Nest turret health now scales with your blocking stats: Block size, Block duration and a shorter Block cooldown add health (half to 4x your max health).',
      'Squid bullet tentacles grow longer and thicker with Bullet size.',
    ],
  } },
  { v: '1.2.19', date: 'Oct 15', notes: {
    Fixed: [
      'Add to Steam: Play said "launch unavailable". The Steam that the button restarted could not launch the game; it now restarts normally. Press Add to Steam once more to fix an existing entry.',
    ],
    Changed: [
      'Pressing Add to Steam again checks the Steam entry (right .exe, folder and artwork) and repairs it, or tells you it is already linked. An entry from a folder the game was moved out of gets pointed at the current one.',
    ],
  } },
  { v: '1.2.18', date: 'Oct 15', notes: {
    Fixed: [
      'Add to Steam: it closed Steam and added nothing. The game is now added first, then Steam restarts on its own and shows it with its artwork. Restart Blockshot 3D afterwards so multiplayer reconnects to Steam.',
    ],
  } },
  { v: '1.2.17', date: 'Oct 15', notes: {
    Added: [
      'Add to Steam button (top left of the menu): puts Blockshot 3D in your Steam library with its own artwork. Steam closes and reopens if it is running.',
      'Anti-aliasing: MSAA 8x and Supersampling (best edges, heaviest).',
    ],
    Changed: [
      'Graphics optimization: ambient occlusion, ray tracing and reflections no longer draw the whole scene again for each effect. Ray tracing went from about 4x the draw calls of normal graphics to under 2x, and ambient occlusion costs only a few screen passes now.',
      'Changing a graphics setting no longer rebuilds every effect from scratch, so small changes hitch much less.',
      'The automatic resolution drop during heavy fights no longer see-saws up and down (the "drops to 40, creeps back to 60" with ray tracing).',
      'Less bloom overall, and much less on light-colored maps.',
      'The end-of-round kill cam now shows the winner\'s own view: first person, over the shoulder or overhead.',
    ],
    Fixed: [
      'Super Saiyan Hair sits on the head of every character (on most it was down at their feet).',
    ],
  } },
  { v: '1.2.16', date: 'Oct 15', notes: {
    Added: [
      'Patch list (this window): what changed in the last few updates.',
      'Suggestions button next to the Patch list: write a bug report or idea, pick a category, and it opens as a GitHub issue on the game page (needs a GitHub account; a copy is saved in Documents/Blockshot3D/suggestions).',
      'GUI scale slider in Settings > Graphics: makes the menus and HUD bigger or smaller.',
      'Updates now install themselves when you open the game: an update screen shows while it downloads, then the game restarts on its own. (In a lobby or a match it waits for you.)',
    ],
    Changed: [
      'Bees card: the bullets are now little bees with stripes and see-through wings, smaller and no longer blinking, so they block less of the view.',
      'Every map theme is on by default. The lobby\'s theme option now has "Extra themes off" to go back to the standard ones.',
    ],
    Fixed: [
      'The picture could freeze on the last frame after Alt+Tab or taking a screenshot, while the game kept running underneath. It now keeps drawing (every mode).',
      'Alt+Tab no longer switches between first and third person.',
    ],
  } },
  { v: '1.2.15', date: 'Oct 15', notes: {
    Added: [
      '29 new cards and 8 new combos that mix them with older cards. Every one has holy and cursed versions.',
      'Round modifiers (lobby setting): a special rule each round, such as Low Gravity, Bouncy Walls, Double Speed or One-Hit Kills. 15 in all.',
      'Kill cam: the round-winning kill replays from the killer\'s eyes (turn it off in Settings > General).',
      '4 trap arenas: Crusher Hall, Spike Garden, Laser Grid and Rail Yard. They come up in Mixed and Classic maps, or pick "Trap arenas only".',
      'Emote and ping wheel: hold Q or middle mouse. Pings mark a spot for your team in team and co-op modes.',
    ],
    Fixed: [
      'Players who joined someone else\'s game mispredicted gravity in the 2D side view.',
    ],
  } },
  { v: '1.2.14', date: 'Oct 15', notes: {
    Added: [
      'Scroll the mouse wheel to zoom the top-down view (up to about twice as far out). The game remembers your zoom.',
    ],
    Fixed: [
      'SCP now ignores your own shots even after an enemy blocks them back at you: bullets, bees and squid, explosions, napalm, toxic clouds, limpets and chain lightning.',
    ],
  } },
  { v: '1.2.13', date: 'Oct 15', notes: {
    Added: [
      'Brawl: air dash has its own key (F).',
      'Tiki gets the Repulsor block.',
      'AMON: vote to speed battles up to 4x, rotating Versus matchups, uncapped card levels and an army bar in Versus.',
    ],
    Changed: [
      'When every player is down, a surviving Space King, turret, Gun Nest or critter wins the round for its owner.',
      '1-second shield when you spawn and when Phoenix brings you back. The camera stays on you during Phoenix.',
      'A ring by your ammo pips shows when your block is ready.',
      'Super Saiyan Hair has 3x the health.',
      'Knockback is now called Thrust and leaves an orange push streak.',
      'Brawl: W no longer jumps.',
    ],
  } },
  { v: '1.2.12', date: 'Oct 15', notes: {
    Changed: [
      'Multiplayer sends less data again (third network efficiency pass), so games over the internet stay smoother.',
    ],
  } },
];
