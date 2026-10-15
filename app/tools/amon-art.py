#!/usr/bin/env python3
# Art for AMON's hand-made tactic cards (art/amon/<id>.png, 700x500, same flat style as tools/card-art.py):
# the card's reach pattern on a little 5x5 board on the left, a glyph for what it does on the right.
#   python3 tools/amon-art.py
import importlib.util, math, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('cardart', os.path.join(HERE, 'card-art.py')); ca = importlib.util.module_from_spec(spec); spec.loader.exec_module(ca)
D, mix, WHITE, DARK = ca.D, ca.mix, ca.WHITE, ca.DARK
ROOT = os.path.join(HERE, '..')
OUT = os.path.join(ROOT, 'art', 'amon')
RAR = {1: 'common', 2: 'uncommon', 3: 'rare', 4: 'combo', 5: 'legendary', 6: 'legendary'}
GOLD, RED, GREEN, BLUE = '#ffd166', '#e0464b', '#5fe3a1', '#7fc8ff'

def cells(pattern, r=2, c=2, N=5):
    out = set()
    def add(y, x):
        if 0 <= y < N and 0 <= x < N and not (y == r and x == c): out.add((y, x))
    rook, bish = [(1, 0), (-1, 0), (0, 1), (0, -1)], [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    ray = lambda dirs: [add(r + dy * k, c + dx * k) for dy, dx in dirs for k in range(1, N)]
    if pattern == 'self': return {(r, c)}
    if pattern == 'adj': [add(r + dy, c + dx) for dy, dx in rook]
    if pattern == 'diag': [add(r + dy, c + dx) for dy, dx in bish]
    if pattern == 'ring': [add(r + dy, c + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
    if pattern == 'front': add(r - 1, c)
    if pattern == 'back': add(r + 1, c)
    if pattern == 'row': [add(r, x) for x in range(N)]
    if pattern == 'col': [add(y, c) for y in range(N)]
    if pattern == 'knight': [add(r + dy, c + dx) for dy, dx in [(1, 2), (2, 1), (-1, 2), (-2, 1), (1, -2), (2, -1), (-1, -2), (-2, -1)]]
    if pattern == 'bishop': ray(bish)
    if pattern == 'rook': ray(rook)
    if pattern == 'queen': ray(rook + bish)
    return out

def board(d, pattern):
    reach, cs, x0, y0 = cells(pattern), 40, 70, 150
    d.rect(x0 - 12, y0 - 12, x0 + cs * 5 + 8, y0 + cs * 5 + 8, fill=mix(DARK, '#000000', 0.3), r=12)
    for r in range(5):
        for c in range(5):
            col = WHITE if (r, c) == (2, 2) else d.a if (r, c) in reach else mix('#2a3350', '#3a4466', (r + c) % 2)
            d.rect(x0 + c * cs, y0 + r * cs, x0 + c * cs + cs - 4, y0 + r * cs + cs - 4, fill=col, r=5)

def coin(d, x, y, s=1):
    d.circle(x, y, 34 * s, fill='#c9952a'); d.circle(x, y, 27 * s, fill=GOLD); d.rect(x - 5 * s, y - 16 * s, x + 5 * s, y + 16 * s, fill='#c9952a', r=2)

def glyph(d, tid, a):
    X, Y = 470, 250
    if tid == 'amp':
        for r in (40, 80, 120): d.circle(X, Y, r, outline=a, width=8)
        d.circle(X, Y, 18, fill=WHITE)
    elif tid == 'gambit':
        d.poly([(X - 90, Y + 60), (X - 110, Y - 60), (X - 50, Y - 10), (X, Y - 90), (X + 50, Y - 10), (X + 110, Y - 60), (X + 90, Y + 60)], fill=a)
        d.rect(X - 95, Y + 60, X + 95, Y + 90, fill=mix(a, DARK, 0.3), r=8)
    elif tid == 'beacon':
        d.figure(X - 40, Y + 10, 1.1, WHITE); d.plus(X + 80, Y - 40, 1.4, a)
    elif tid == 'chest':
        d.rect(X - 110, Y - 30, X + 110, Y + 90, fill='#7a4a22', r=12); d.rect(X - 110, Y - 80, X + 110, Y - 20, fill='#9a5f2c', r=30)
        d.rect(X - 18, Y - 40, X + 18, Y + 10, fill=GOLD, r=4); coin(d, X - 60, Y - 100, 0.8); coin(d, X + 40, Y - 110, 0.8)
    elif tid == 'interest':
        for k in range(4): coin(d, X - 70 + k * 10, Y + 70 - k * 40, 1)
        d.chevron(X + 90, Y - 10, 1.4, a); d.line([(X + 60, Y + 80), (X + 120, Y - 80)], a, 10)
    elif tid in ('drill', 'promote'):
        d.star(X, Y - 20, 95, 42, 5, GOLD, rot=-math.pi / 2)
        for k in range(2): d.line([(X - 70, Y + 90 + k * 30), (X, Y + 60 + k * 30), (X + 70, Y + 90 + k * 30)], a, 14)
    elif tid in ('fortress', 'rookfort', 'rearguard'):
        d.shield(X, Y, 1.2, a, inner=mix(a, DARK, 0.45))
        if tid == 'rookfort': [d.rect(X - 60 + k * 45, Y - 130, X - 30 + k * 45, Y - 100, fill=WHITE, r=3) for k in range(3)]
    elif tid in ('overcharge', 'uplink'):
        d.bolt(X, Y, 2.0, a)
        if tid == 'uplink': d.crosshair(X + 100, Y - 90, 34, WHITE, 6)
    elif tid in ('sanctum', 'bishop'):
        d.heart(X, Y - 10, 1.3, RED); d.plus(X, Y - 20, 1.1, WHITE)
    elif tid in ('echo', 'clone', 'mirror', 'rewind'):
        d.figure(X - 55, Y + 10, 1.1, WHITE); d.figure(X + 55, Y + 10, 1.1, a, outline=True)
        if tid == 'rewind': d.arc(X, Y - 20, 140, 200, 340, a, 10)
        if tid == 'mirror': d.line([(X, Y - 110), (X, Y + 110)], mix(a, WHITE, 0.4), 6)
    elif tid == 'supply':
        d.rect(X - 90, Y - 70, X + 90, Y + 90, fill='#8a6a3a', r=8); d.line([(X - 90, Y - 70), (X + 90, Y + 90)], '#5a4020', 10); d.line([(X + 90, Y - 70), (X - 90, Y + 90)], '#5a4020', 10)
        d.plus(X + 100, Y - 100, 1.0, a)
    elif tid == 'banner':
        d.line([(X - 60, Y - 120), (X - 60, Y + 120)], WHITE, 10); d.poly([(X - 55, Y - 115), (X + 110, Y - 80), (X - 55, Y - 20)], fill=a)
        d.circle(X + 10, Y - 75, 16, fill=WHITE)
    elif tid in ('wall', 'pillar'):
        if tid == 'pillar':
            d.rect(X - 45, Y - 120, X + 45, Y + 110, fill=WHITE, r=6); d.rect(X - 70, Y - 135, X + 70, Y - 110, fill=a, r=4); d.rect(X - 70, Y + 100, X + 70, Y + 125, fill=a, r=4)
        else:
            for row in range(4):
                for k in range(4):
                    x0 = X - 130 + k * 66 - (row % 2) * 33
                    if x0 >= X - 135: d.rect(x0, Y - 90 + row * 46, x0 + 62, Y - 50 + row * 46, fill=mix('#b5563c', a, 0.2), r=3)
    elif tid == 'overwatch':
        d.crosshair(X, Y, 80, a, 9); d.circle(X, Y, 12, fill=WHITE)
    elif tid == 'glass':
        d.bullet(X, Y, 260, 50, WHITE, ang=-0.35)
        for p in ((X - 20, Y - 40), (X + 30, Y + 20), (X - 60, Y + 50)): d.line([p, (p[0] + 30, p[1] - 22), (p[0] + 12, p[1] + 18)], RED, 5, caps=False)
    elif tid == 'vanguard':
        for k in range(3): d.chevron(X - 60 + k * 60, Y, 1.6, a if k == 2 else mix(a, DARK, 0.4 - k * 0.15))
    elif tid == 'recruit':
        for k, s in ((-90, 0.8), (0, 1.05), (90, 0.8)): d.figure(X + k, Y + 20, s, WHITE if k == 0 else mix(WHITE, DARK, 0.3))
        d.plus(X + 120, Y - 100, 0.9, a)
    elif tid == 'pens':   # a small figure, then bigger and bigger crowds
        for k, (dx, s) in enumerate(((-110, 0.45), (-30, 0.6), (60, 0.75))):
            for j in range(k + 1): d.figure(X + dx + j * 26, Y + 40 - j * 18, s, mix(WHITE, a, 0.15 * j))
        d.plus(X + 125, Y - 105, 0.9, a)
    elif tid == 'swarmdoc':   # a swarm of tiny figures filling the space
        for r in range(4):
            for c in range(6): d.figure(X - 125 + c * 50 + (r % 2) * 25, Y - 80 + r * 55, 0.42, WHITE if (r + c) % 3 else a)
    elif tid == 'catcher':
        d.shield(X - 20, Y, 1.0, a, inner=mix(a, DARK, 0.45)); d.drop(X + 100, Y - 40, 0.7, RED)
    elif tid == 'grove':
        for k in range(6):
            t = k * math.pi / 3; d.circle(X + math.cos(t) * 60, Y + math.sin(t) * 60, 42, fill=mix('#fff3a0', a, 0.3))
        d.circle(X, Y, 40, fill=GOLD)
    elif tid == 'saiyan':
        d.star(X, Y, 130, 60, 9, GOLD, rot=0.2); d.bolt(X, Y, 1.4, WHITE)
    elif tid == 'slam':
        d.star(X, Y + 30, 120, 50, 10, a); d.rect(X - 50, Y - 120, X + 50, Y - 30, fill=WHITE, r=12)
    else:
        d.circle(X, Y, 90, fill=a)

def main():
    os.makedirs(OUT, exist_ok=True)
    src = open(os.path.join(ROOT, 'public', 'js', 'amondata.js'), encoding='utf-8').read()
    n = 0
    for m in re.finditer(r"T\('([a-z]+)', '((?:[^'\\]|\\.)*)', (\d), '[^']*', '([a-z]+)'", src):
        tid, tier, pattern = m.group(1), int(m.group(3)), m.group(4)
        if os.environ.get('ONLY') and tid not in os.environ['ONLY'].split(','): continue
        if "from: 'shield-" in src[m.start():src.index('\n', m.start())]: continue   # these use their shooter card's art
        d = D('amon-' + tid, RAR[tier]); board(d, pattern); glyph(d, tid, d.a)
        d.save(os.path.join(OUT, 'a-' + tid + '.png')); n += 1
    print('drew', n, 'AMON tactic cards into art/amon/')

if __name__ == '__main__': main()

# ---------------------------------------------------------------- faction emblems (art/amon/faction-<id>.png, 256x256 badges)
FACTIONS = {
  'tank': '#c2a45a', 'swarm': '#a65ad8', 'bone': '#d8d0b0', 'sky': '#6ab8ea', 'artillery': '#d0904a', 'pyro': '#ff6a1a', 'frost': '#9ad8ff', 'iron': '#b0b8c8',
  'beast': '#a07a4a', 'machine': '#7ab0c0', 'void': '#8a4ae0', 'raider': '#c05040', 'plague': '#9ac03a', 'crusade': '#e8c870', 'storm': '#8ac0ff', 'shadow': '#7a6aa0', 'chaos': '#ff4fd0',
  'counter': '#40d0b0',
}
def skull(d, x, y, s, fill, eye=DARK):
    d.circle(x, y - 20 * s, 80 * s, fill=fill); d.rect(x - 50 * s, y + 20 * s, x + 50 * s, y + 85 * s, fill=fill, r=14 * s)
    d.circle(x - 32 * s, y - 15 * s, 22 * s, fill=eye); d.circle(x + 32 * s, y - 15 * s, 22 * s, fill=eye)
    d.poly([(x, y + 12 * s), (x - 12 * s, y + 36 * s), (x + 12 * s, y + 36 * s)], fill=eye)
    for k in (-1, 0, 1): d.rect(x + k * 24 * s - 4 * s, y + 55 * s, x + k * 24 * s + 4 * s, y + 85 * s, fill=eye)
def emblem(fid, col):
    d = D('faction-' + fid, 'common'); X, Y = 350, 250
    d.circle(X, Y, 235, fill=col); d.circle(X, Y, 212, fill=mix(col, DARK, 0.82)); d.circle(X, Y, 200, outline=mix(col, DARK, 0.4), width=4)
    w = WHITE
    if fid == 'tank': d.tank(X - 20, Y + 10, 1.05, col)
    elif fid == 'swarm': d.critter(X - 30, Y, 1.3, col); d.critter(X + 40, Y - 85, 0.55, mix(col, w, 0.3)); d.critter(X + 50, Y + 95, 0.5, mix(col, w, 0.3))
    elif fid == 'bone': skull(d, X, Y - 5, 1.35, '#e8e0c8')
    elif fid == 'sky':
        d.poly([(X + 150, Y), (X - 40, Y - 30), (X - 130, Y - 150), (X - 160, Y - 150), (X - 100, Y - 25), (X - 150, Y - 20), (X - 180, Y - 70), (X - 200, Y - 70), (X - 180, Y), (X - 200, Y + 70), (X - 180, Y + 70), (X - 150, Y + 20), (X - 100, Y + 25), (X - 160, Y + 150), (X - 130, Y + 150), (X - 40, Y + 30)], fill=w)
        d.ellipse(X + 60, Y, 40, 12, fill=col)
    elif fid == 'artillery': d.crosshair(X, Y, 110, col, 14); d.circle(X, Y, 24, fill=w)
    elif fid == 'pyro':
        d.drop(X, Y + 30, 1.9, '#ff6a1a'); d.drop(X, Y + 60, 1.1, '#ffb347'); d.drop(X, Y + 80, 0.5, '#fff0a0')
    elif fid == 'frost':
        for k in range(3):
            t = k * math.pi / 3; c, sn = math.cos(t), math.sin(t)
            d.line([(X - c * 150, Y - sn * 150), (X + c * 150, Y + sn * 150)], w, 16)
            for sgn in (-1, 1):
                for r in (75, 115):
                    px, py = X + sgn * c * r, Y + sgn * sn * r
                    for a2 in (0.6, -0.6):
                        c2, s2 = math.cos(t + a2), math.sin(t + a2)
                        d.line([(px, py), (px + sgn * c2 * 40, py + sgn * s2 * 40)], col, 10)
    elif fid == 'iron':
        for sg in (-1, 1):
            d.line([(X - sg * 120, Y + 120), (X + sg * 110, Y - 110)], '#d8dde8', 22)
            d.line([(X - sg * 140, Y + 70), (X - sg * 70, Y + 140)], col, 16)
        d.shield(X, Y + 10, 0.75, col, inner=mix(col, DARK, 0.5))
    elif fid == 'beast':
        d.ellipse(X, Y + 50, 85, 70, fill=w)
        for dx, dy in ((-95, -50), (-35, -110), (35, -110), (95, -50)): d.ellipse(X + dx, Y + dy, 33, 42, fill=w)
    elif fid == 'machine':
        d.rect(X - 120, Y - 90, X + 120, Y + 110, fill='#cfd6e4', r=24); d.rect(X - 90, Y - 50, X + 90, Y + 10, fill=DARK, r=12)
        d.circle(X - 45, Y - 20, 20, fill=col); d.circle(X + 45, Y - 20, 20, fill=col)
        for k in range(-2, 3): d.rect(X + k * 34 - 10, Y + 45, X + k * 34 + 10, Y + 85, fill=DARK, r=3)
        d.line([(X, Y - 90), (X, Y - 150)], '#cfd6e4', 10); d.circle(X, Y - 160, 18, fill=col)
    elif fid == 'void':
        for k, r in enumerate((170, 130, 90, 50)): d.arc(X + (k % 2) * 8, Y, r, k * 70, k * 70 + 270, mix(col, w, k * 0.2), 18)
        d.circle(X, Y, 20, fill=w)
    elif fid == 'raider':
        d.line([(X - 140, Y + 140), (X + 140, Y - 140)], w, 22); d.line([(X - 140, Y - 140), (X + 140, Y + 140)], w, 22)
        skull(d, X, Y - 10, 0.95, w, eye=mix(col, DARK, 0.5))
    elif fid == 'plague':
        for k in range(3):
            t = -math.pi / 2 + k * 2 * math.pi / 3
            d.circle(X + math.cos(t) * 80, Y + math.sin(t) * 80, 78, fill=col)
            d.circle(X + math.cos(t) * 100, Y + math.sin(t) * 100, 52, fill=mix(col, DARK, 0.82))
        d.circle(X, Y, 42, fill=mix(col, DARK, 0.82)); d.circle(X, Y, 26, fill=col)
    elif fid == 'crusade':
        d.rect(X - 26, Y - 160, X + 26, Y + 160, fill=col, r=6); d.rect(X - 110, Y - 75, X + 110, Y - 25, fill=col, r=6)
        d.circle(X, Y - 50, 20, fill=DARK)
    elif fid == 'storm': d.bolt(X, Y, 2.5, col); d.bolt(X + 10, Y - 6, 1.6, w)
    elif fid == 'shadow':
        d.poly([(X, Y - 170), (X + 34, Y + 40), (X - 34, Y + 40)], fill='#d8dde8'); d.line([(X, Y - 150), (X, Y + 30)], mix('#d8dde8', DARK, 0.3), 5)
        d.rect(X - 90, Y + 40, X + 90, Y + 66, fill=col, r=8); d.rect(X - 18, Y + 66, X + 18, Y + 150, fill='#4a3a2a', r=6); d.circle(X, Y + 160, 20, fill=col)
    elif fid == 'chaos':
        d.poly([(X - 120, Y - 60), (X + 10, Y - 130), (X + 140, Y - 60), (X + 10, Y + 10)], fill=w)
        d.poly([(X - 120, Y - 60), (X + 10, Y + 10), (X + 10, Y + 160), (X - 120, Y + 80)], fill=mix(col, w, 0.3))
        d.poly([(X + 10, Y + 10), (X + 140, Y - 60), (X + 140, Y + 80), (X + 10, Y + 160)], fill=col)
        for px, py in ((X + 10, Y - 60), (X - 40, Y - 85), (X + 60, Y - 35)): d.ellipse(px, py, 16, 9, fill=DARK)
        for px, py in ((X - 80, Y), (X - 30, Y + 80)): d.circle(px, py, 13, fill=DARK)
        for px, py in ((X + 50, Y + 20), (X + 100, Y + 60), (X + 75, Y + 40)): d.circle(px, py, 13, fill=DARK)
    elif fid == 'counter':   # balance scales
        d.rect(X - 12, Y - 130, X + 12, Y + 120, fill=w, r=6); d.rect(X - 80, Y + 110, X + 80, Y + 140, fill=w, r=8)
        d.line([(X - 140, Y - 100), (X + 140, Y - 100)], w, 16); d.circle(X, Y - 130, 22, fill=col)
        for sg in (-1, 1):
            px = X + sg * 130
            d.line([(px, Y - 100), (px - 55, Y + 10)], w, 6); d.line([(px, Y - 100), (px + 55, Y + 10)], w, 6)
            d.poly([(px - 70, Y + 10), (px + 70, Y + 10), (px + 40, Y + 45), (px - 40, Y + 45)], fill=col)
    from PIL import Image
    im = d.im.resize((ca.W, ca.H), Image.LANCZOS)
    im = im.crop((X - 250, Y - 250, X + 250, Y + 250)).resize((256, 256), Image.LANCZOS)
    mask = Image.new('L', (256, 256), 0); from PIL import ImageDraw; ImageDraw.Draw(mask).ellipse([1, 1, 254, 254], fill=255)
    out = Image.new('RGBA', (256, 256), (0, 0, 0, 0)); out.paste(im, (0, 0), mask)
    out.save(os.path.join(OUT, 'faction-' + fid + '.png'), optimize=True)

if __name__ == '__main__':
    import sys
    for fid, col in FACTIONS.items():
        if len(sys.argv) < 2 or fid in sys.argv[1:]: emblem(fid, col)
    print('drew', len(FACTIONS), 'faction emblems')
