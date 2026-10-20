// v1.2.25: right-click info popups. Any element with data-info="<key>" opens INFO[key] in a small window next to the
// cursor (main.js contextmenu handler); a click, another right-click or Escape closes it.
export const INFO = {
  budget: ['Shot budget', `<p>Big lobbies can put more shots in the air than a PC can draw. The shot budget keeps the game at a playable frame rate (10+ fps) by capping how many shots can fly at once.</p>
<p>It never deletes a shot that's already flying. When the cap gets close, whoever has the <b>most</b> shots out (counting their turrets, clones and critters) can't fire new ones until some of theirs land. Everyone else keeps shooting.</p>
<p>The bar shows shots in the air against the cap. The bright part is yours; when it fills your share you'll see <b>Can't shoot</b> until it drains.</p>
<p>The cap moves on its own: it shrinks when the host's game or anyone's frame rate slows down and grows back when things are smooth. The host can turn it off under Arena settings.</p>`],
  // v1.2.26 lobby: every mode and setting explains itself on right-click
  m_ffa: ['Deathmatch', `<p>Everyone fights everyone. Lose a round and you pick an upgrade card; first to the target score wins.</p><p>Turn <b>Teams</b> on for team deathmatch (up to 8 teams): drag players onto a team in the list. The losing team picks cards.</p>`],
  m_tourn: ['Tournament', `<p>Deathmatch rules, but every round each player fights their own 1v1 in a separate arena. You only see your own arena.</p><p>Everyone has a set number of losses (default 4). Lose your arena and you lose one; at zero you're knocked out. Losers pick a card after each round. Last one standing wins.</p><p><b>Teams:</b> arenas pair players from different teams. Win your arena and you're sent to help an ally whose fight is still on. During the card pick you can offer a card to an ally who is also picking: they trade one card from their own hand for it.</p>`],
  m_waves: ['Co-op waves', `<p>Survive waves of raiders together. The final wave brings a boss. You get one free retry per run (not on the boss wave). Beat the boss to keep going with harder waves.</p>`],
  m_core: ['Core defense', `<p>Protect the core in the middle of a flat battlefield. Enemies walk in from the edges.</p><p>Each wave starts with 60 seconds to build: press <b>E</b> to pick up and place the blocks, cubes and turrets that parachute in. Every 3rd wave drops an upgrade card for everyone. If the core falls, retry the wave or start over.</p>`],
  m_open: ['Open world', `<p>A huge map of themed zones. Jump out of the flying bus (Space) and parachute down. Colored items give a card of that rarity. E gets on a scooter, bike or car.</p><p>Battle royale: last one (or squad) standing while a red wall closes in. Extraction: the whole lobby is one squad and has to reach the extraction point.</p>`],
  m_brawl: ['Brawl', `<p>Smash style on floating stages. Hits raise your damage %, and the higher it is the farther you fly. Get knocked off screen and you lose a stock.</p><p>No card picks: your Character cosmetic is your fighter, each with its own fixed build.</p>`],
  m_amon: ['AMON', `<p>Autobattler. Buy unit groups and tactic cards in the store and arrange them on your 5x5 board; tactic cards boost the squares they reach, chess style. Each player's board fights its own copy of the wave. Round 20: Amon.</p><p>Versus: players fight each other's armies instead.</p>`],
  m_practice: ['Practice range', `<p>Add and remove any card during play from the practice panel (P) and try it on target dummies.</p>`],
  s_botDiff: ['Bot difficulty', `<p>How well the next bots you add play. You can change each bot afterwards in the list.</p>`],
  s_color: ['Your color', `<p>Pick your color. Taken colors are greyed out; picking a bot's color swaps with that bot. Team modes use team colors instead.</p>`],
  s_teams: ['Teams', `<p>Off: free for all. On: team deathmatch with up to 8 teams. Set each player's team in the list, or drag them onto a team.</p>`],
  s_tTeams: ['Tournament teams', `<p>Arenas pair players from different teams. Winning your arena sends you to help an ally whose arena is still fighting. During card picks, allies can trade cards: offer one of yours (🎁 on a card), and your ally swaps it for one from their own hand.</p>`],
  s_tLives: ['Losses before you\'re out', `<p>How many arenas you can lose before you're knocked out of the tournament (like team health in AMON). A draw costs nobody a loss.</p>`],
  s_rounds: ['Rounds to win', `<p>Round wins needed to take the match. In co-op modes, the number of waves to survive.</p>`],
  s_roundMods: ['Round modifiers', `<p>A special rule for the round (Low Gravity, One-Hit Kills, Rapid Fire and so on), shown on the round splash. Random picks a new one every round; or pick one to always play with.</p>`],
  s_owType: ['Open world type', `<p>Battle royale: last one (or last squad) standing while a red wall closes in. Extraction: the whole lobby is one squad and has to reach the extraction point.</p>`],
  s_owBots: ['Roaming bots', `<p>World bots that roam the map and hunt players.</p>`],
  s_owSquads: ['Squads', `<p>Battle royale in the lobby teams instead of everyone for themselves.</p>`],
  s_waveDiff: ['Difficulty', `<p>Sets the Game Master's wave budget, enemy toughness, how often Elites appear and how hard the final boss hits.</p>`],
  s_coopScale: ['Scale to squad size', `<p>How much tougher the waves and boss get for each extra player or bot on your side. Off sizes them for one.</p>`],
  s_gmSpawn: ['Enemy arrival', `<p>Whether enemies arrive in groups or all at once. Game Master chooses each wave; critters and turrets always trickle in.</p>`],
  s_amonVs: ['AMON opponents', `<p>Raider waves: everyone fights the same waves together. Versus: players fight each other's armies every round (teams fight together).</p>`],
  s_amonCmd: ['Commanders', `<p>Everyone picks a commander before the first store. Each has its own power and unit cards.</p>`],
  s_amonTimer: ['Store timer', `<p>Wait for Ready: the battle starts when everyone is ready. 75 seconds: the store closes after that anyway.</p>`],
  s_ff: ['Friendly fire', `<p>Bullets can hurt teammates.</p>`],
  s_side: ['2D side view', `<p>Flat camera with ROUNDS-style maps: drop-through platforms, swinging platforms and a damaging edge all around. A / D move, W or Space jumps, the mouse aims anywhere. Block as you touch an edge to bounce off it.</p>`],
  s_stocks: ['Stocks', `<p>Lives per round in Brawl.</p>`],
  s_brawlFlat: ['Flat stages only', `<p>Only flat, wide Brawl stages.</p>`],
  s_brawlItems: ['Item boxes', `<p>Item boxes drop onto the stage now and then: Bandage, Power Glove, Anvil, Sneakers and Spring.</p>`],
  s_dummies: ['Target dummies', `<p>How many dummies stand in the practice range.</p>`],
  s_dummyMode: ['Dummies', `<p>Whether the dummies stand still, walk around or fight back.</p>`],
  s_dummyHp: ['Dummy health', `<p>Each dummy's health.</p>`],
  s_god: ['You can\'t die', `<p>You take hits but never go down in the practice range.</p>`],
  s_rerolls: ['Rerolls', `<p>How many times per match each player can swap their hand for a new one.</p>`],
  s_pickTime: ['Pick time', `<p>Seconds to pick a card before one is picked for you.</p>`],
  s_combos: ['Combo cards', `<p>Matching pairs of cards merge into something new. Cursed cards and weapon mods are always in the deck (both very rare).</p>`],
  s_speed: ['Speed mode', `<p>Two card picks per pick phase: take one card, the hand refreshes, take another.</p>`],
  s_maps: ['Maps', `<p><b>Mixed:</b> a bit of everything. <b>Random generated:</b> new layouts in rectangles, hexagons, octagons and other outlines. <b>Classic:</b> hand-made layouts. <b>Trap arenas:</b> crushers, spikes, lasers, rails and pistons.</p><p><b>Shaped:</b> Star (a leg per player), Cross, Ring, Flower, Wheel, Pods (a round room per player joined by corridors), Hive (hexagon rooms with doorways) and Bowtie (two halves joined by a narrow waist). Arena size grows with the number of players.</p>`],
  s_themes: ['Map themes', `<p>Which looks maps can have. Extra themes: castle, western, candy, forest, tundra, neon, sakura, tropical, lunar, volcano. Or pick just one.</p>`],
  s_mapLava: ['Lava Lake maps', `<p>In Mixed: floating platforms over a lava floor can come up.</p>`],
  s_mapIce: ['Ice Sheets maps', `<p>In Mixed: ice floes on freezing water can come up. Small floes sink, medium ones tip.</p>`],
  s_commander: ['Commander', `<p>You pick the cards and a bot fights for you. Unlocks unit cards. You can pan the camera like when spectating.</p>`],
  s_hazards: ['Map hazards', `<p>Random rounds get a laser, saws or a rogue turret.</p>`],
};

let pop = null;
export function closeInfo() { if (pop) { pop.remove(); pop = null; } }
export function infoOpen() { return !!pop; }
export function openInfo(key, x, y, extra) {
  closeInfo();
  const it = INFO[key] || (extra ? [extra.title, extra.html] : null);
  if (!it) return false;
  pop = document.createElement('div');
  pop.className = 'infopop';
  pop.innerHTML = `<div class="ipHead">${it[0]}<span class="ipX">✕</span></div><div class="ipBody">${it[1]}</div>`;
  document.body.appendChild(pop);
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, x + 12)) + 'px';
  pop.style.top = Math.max(8, Math.min(innerHeight - h - 8, y + 12)) + 'px';
  pop.addEventListener('mousedown', e => e.stopPropagation());
  pop.querySelector('.ipX').addEventListener('click', closeInfo);
  return true;
}
addEventListener('mousedown', () => closeInfo());
addEventListener('keydown', e => { if (e.key === 'Escape') closeInfo(); });
