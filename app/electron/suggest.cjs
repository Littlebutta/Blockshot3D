// v1.2.16 Suggestions (title screen button): players write what they'd like fixed or added. Each one is saved on this PC
// (Documents/Blockshot3D/suggestions/<category>/) and uploaded into suggestions/<category>/ of a separate suggestions repo
// (Devin's pick, 2026-10-15). The upload key lives in electron/suggest-target.json { "repo": "owner/name", "token": "..." }:
// a fine-grained token that can only write to that one repo, NEVER one for the update repo (anyone can read it out of the
// game files). That file ships in the Windows zip only: tools/publish-update.cjs leaves it out of the public update repo,
// where GitHub would cancel it. Without it (or if the upload fails), Send opens a filled-in GitHub issue instead.
const fs = require('fs'), path = require('path');
const REPO = 'Littlebutta/Blockshot3D';
const CATS = { bug: 'bugs', feature: 'features-content', balance: 'balance', other: 'other' };
const NAMES = { bug: 'Bug', feature: 'Feature/content', balance: 'Balance', other: 'Other' };
const LABELS = { bug: 'bug', feature: 'enhancement', balance: 'balance', other: 'question' };
const clean = (s, n) => String(s || '').replace(/\r/g, '').slice(0, n);
// The issue page the Send button opens (labels only stick for the repo's own members; the title prefix always does)
function issueUrl(cat, title, body) {
  const q = s => encodeURIComponent(s);
  let b = body; while (b.length > 200 && q(b).length > 6000) b = b.slice(0, Math.floor(b.length * 0.85)) + '\n…';
  return `https://github.com/${REPO}/issues/new?title=${q(`[${NAMES[cat]}] ${title}`)}&labels=${q(LABELS[cat])}&body=${q(b)}`;
}
function target() {
  try { const t = JSON.parse(fs.readFileSync(path.join(__dirname, 'suggest-target.json'), 'utf8')); if (t && /^[\w.-]+\/[\w.-]+$/.test(t.repo) && t.token) return t; } catch { /* not set up */ }
  return null;
}
async function upload(t, rel, text) {
  const r = await fetch(`https://api.github.com/repos/${t.repo}/contents/${rel.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t.token}`, 'User-Agent': 'Blockshot3D', Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ message: 'Suggestion: ' + rel, content: Buffer.from(text).toString('base64') }),
  });
  if (!r.ok) throw new Error('GitHub ' + r.status);
}
// Saves it, then uploads it; returns the issue page to open instead when there's no key or the upload failed
async function submit(docs, s) {
  const cat = CATS[s.cat] ? s.cat : 'other', when = new Date(), stamp = when.toISOString().replace(/[:.]/g, '-');
  const title = clean(s.title, 80).trim() || 'Untitled', slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'note';
  const text = `# ${title}\n\n- Category: ${NAMES[cat]}\n- From: ${clean(s.name, 40) || '?'}\n- Version: ${clean(s.version, 20)}\n- Date: ${when.toISOString()}\n\n${clean(s.text, 4000)}\n`;
  const file = path.join(docs, 'Blockshot3D', 'suggestions', CATS[cat], `${stamp}-${slug}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
  const t = target();
  if (t) { try { await upload(t, `${CATS[cat]}/${stamp}-${slug}.md`, text); return { saved: file, uploaded: true }; } catch { /* offline or key cancelled: issue page */ } }
  const body = `${clean(s.text, 4000)}\n\n---\nCategory: ${NAMES[cat]} · From: ${clean(s.name, 40) || '?'} · Version: ${clean(s.version, 20)}\n`;
  return { saved: file, url: issueUrl(cat, title, body) };
}
module.exports = { submit, issueUrl, CATS };
