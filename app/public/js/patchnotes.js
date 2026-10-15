// v1.2.16: what changed in each update, for the title screen's Patch list (newest first). Add the new version at the top
// with every release; the window shows the first few as tabs and always opens on the newest.
export const PATCHES = [
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
