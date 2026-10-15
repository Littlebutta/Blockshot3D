// AI slop filter (Settings). Purely cosmetic and local: it never changes the match for anyone else.
// Text gets rewritten like overexcited generated content, a fake assistant keeps "helping",
// a free-trial watermark drifts around and the cursor sheds sparkles.
let on = false, layer = null, bubbleT = 6, wmEl = null, sparkleT = 0;

const WRAP = [
  t => `✨ ${t} ✨`, t => `🚀 Unleashing ${t} 🚀`, t => `Delving into ${t}`, t => `${t}: a testament to synergy`,
  t => `In today's fast-paced arena, ${t}`, t => `${t} — and that's not just a game, it's a journey`, t => `🔥 ${t} (Ultra HD 8K) 🔥`,
  t => `Certainly! Here's ${t}`, t => `${t}. Let's dive in! 🤿`, t => `${t} — a tapestry of possibilities`, t => `Great question! ${t}`,
  t => `${t} 💯 #blessed #grindset`, t => `As an AI language model, ${t}`, t => `${t} (hyper-realistic, trending on ArtStation)`,
  t => `🧠 Big brain moment: ${t}`, t => `${t} — I hope this helps! 😊`, t => `Absolutely! ${t} — game-changer!`, t => `${t}, seamlessly elevated`,
  t => `${t} 🙌 Thoughts? Agree? 👇`, t => `It's important to note that ${t}`, t => `${t} ✅✅✅`, t => `In conclusion, ${t}`,
];
const JOKES = [
  'As a large language model, I cannot feel bullets, but I can describe them in 4K.',
  'Fun fact: this round is 37% more synergistic than the last one. Source: vibes.',
  'I have generated 14 extra fingers for you at no additional cost.',
  'Tip: shooting the enemy is a great way to defeat them! Let me know if you need more tips.',
  'Your aim has been optimized by our proprietary Aim-Tech™ (it has not).',
  'I apologize for the confusion. The bullets were real the whole time.',
  'Would you like me to rewrite this match in the style of a LinkedIn post?',
  'Reminder: you are 1 of 1 million players I am talking to right now. You are special.',
  'Here are 10 reasons you lost: 1. The other player shot you. 2–10. Synergy.',
  'Upgrade to Slop+ Pro Max to unlock a 9th googly eye.',
  'I counted the fingers. There are seven. That is the correct number of fingers.',
  'This message was generated in 0.0003 seconds and reviewed by nobody.',
  'Let\'s circle back on that headshot and touch base after the respawn.',
  'Pro tip: blocking blocks. You\'re welcome.',
  'I made the arena rainbow. You didn\'t ask. That\'s called initiative.',
  'Context window full. Forgetting who the enemy is… done!',
  'Fact check: the cake was a lie, but this upgrade card is 100% real (probably).',
  'Generating a heartfelt motivational quote… "Shoot, and you shall hit." — Steve Jobs (not)',
];
const BADGES = ['AI-Enhanced', 'Hyper-Real', '8K', 'Now with Blockchain', 'Ethically Sourced Pixels', 'Synergy+', 'Award-Winning', 'Limited Edition'];
const TYPOS = [[/ma/g, 'mna'], [/age/g, 'agae'], [/ed\b/g, 'eded'], [/the /g, 'teh '], [/ing\b/g, 'ign'], [/ullet/g, 'ulllet']];
const pick = a => a[Math.floor(Math.random() * a.length)];

export function slopify(text) { return on && text ? pick(WRAP)(text) : text; }
export function slopVerb() { return pick(['embarked on a journey to eliminate', 'delved into', 'leveraged', 'synergized', 'disrupted', 'pivoted away', 'circled back on', 'monetized', 'optimized out of existence', 'gently unalived (8K)']); }
export function slopCardName(name) { return on ? `✨ ${name} ${pick(['™', '®', 'Pro', 'Max', 'Ultra', '2.0', 'GPT'])}` : name; }
export function slopBadge() { return pick(BADGES); }
// Small typos, like text in a generated image.
export function slopTypos(text) { if (!on || !text) return text; let s = text; for (const [re, r] of TYPOS) if (Math.random() < 0.5) s = s.replace(re, r); return s; }

function bubble(text) {
  if (!layer) return;
  const b = document.createElement('div'); b.className = 'slopbubble';
  b.innerHTML = `<div class="av">🤖</div><div><b>SlopGPT</b><p></p><small>Regenerate ↻ · 👍 👎 · Copy</small></div>`;
  b.querySelector('p').textContent = text;
  layer.appendChild(b);
  setTimeout(() => b.classList.add('out'), 6500);
  setTimeout(() => b.remove(), 7200);
}
function sparkle(x, y) {
  if (!layer || layer.childElementCount > 80) return;
  const s = document.createElement('span'); s.className = 'sparkle';
  s.textContent = pick(['✨', '⭐', '💫', '🌈', '💯', '🔥']);
  s.style.left = x + 'px'; s.style.top = y + 'px';
  s.style.setProperty('--dx', ((Math.random() - 0.5) * 60).toFixed(0) + 'px');
  layer.appendChild(s); setTimeout(() => s.remove(), 900);
}
export function slopInit() {
  layer = document.getElementById('slopLayer');
  addEventListener('mousemove', e => { if (!on || performance.now() < sparkleT) return; sparkleT = performance.now() + 45; sparkle(e.clientX, e.clientY); });
  addEventListener('click', e => { if (!on) return; for (let i = 0; i < 6; i++) sparkle(e.clientX + (Math.random() - 0.5) * 40, e.clientY + (Math.random() - 0.5) * 40); });
}
export function setSlop(v) {
  on = !!v;
  document.body.classList.toggle('slop', on);
  if (!layer) return;
  if (on && !wmEl) {
    wmEl = document.createElement('div'); wmEl.className = 'slopwm';
    wmEl.textContent = 'Generated with SlopGPT Pro™ · FREE TRIAL (3 days left) · shutterstock';
    layer.appendChild(wmEl);
    bubble('Hi! I noticed you turned on the AI slop filter. Would you like help with that? 😊');
  }
  if (!on) { layer.innerHTML = ''; wmEl = null; }
}
// Called every frame.
export function slopTick(dt) {
  if (!on) return;
  bubbleT -= dt;
  if (bubbleT <= 0) { bubbleT = 11 + Math.random() * 9; bubble(pick(JOKES)); }
}
export function slopOn() { return on; }
