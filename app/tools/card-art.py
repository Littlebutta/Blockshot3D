#!/usr/bin/env python3
# Card art generator (flat glyph style, 700x500 like the hand-made art).
#   python3 tools/card-art.py           -> draws art.png for listed cards that don't have one
#   python3 tools/card-art.py --force   -> redraws every listed card
#   python3 tools/card-art.py id1 id2   -> just these cards
# Needs Pillow (pip install pillow). Drop your own art.png in a card folder to replace any of these.
import json, math, os, sys, hashlib
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
W, H, S = 700, 500, 4
ACCENT = {'common': '#cfd6ea', 'uncommon': '#5fe3a1', 'rare': '#ffb347', 'legendary': '#ff5fd2', 'mod': '#7fe0ff', 'shieldmod': '#8fb4ff', 'combo': '#ffd166', 'cursed': '#e0464b', 'holy': '#ffe08a'}
TOPS = ['#4f5a26', '#4a1a24', '#1f3550', '#265224', '#4a2050', '#55301f', '#1f4a50', '#2a2050', '#3a4a1c', '#502a3a']
WHITE, DARK = '#f2f4fa', '#141821'

def rgb(h, a=255):
    h = h.lstrip('#'); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)
def mix(a, b, t):
    A, B = rgb(a), rgb(b); return '#%02x%02x%02x' % tuple(round(A[i] + (B[i] - A[i]) * t) for i in range(3))

class D:
    def __init__(self, cid, rarity):
        top = TOPS[int(hashlib.md5(cid.encode()).hexdigest(), 16) % len(TOPS)]
        self.im = Image.new('RGBA', (W * S, H * S)); d = ImageDraw.Draw(self.im)
        bot = mix(top, '#0c0f16', 0.72)
        for y in range(H * S):
            d.line([(0, y), (W * S, y)], fill=rgb(mix(top, bot, y / (H * S))))
        self.d = d; self.a = ACCENT.get(rarity, ACCENT['common']); self.w = WHITE
    def P(self, pts): return [(x * S, y * S) for x, y in pts]
    def circle(self, x, y, r, fill=None, outline=None, width=0):
        self.d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=fill and rgb(fill), outline=outline and rgb(outline), width=int(width * S))
    def ellipse(self, x, y, rx, ry, fill=None, outline=None, width=0):
        self.d.ellipse([(x - rx) * S, (y - ry) * S, (x + rx) * S, (y + ry) * S], fill=fill and rgb(fill), outline=outline and rgb(outline), width=int(width * S))
    def line(self, pts, color, width=8, caps=True):
        self.d.line(self.P(pts), fill=rgb(color), width=int(width * S), joint='curve')
        if caps:
            for x, y in (pts[0], pts[-1]): self.circle(x, y, width / 2, fill=color)
    def dashed(self, pts, color, width=6, dash=14, gap=10):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            L = math.hypot(x1 - x0, y1 - y0); t = 0
            while t < L:
                t1 = min(L, t + dash); a, b = t / L, t1 / L
                self.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)], color, width); t += dash + gap
    def poly(self, pts, fill=None, outline=None, width=0):
        self.d.polygon(self.P(pts), fill=fill and rgb(fill))
        if outline: self.line(list(pts) + [pts[0]], outline, width)
    def rect(self, x0, y0, x1, y1, fill=None, outline=None, width=0, r=0):
        self.d.rounded_rectangle([x0 * S, y0 * S, x1 * S, y1 * S], radius=r * S, fill=fill and rgb(fill), outline=outline and rgb(outline), width=int(width * S))
    def arc(self, x, y, r, a0, a1, color, width=8):
        self.d.arc([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], a0, a1, fill=rgb(color), width=int(width * S))
    def star(self, x, y, r1, r2, n, fill, rot=0):
        pts = [(x + math.cos(rot + i * math.pi / n) * (r1 if i % 2 == 0 else r2), y + math.sin(rot + i * math.pi / n) * (r1 if i % 2 == 0 else r2)) for i in range(2 * n)]
        self.poly(pts, fill=fill)
    def bolt(self, x, y, s, fill):
        self.poly([(x + 10 * s, y - 60 * s), (x - 25 * s, y + 5 * s), (x - 2 * s, y + 5 * s), (x - 12 * s, y + 60 * s), (x + 25 * s, y - 8 * s), (x + 2 * s, y - 8 * s)], fill=fill)
    def bullet(self, x, y, L, r, fill, ang=0, hollow=False):
        c, s = math.cos(ang), math.sin(ang)
        T = lambda u, v: (x + u * c - v * s, y + u * s + v * c)
        pts = [T(-L / 2, -r), T(L / 2 - r * 1.6, -r)] + [T(L / 2 - r * 1.6 + math.cos(t) * r * 1.6, math.sin(t) * r) for t in [i * math.pi / 12 - math.pi / 2 for i in range(13)]] + [T(-L / 2, r)]
        self.poly(pts, fill=fill)
        self.poly([T(-L / 2 + 8, -r), T(-L / 2 + 14, -r), T(-L / 2 + 14, r), T(-L / 2 + 8, r)], fill=DARK)
        if hollow: self.circle(*T(L / 2 - r * 0.5, 0), r * 0.45, fill=DARK)
    def figure(self, x, y, s, fill, outline=False):
        # the in-game player: a rounded capsule with a visor
        if outline:
            self.rect(x - 34 * s, y - 70 * s, x + 34 * s, y + 70 * s, outline=fill, width=6 * s, r=34 * s)
            self.rect(x - 22 * s, y - 42 * s, x + 22 * s, y - 30 * s, fill=fill, r=5 * s)
        else:
            self.rect(x - 34 * s, y - 70 * s, x + 34 * s, y + 70 * s, fill=fill, r=34 * s)
            self.rect(x - 24 * s, y - 44 * s, x + 24 * s, y - 28 * s, fill=DARK, r=6 * s)
    def shield(self, x, y, s, fill, inner=None):
        pts = [(x - 75 * s, y - 70 * s), (x, y - 92 * s), (x + 75 * s, y - 70 * s), (x + 68 * s, y + 10 * s), (x, y + 92 * s), (x - 68 * s, y + 10 * s)]
        self.poly(pts, fill=fill)
        if inner: self.poly([(x + (px - x) * 0.72, y + (py - y) * 0.72 - 4 * s) for px, py in pts], fill=inner)
    def crosshair(self, x, y, r, color, w=6):
        self.circle(x, y, r, outline=color, width=w)
        for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]: self.line([(x + dx * r * 0.5, y + dy * r * 0.5), (x + dx * r * 1.45, y + dy * r * 1.45)], color, w)
    def drop(self, x, y, s, fill):
        self.circle(x, y + 22 * s, 44 * s, fill=fill)
        self.poly([(x, y - 70 * s), (x - 40 * s, y + 6 * s), (x + 40 * s, y + 6 * s)], fill=fill)
    def heart(self, x, y, s, fill):
        self.circle(x - 30 * s, y - 15 * s, 34 * s, fill=fill); self.circle(x + 30 * s, y - 15 * s, 34 * s, fill=fill)
        self.poly([(x - 62 * s, y - 2 * s), (x + 62 * s, y - 2 * s), (x, y + 70 * s)], fill=fill)
    def plus(self, x, y, s, fill):
        self.rect(x - 9 * s, y - 30 * s, x + 9 * s, y + 30 * s, fill=fill, r=3 * s); self.rect(x - 30 * s, y - 9 * s, x + 30 * s, y + 9 * s, fill=fill, r=3 * s)
    def wall(self, x0, y0, x1, y1, color): self.rect(x0, y0, x1, y1, fill=color, r=3)
    def chevron(self, x, y, s, color, w=14):
        self.line([(x - 22 * s, y - 40 * s), (x + 18 * s, y), (x - 22 * s, y + 40 * s)], color, w)
    def mine(self, x, y, s, fill, lamp):
        for k in range(5):
            a = math.pi + k * math.pi / 4; self.line([(x, y), (x + math.cos(a) * 52 * s, y + math.sin(a) * 52 * s)], fill, 7 * s)
        self.d.pieslice([(x - 42 * s) * S, (y - 42 * s) * S, (x + 42 * s) * S, (y + 42 * s) * S], 180, 360, fill=rgb(fill))
        self.rect(x - 52 * s, y - 2, x + 52 * s, y + 12 * s, fill=fill, r=4); self.circle(x, y - 26 * s, 9 * s, fill=lamp)
    def bomb(self, x, y, s, fill):
        self.circle(x, y, 52 * s, fill=fill); self.rect(x - 14 * s, y - 66 * s, x + 14 * s, y - 46 * s, fill=WHITE)
        self.line([(x, y - 66 * s), (x + 22 * s, y - 92 * s)], WHITE, 4 * s)
    def critter(self, x, y, s, fill):
        for k in (-1, 0, 1):
            for sd in (-1, 1): self.line([(x + k * 32 * s, y), (x + k * 40 * s + sd * 6 * s, y + sd * 62 * s)], DARK if fill != DARK else WHITE, 8 * s)
        self.ellipse(x, y, 82 * s, 46 * s, fill=fill); self.circle(x + 78 * s, y, 32 * s, fill=DARK)
        self.circle(x + 88 * s, y - 12 * s, 7 * s, fill='#ffe066'); self.circle(x + 88 * s, y + 12 * s, 7 * s, fill='#ffe066')
    def tank(self, x, y, s, fill):
        self.rect(x - 110 * s, y + 10 * s, x + 110 * s, y + 60 * s, fill=DARK, r=25 * s)
        for k in range(-3, 4): self.circle(x + k * 30 * s, y + 35 * s, 13 * s, fill='#8a92a3')
        self.poly([(x - 100 * s, y + 12 * s), (x - 80 * s, y - 25 * s), (x + 90 * s, y - 25 * s), (x + 110 * s, y + 12 * s)], fill=fill)
        self.rect(x - 50 * s, y - 70 * s, x + 40 * s, y - 22 * s, fill=fill, r=18 * s)
        self.rect(x + 30 * s, y - 56 * s, x + 150 * s, y - 40 * s, fill='#8a92a3', r=4 * s); self.rect(x + 145 * s, y - 61 * s, x + 162 * s, y - 35 * s, fill=DARK, r=3 * s)
    def turret(self, x, y, s, fill):
        for dx in (-45, 0, 45): self.line([(x, y - 10 * s), (x + dx * s, y + 70 * s)], DARK if fill != DARK else WHITE, 9 * s)
        self.rect(x - 45 * s, y - 70 * s, x + 45 * s, y - 10 * s, fill=fill, r=10 * s)
        self.rect(x + 35 * s, y - 56 * s, x + 110 * s, y - 44 * s, fill=fill, r=4 * s); self.rect(x + 35 * s, y - 36 * s, x + 110 * s, y - 24 * s, fill=fill, r=4 * s)
        self.circle(x + 10 * s, y - 40 * s, 9 * s, fill=DARK)
    def save(self, path):
        self.im.resize((W, H), Image.LANCZOS).convert('RGB').save(path, optimize=True)

def zig(d, pts, color, w=7): d.line(pts, color, w)

# ---------------------------------------------------------------- designs (x 350, y 250 is the middle)
def art(cid, d):
    a, w = d.a, d.w
    if cid == 'bank-shot':
        d.wall(170, 380, 530, 396, w); zig(d, [(190, 150), (330, 372), (470, 200)], a); d.crosshair(500, 165, 34, w)
    elif cid == 'rebound-charge':
        d.wall(170, 380, 530, 396, w); zig(d, [(200, 150), (350, 368), (500, 150)], a); d.star(350, 352, 52, 22, 8, a)
    elif cid == 'kinetic-rebound':
        d.wall(150, 380, 550, 396, w)
        for i, (x0, x1, wd) in enumerate([(170, 260, 4), (260, 350, 8), (350, 440, 13), (440, 530, 19)]):
            d.line([(x0, 372 if i % 2 else 180), (x1, 180 if i % 2 else 372)], a, wd)
    elif cid == 'splinter-bounce':
        d.wall(500, 120, 516, 380, w); zig(d, [(180, 250), (490, 250)], a); zig(d, [(490, 250), (300, 150)], a); zig(d, [(490, 250), (300, 350)], a, 5)
    elif cid == 'trick-shot':
        d.wall(160, 110, 176, 390, w); d.wall(524, 110, 540, 390, w); d.wall(160, 380, 540, 396, w)
        zig(d, [(250, 130), (515, 230), (185, 330), (330, 372), (430, 260)], a, 6); d.crosshair(430, 250, 30, w)
    elif cid == 'saturn-rounds':
        d.ellipse(350, 250, 170, 52, outline=a, width=10); d.circle(350, 250, 62, fill=w)
        d.d.arc([(180) * S, (198) * S, (520) * S, (302) * S], 180, 360, fill=rgb(DARK), width=0)
        d.ellipse(350, 250, 170, 52, outline=a, width=10); d.circle(350, 250, 62, fill=w); d.d.arc([180 * S, 198 * S, 520 * S, 302 * S], 0, 180, fill=rgb(a), width=10 * S)
    elif cid == 'tiny-tank': d.tank(340, 270, 1.0, a)
    elif cid == 'mod-critter':
        d.critter(330, 250, 1.1, a)
        for k in range(3): d.line([(150 - k * 10, 220 + k * 30), (215 - k * 10, 220 + k * 30)], w, 6)
    elif cid == 'shield-clone': d.figure(290, 260, 1.15, a); d.figure(420, 260, 1.15, a, outline=True)
    elif cid == 'shield-turret':
        d.rect(400, 240, 520, 330, fill=mix(w, DARK, 0.25), r=8); d.turret(300, 260, 1.0, a)
    elif cid == 'shield-pillar':
        d.rect(305, 260, 395, 420, fill=w, r=4); d.rect(300, 330, 400, 340, fill=a); d.figure(350, 180, 0.6, a)
        d.circle(350, 180, 75, outline=a, width=6)
    elif cid == 'shield-rewind':
        d.arc(350, 250, 105, 200, 520 - 40, a, 16); d.poly([(232, 205), (262, 270), (198, 262)], fill=a)
        d.poly([(320, 205), (320, 295), (275, 250)], fill=w); d.poly([(380, 205), (380, 295), (335, 250)], fill=w)
    elif cid == 'shield-catcher':
        d.circle(350, 250, 110, outline=a, width=8); d.figure(350, 255, 0.75, w)
        for k in range(5):
            t = k * 2 * math.pi / 5 + 0.3; d.circle(350 + math.cos(t) * 110, 250 + math.sin(t) * 110, 13, fill=w)
    elif cid == 'shield-slam':
        d.wall(140, 380, 560, 396, w); d.line([(350, 120), (350, 300)], a, 18); d.poly([(305, 285), (395, 285), (350, 350)], fill=a)
        for r in (70, 120, 170): d.arc(350, 380, r, 200, 340, a, 6)
    elif cid == 'bastion-wall':
        d.rect(240, 130, 460, 380, fill=mix(a, DARK, 0.55), outline=a, width=8, r=10)
        for y in (190, 250, 310): d.line([(280, y + 20), (350, y - 15), (420, y + 20)], w, 8)
    elif cid == 'battering-ram':
        d.bullet(370, 250, 260, 55, a)
        for k, y in enumerate((190, 250, 310)): d.line([(120, y), (200 - k % 2 * 30, y)], w, 8)
        d.poly([(460, 200), (520, 170), (500, 235)], fill=w); d.poly([(460, 300), (520, 330), (500, 265)], fill=w)
    elif cid == 'big-bubble': d.circle(350, 250, 140, outline=a, width=10); d.circle(350, 250, 125, outline=mix(a, DARK, 0.5), width=4); d.figure(350, 260, 0.7, w)
    elif cid == 'big-iron':
        d.rect(340, 210, 560, 245, fill=w, r=6); d.circle(320, 240, 62, fill=a)
        for k in range(6): t = k * math.pi / 3; d.circle(320 + math.cos(t) * 36, 240 + math.sin(t) * 36, 11, fill=DARK)
        d.poly([(270, 280), (240, 390), (300, 390), (330, 290)], fill=w)
    elif cid == 'blink-runner':
        for k, al in enumerate((0.25, 0.5, 1.0)): d.figure(220 + k * 110, 250, 0.9, mix(DARK, a, al))
        d.line([(160, 360), (540, 360)], w, 6)
    elif cid == 'bulk-up':
        d.rect(170, 280, 250, 360, fill=w, r=18); d.rect(330, 170, 520, 360, fill=a, r=40)
        d.line([(270, 300), (310, 260)], w, 10); d.poly([(320, 250), (290, 255), (315, 280)], fill=w)
    elif cid == 'bullet-hose':
        for k in range(-3, 4): d.bullet(330 + abs(k) * -14, 250 + k * 34, 120, 13, a if k % 2 else w, ang=k * 0.06)
    elif cid == 'concrete-barrier':
        d.poly([(170, 380), (190, 220), (210, 200), (490, 200), (510, 220), (530, 380)], fill=w)
        for x in (290, 410): d.line([(x, 205), (x + 4, 375)], DARK, 4)
        d.rect(185, 285, 515, 305, fill=a)
    elif cid == 'drill-rounds':
        d.wall(430, 120, 470, 380, mix(w, DARK, 0.4)); d.poly([(180, 210), (180, 290), (420, 250)], fill=a)
        for k in range(4): d.line([(200 + k * 50, 215 + k * 9), (225 + k * 50, 285 - k * 9)], DARK, 6)
    elif cid == 'field-medic': d.bullet(350, 250, 300, 60, w); d.plus(320, 250, 1.2, '#e0464b')
    elif cid == 'field-rations':
        d.rect(270, 160, 430, 370, fill=w, r=14); d.ellipse(350, 165, 80, 20, fill=mix(w, DARK, 0.25)); d.rect(270, 230, 430, 310, fill=a); d.plus(350, 270, 0.9, w)
    elif cid in ('fortify', 'fortress-stance'):
        d.rect(250, 170, 450, 380, fill=a if cid == 'fortify' else w, r=4)
        for k in range(4): d.rect(250 + k * 56, 130, 282 + k * 56, 175, fill=a if cid == 'fortify' else w, r=3)
        d.rect(325, 300, 375, 380, fill=DARK, r=20)
        if cid == 'fortify':
            for k in range(3): d.ellipse(205 + k * 0, 360 - k * 30, 40, 16, fill=w); d.ellipse(495, 360 - k * 30, 40, 16, fill=w)
    elif cid == 'guided-meteor':
        d.line([(170, 130), (300, 210), (380, 330)], mix(a, DARK, 0.3), 14); d.circle(390, 340, 34, fill=a); d.crosshair(480, 340, 40, w)
    elif cid == 'hair-trigger':
        d.rect(200, 150, 500, 200, fill=w, r=10); d.circle(330, 260, 62, outline=w, width=10)
        d.line([(345, 200), (360, 240), (340, 290)], a, 16)
        for k in range(3): t = -0.6 + k * 0.6; d.line([(400 + math.cos(t) * 40, 260 + math.sin(t) * 40), (400 + math.cos(t) * 80, 260 + math.sin(t) * 80)], w, 6)
    elif cid == 'hollow-points': d.bullet(350, 250, 300, 62, a, hollow=True)
    elif cid == 'hydra-swarm':
        d.wall(500, 110, 516, 390, w)
        for k in range(5): y = 150 + k * 50; d.line([(170, 250), (495, y), (330, 250 + (y - 250) * 1.6)], a if k % 2 == 0 else w, 5)
    elif cid == 'iron-curtain':
        for k in range(5): d.rect(160 + k * 78, 140, 225 + k * 78, 370, fill=mix(a, DARK, 0.45), outline=a, width=5, r=6)
    elif cid == 'iron-lung':
        d.ellipse(285, 270, 60, 95, fill=a); d.ellipse(415, 270, 60, 95, fill=a); d.line([(350, 120), (350, 210)], w, 16); d.line([(350, 205), (300, 230)], w, 10); d.line([(350, 205), (400, 230)], w, 10)
    elif cid == 'long-guard':
        d.rect(260, 120, 440, 140, fill=w, r=6); d.rect(260, 360, 440, 380, fill=w, r=6)
        d.poly([(280, 140), (420, 140), (350, 250)], fill=a); d.poly([(350, 250), (290, 360), (410, 360)], outline=a, width=6); d.poly([(350, 300), (310, 358), (390, 358)], fill=a)
    elif cid == 'mass-driver':
        for k in range(4): d.ellipse(230 + k * 60, 250, 18, 80, outline=a, width=8)
        d.bullet(400, 250, 260, 40, w)
    elif cid == 'mending-field':
        d.ellipse(350, 330, 170, 50, outline=a, width=8)
        for x, y in ((290, 230), (400, 190), (350, 280)): d.plus(x, y, 0.8, a if y != 280 else w)
    elif cid == 'mine-layer': d.mine(350, 300, 2.4, w, a)
    elif cid == 'minefield':
        d.mine(220, 340, 1.5, w, a); d.mine(480, 340, 1.5, w, a); d.mine(350, 230, 1.7, a, w)
    elif cid == 'mirror-edge':
        d.poly([(350, 130), (430, 250), (350, 370), (270, 250)], fill=mix(a, w, 0.4)); d.line([(150, 180), (300, 250)], w, 7); d.line([(300, 250), (150, 320)], a, 7)
    elif cid == 'padded-vest':
        d.poly([(260, 150), (310, 150), (350, 200), (390, 150), (440, 150), (470, 380), (230, 380)], fill=a)
        for y in (250, 310): d.line([(250, y), (450, y)], mix(a, DARK, 0.35), 6)
    elif cid == 'phase-step':
        d.figure(230, 250, 0.8, mix(DARK, a, 0.35), outline=True); d.dashed([(290, 250), (400, 250)], w, 7); d.figure(460, 250, 0.8, a)
    elif cid == 'pinball-bomb':
        d.wall(150, 380, 550, 394, w); d.line([(170, 160), (260, 372), (350, 200)], a, 6); d.bomb(430, 230, 0.9, a)
    elif cid == 'quick-guard':
        d.shield(350, 250, 1.3, w, mix(w, DARK, 0.3)); d.line([(350, 250), (350, 190)], a, 10); d.line([(350, 250), (395, 270)], a, 10); d.circle(350, 250, 10, fill=a)
    elif cid == 'regretful-pact':
        d.rect(250, 140, 450, 360, fill='#e8dcc0', r=6); d.circle(250, 140, 22, fill='#cdbf9e'); d.circle(450, 360, 22, fill='#cdbf9e')
        for y in (190, 225, 260): d.line([(285, y), (415, y)], '#8a7a5a', 5)
        d.circle(395, 315, 30, fill='#a8232e')
    elif cid == 'repentance':
        d.poly([(230, 140), (340, 140), (320, 250), (345, 360), (230, 360)], fill='#e8dcc0'); d.poly([(370, 160), (470, 150), (470, 370), (380, 370), (395, 260)], fill='#e8dcc0')
        d.circle(350, 110, 26, outline=a, width=6)
    elif cid == 'repulsor':
        d.circle(350, 250, 22, fill=w)
        for r in (60, 100, 140): d.arc(350, 250, r, 0, 360, a, 6 if r < 140 else 4)
        for t in range(4): an = t * math.pi / 2 + math.pi / 4; d.line([(350 + math.cos(an) * 160, 250 + math.sin(an) * 160), (350 + math.cos(an) * 200, 250 + math.sin(an) * 200)], w, 8)
    elif cid == 'reverb-barrage':
        d.poly([(190, 220), (240, 220), (300, 160), (300, 340), (240, 280), (190, 280)], fill=w)
        for r in (60, 100): d.arc(300, 250, r, 300, 60, a, 8)
        for k in range(3): d.bullet(460, 190 + k * 60, 80, 12, a)
    elif cid == 'sanctuary':
        d.d.pieslice([200 * S, 150 * S, 500 * S, 450 * S], 180, 360, fill=rgb(mix(a, DARK, 0.5))); d.arc(350, 300, 150, 180, 360, a, 8)
        d.line([(170, 300), (530, 300)], w, 8); d.plus(350, 235, 1.0, w)
    elif cid == 'second-wind':
        for k, (L, y, col) in enumerate(((200, 190, a), (260, 255, w), (160, 320, a))):
            x1 = 170 + L; d.line([(170, y), (x1, y)], col, 9)
            pts = [(x1 + math.sin(t) * 34 * (1 - t / 9), y - 34 + math.cos(t) * 34 * (1 - t / 9)) for t in [i * 0.25 for i in range(26)]]
            d.line(pts, col, 9)
    elif cid == 'sentry-unit': d.turret(320, 260, 1.15, w)
    elif cid == 'shock-bubble': d.circle(350, 250, 125, outline=a, width=9); d.bolt(350, 250, 1.4, w)
    elif cid == 'siphon-shield': d.shield(350, 250, 1.4, w, mix(w, DARK, 0.25)); d.drop(350, 255, 0.75, a)
    elif cid == 'speed-loader':
        d.circle(350, 250, 110, fill=mix(w, DARK, 0.35))
        for k in range(6): t = k * math.pi / 3; d.circle(350 + math.cos(t) * 65, 250 + math.sin(t) * 65, 24, fill=a)
        d.circle(350, 250, 22, fill=w)
    elif cid == 'spring-heels':
        d.line([(300 + (40 if k % 2 else -40), 360 - k * 22) for k in range(8)], a, 9); d.rect(260, 150, 360, 210, fill=w, r=12); d.rect(260, 190, 430, 215, fill=w, r=8)
    elif cid == 'steady-hands':
        d.crosshair(350, 250, 95, w, 7)
        for x, y in ((340, 240), (362, 252), (345, 262)): d.circle(x, y, 10, fill=a)
    elif cid == 'tempered-glass':
        pts = [(350 + math.cos(k * math.pi / 3 + math.pi / 6) * 120, 250 + math.sin(k * math.pi / 3 + math.pi / 6) * 120) for k in range(6)]
        d.poly(pts, fill=mix(a, w, 0.3)); d.poly([pts[0], pts[1], (350, 250)], fill=w); d.poly([pts[3], pts[4], (350, 250)], fill=mix(a, DARK, 0.3))
    elif cid == 'thruster':
        d.bullet(380, 250, 220, 45, w); d.poly([(268, 215), (268, 285), (170, 250)], fill=a); d.poly([(268, 230), (268, 270), (205, 250)], fill='#fff3c4')
    elif cid == 'titan-frame':
        d.rect(250, 120, 450, 390, fill=a, r=20); d.rect(280, 170, 420, 200, fill=DARK, r=6); d.rect(200, 200, 250, 330, fill=w, r=14); d.rect(450, 200, 500, 330, fill=w, r=14)
    elif cid == 'tommy-gun':
        d.rect(170, 200, 470, 245, fill=w, r=8); d.rect(470, 210, 560, 232, fill=w, r=4); d.circle(320, 285, 55, fill=a); d.circle(320, 285, 18, fill=DARK); d.poly([(170, 205), (110, 220), (110, 270), (180, 245)], fill=w)
    elif cid == 'troll-blood': d.drop(330, 250, 1.6, a); d.plus(430, 170, 0.9, w)
    elif cid == 'tunnel-borer':
        d.wall(300, 120, 400, 380, mix(w, DARK, 0.45)); d.ellipse(350, 250, 30, 55, fill=DARK)
        d.poly([(400, 215), (400, 285), (560, 250)], fill=a); d.line([(140, 250), (290, 250)], w, 8)
    elif cid == 'twin-protocol': d.figure(290, 260, 1.1, a); d.figure(410, 260, 1.1, w)
    elif cid == 'vampiric-nanites':
        d.poly([(350, 220), (250, 170), (180, 230), (230, 240), (250, 290), (290, 260), (350, 300), (410, 260), (450, 290), (470, 240), (520, 230), (450, 170)], fill=a)
        d.circle(330, 235, 6, fill=w); d.circle(370, 235, 6, fill=w)
    elif cid == 'velocity-rounds':
        d.bullet(420, 250, 200, 26, a)
        for k, y in enumerate((215, 250, 285)): d.line([(140 + k % 2 * 30, y), (300, y)], w, 6)
    elif cid == 'war-drum':
        d.rect(250, 210, 450, 360, fill=a, r=8); d.ellipse(350, 210, 100, 30, fill=w); d.line([(250, 250), (450, 330)], DARK, 5); d.line([(450, 250), (250, 330)], DARK, 5)
        d.line([(260, 120), (330, 200)], w, 9); d.line([(460, 120), (380, 200)], w, 9)
    elif cid == 'wasp-drone':
        d.ellipse(350, 270, 60, 40, fill=a); d.poly([(350, 305), (340, 330), (360, 330)], fill=w)
        for x in (240, 460): d.line([(350, 255), (x, 200)], w, 7); d.ellipse(x, 195, 60, 12, fill=mix(w, DARK, 0.3))
        for k in (-1, 1): d.line([(350 + k * 40, 290), (350 + k * 70, 340)], DARK, 6)
    elif cid == 'napalm-rounds':
        d.wall(130, 380, 570, 396, w); d.bullet(230, 200, 120, 22, w, ang=0.55)
        for x, y, s2 in [(300, 372, 1.0), (360, 372, 1.35), (425, 372, 0.95), (480, 372, 0.7)]:
            d.poly([(x - 26 * s2, y), (x - 8 * s2, y - 70 * s2), (x, y - 40 * s2), (x + 10 * s2, y - 90 * s2), (x + 26 * s2, y)], fill=a)
            d.poly([(x - 12 * s2, y), (x, y - 38 * s2), (x + 12 * s2, y)], fill='#ffd166')
        d.ellipse(390, 384, 120, 10, fill=mix(a, DARK, 0.4))
    elif cid == 'bullet-time':
        for r, k in ((80, 0.15), (130, 0.45), (180, 0.75)): d.ellipse(350, 360, r * 1.4, r * 0.32, outline=mix(a, DARK, k), width=7)
        d.figure(350, 280, 0.75, w)
        for k, (x, y) in enumerate([(140, 150), (215, 175), (285, 195)]): d.bullet(x, y, 70 - k * 10, 13, mix(a, w, 0.3 * k), ang=0.32)
        for k in range(3): d.line([(40, 128 + k * 16), (85, 140 + k * 16)], mix(w, DARK, 0.4), 4)
    elif cid == 'mod-katana':
        # a curved blade with a guard and wrapped grip, cutting a bullet in two
        blade = [(178, 382), (196, 360), (300, 262), (420, 168), (520, 108), (548, 96), (528, 124), (432, 190), (318, 282), (212, 384)]
        d.poly(blade, fill=w); d.line([(196, 368), (528, 112)], mix(w, DARK, 0.25), 3, caps=False)
        d.ellipse(186, 382, 30, 14, fill=a); d.line([(170, 398), (120, 446)], DARK, 22)
        for k in range(4): d.line([(162 - k * 11, 404 + k * 11), (150 - k * 11, 394 + k * 11)], a, 5, caps=False)
        d.arc(360, 260, 170, 200, 320, a, 7)
        d.bullet(470, 300, 46, 12, a, ang=0.9); d.bullet(500, 340, 46, 12, a, ang=0.4)
        d.line([(455, 285), (515, 355)], w, 3)
    elif cid == 'shield-saiyan':
        d.figure(350, 330, 0.95, mix(w, DARK, 0.15))
        gold = '#ffd23a'
        spikes = [(-95, 40, -150, -120), (-55, 10, -80, -190), (-10, 0, 10, -215), (35, 10, 90, -180), (80, 40, 160, -110)]
        for x0, y0, x1, y1 in spikes:
            d.poly([(350 + x0 - 32, 250 + y0), (350 + x1, 250 + y1), (350 + x0 + 32, 250 + y0)], fill=gold)
        d.ellipse(350, 262, 70, 30, fill=gold)
        for r in (150, 185): d.arc(350, 250, r, 200, 340, mix(gold, DARK, 0.3), 5)
    elif cid == 'shield-pentagram':
        cx, cy, R = 350, 270, 150
        d.circle(cx, cy, R, outline=a if False else '#b25bff', width=7); d.circle(cx, cy, R - 18, outline='#e0464b', width=4)
        pts = [(cx + math.sin(i * 4 * math.pi / 5) * (R - 22), cy - math.cos(i * 4 * math.pi / 5) * (R - 22)) for i in range(6)]
        d.line(pts, '#c45bff', 7)
        for i in range(5):
            t = i * 2 * math.pi / 5; x, y = cx + math.sin(t) * (R + 6), cy - math.cos(t) * (R + 6)
            d.rect(x - 8, y - 4, x + 8, y + 26, fill='#efe6d2', r=3); d.ellipse(x, y - 12, 6, 11, fill='#ffb347')
    elif cid == 'mod-katana':
        # a katana slashing diagonally, a crescent slash wave and a cut bullet
        d.line([(170, 380), (520, 120)], w, 14); d.line([(170, 380), (225, 339)], DARK, 22, caps=False)
        d.line([(132, 408), (178, 374)], mix(a, DARK, 0.4), 18)
        d.ellipse(218, 344, 26, 26, fill='#d9b44a')
        d.arc(420, 300, 120, 200, 320, a, 14); d.arc(420, 300, 98, 210, 310, mix(a, w, 0.6), 6)
        d.bullet(520, 330, 40, 14, w, ang=-0.6); d.bullet(560, 300, 40, 14, w, ang=0.8)
        for k in range(4): d.line([(540 + k * 6, 285 + k * 14), (552 + k * 8, 290 + k * 14)], a, 4)
    elif cid == 'shield-saiyan':
        d.figure(350, 330, 1.0, mix(w, DARK, 0.15))
        gold = '#ffd23a'
        for (x0, y0, x1, y1, x2, y2) in [(300, 270, 350, 60, 380, 270), (330, 270, 250, 110, 290, 262), (360, 270, 455, 105, 410, 262),
                                         (290, 280, 190, 190, 300, 268), (400, 268, 520, 200, 410, 284), (320, 272, 300, 140, 345, 266)]:
            d.poly([(x0, y0), (x1, y1), (x2, y2)], fill=gold)
        d.ellipse(350, 270, 72, 28, fill=gold)
        for r in (150, 175): d.arc(350, 260, r, 200, 340, mix(gold, DARK, 0.4), 5)
    elif cid == 'shield-pentagram':
        col = '#b25bff'
        d.ellipse(350, 330, 220, 95, outline=col, width=9); d.ellipse(350, 330, 185, 80, outline=mix(col, '#ff2a2a', 0.5), width=5)
        pts = [(350 + math.cos(-math.pi / 2 + k * 4 * math.pi / 5) * 185, 330 + math.sin(-math.pi / 2 + k * 4 * math.pi / 5) * 80) for k in range(5)]
        d.line(pts + [pts[0]], col, 7, caps=False)
        for k in range(5):
            x = 350 + math.cos(-math.pi / 2 + k * 2 * math.pi / 5) * 185; y = 330 + math.sin(-math.pi / 2 + k * 2 * math.pi / 5) * 80
            d.rect(x - 9, y - 40, x + 9, y, fill='#2a1b2e'); d.poly([(x - 7, y - 42), (x, y - 66), (x + 7, y - 42)], fill='#ffb04a')
        d.ellipse(350, 190, 60, 80, fill=mix(col, DARK, 0.3)); d.ellipse(350, 190, 40, 60, fill=mix(col, '#ff2a2a', 0.6))
        d.critter(275, 225, 0.45, w); d.critter(430, 220, 0.45, w)
    elif cid == 'wide-shells': d.circle(350, 250, 95, fill=a); d.circle(320, 220, 25, fill=mix(a, w, 0.6))
    else: return False
    return True

# ---------------------------------------------------------------- batch 6 reworks (checked before art())
RED, ORANGE, YEL, PURP, WOOD, GREY, GOO = '#e0464b', '#ff8a3d', '#ffd166', '#8e44e8', '#a0683a', '#8a92a3', '#7ddc4a'

def flame(d, x, y, s, c1=ORANGE, c2=YEL, ang=-math.pi / 2):
    # a three-tongued flame pointing along ang
    c, sn = math.cos(ang), math.sin(ang)
    T = lambda u, v: (x + u * c - v * sn, y + u * sn + v * c)
    d.poly([T(0, -26 * s), T(40 * s, -20 * s), T(28 * s, -8 * s), T(70 * s, 0), T(28 * s, 8 * s), T(40 * s, 20 * s), T(0, 26 * s), T(-14 * s, 0)], fill=c1)
    d.poly([T(0, -12 * s), T(26 * s, -8 * s), T(44 * s, 0), T(26 * s, 8 * s), T(0, 12 * s), T(-6 * s, 0)], fill=c2)

def feather(d, x, y, L, ang, fill, rib):
    c, sn = math.cos(ang), math.sin(ang)
    T = lambda u, v: (x + u * c - v * sn, y + u * sn + v * c)
    top = [T(-L / 2 + L * t, -math.sin(math.pi * t) ** 0.8 * L * 0.17) for t in [i / 16 for i in range(17)]]
    bot = [T(-L / 2 + L * t, math.sin(math.pi * t) ** 0.8 * L * 0.15) for t in [i / 16 for i in range(16, -1, -1)]]
    d.poly(top + bot, fill=fill)
    for k in range(3, 14, 3):
        t = k / 16; d.line([T(-L / 2 + L * t, 0), T(-L / 2 + L * t + L * 0.06, -L * 0.12 * math.sin(math.pi * t))], rib, 3, caps=False)
    d.line([T(-L / 2 - L * 0.12, 0), T(L / 2, 0)], rib, 4)

def curve(p0, p1, p2, n=24):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in [i / n for i in range(n + 1)]]

def gear(d, x, y, r, n, fill, hole=DARK):
    d.star(x, y, r, r * 0.78, n, fill); d.circle(x, y, r * 0.72, fill=fill); d.circle(x, y, r * 0.28, fill=hole)

def troll(d, x, y, s, skin):
    for sd in (-1, 1): d.poly([(x + sd * 90 * s, y - 30 * s), (x + sd * 160 * s, y - 70 * s), (x + sd * 95 * s, y + 10 * s)], fill=mix(skin, DARK, 0.15))
    d.ellipse(x, y, 105 * s, 95 * s, fill=skin)
    d.rect(x - 78 * s, y - 52 * s, x + 78 * s, y - 30 * s, fill=mix(skin, DARK, 0.4), r=10 * s)
    for sd in (-1, 1): d.circle(x + sd * 36 * s, y - 14 * s, 11 * s, fill=YEL); d.circle(x + sd * 36 * s, y - 13 * s, 5 * s, fill=DARK)
    d.ellipse(x, y + 20 * s, 24 * s, 28 * s, fill=mix(skin, DARK, 0.25))
    d.line([(x - 52 * s, y + 62 * s), (x + 52 * s, y + 62 * s)], DARK, 8 * s)
    for sd in (-1, 1): d.poly([(x + sd * 36 * s - 9 * s, y + 64 * s), (x + sd * 36 * s + 9 * s, y + 64 * s), (x + sd * 36 * s, y + 30 * s)], fill=WHITE)

def fangs(d, x, y, s, gum):
    d.d.chord([(x - 150 * s) * S, (y - 70 * s) * S, (x + 150 * s) * S, (y + 70 * s) * S], 180, 360, fill=rgb(gum))
    d.rect(x - 150 * s, y - 4 * s, x + 150 * s, y + 6 * s, fill=gum)
    for k in range(-4, 5):
        if abs(k) == 3: continue
        d.rect(x + k * 30 * s - 12 * s, y + 4 * s, x + k * 30 * s + 12 * s, y + 30 * s, fill=WHITE, r=5 * s)
    for sd in (-1, 1): d.poly([(x + sd * 90 * s - 18 * s, y + 4 * s), (x + sd * 90 * s + 18 * s, y + 4 * s), (x + sd * 90 * s, y + 95 * s)], fill=WHITE)

def bubble(d, x, y, rx, ry, fill, tail):
    d.ellipse(x, y, rx, ry, fill=fill); d.poly([(x + tail * rx * 0.2, y + ry * 0.6), (x + tail * rx * 0.75, y + ry * 1.45), (x + tail * rx * 0.55, y + ry * 0.5)], fill=fill)

def v26_art(cid, d):
    a, w = d.a, d.w
    if cid == 'big-iron':   # Combine: a tractor
        d.rect(170, 250, 430, 330, fill='#3fae4a', r=12)               # body
        d.rect(330, 170, 440, 260, fill='#3fae4a', r=10); d.rect(345, 185, 425, 240, fill='#bfe8ff', r=6)   # cab + window
        d.rect(200, 215, 230, 250, fill=GREY, r=4); d.rect(196, 200, 234, 214, fill=DARK, r=3)   # exhaust
        d.rect(150, 290, 210, 310, fill=YEL, r=4)                       # front grille
        for (x, y, r) in ((235, 350, 48), (405, 330, 78)):
            d.circle(x, y, r, fill=DARK); d.circle(x, y, r * 0.55, fill=YEL); d.circle(x, y, r * 0.2, fill=DARK)
            for k in range(10): ang = k * math.pi / 5; d.line([(x + math.cos(ang) * r * 0.85, y + math.sin(ang) * r * 0.85), (x + math.cos(ang) * r, y + math.sin(ang) * r)], '#2a2f3a', 7, caps=False)
        for k in range(3): d.bullet(560, 190 + k * 50, 110, 20, a, ang=0)          # ammo turned into big damage
        d.line([(470, 240), (510, 240)], a, 8); d.poly([(505, 225), (530, 240), (505, 255)], fill=a)
        return True
    if cid == 'toxic-cloud':
        d.bullet(150, 160, 110, 20, w, ang=0.5)
        for (x, y, r, t) in ((360, 300, 95, 0.0), (270, 320, 70, 0.15), (450, 320, 75, 0.1), (330, 230, 70, 0.25), (430, 250, 60, 0.3), (520, 280, 50, 0.4)):
            d.circle(x, y, r, fill=mix(GOO, '#2d5a1a', t))
        for (x, y, r) in ((300, 280, 18), (390, 260, 12), (460, 300, 15), (350, 340, 10)): d.circle(x, y, r, fill=mix(GOO, WHITE, 0.45))
        d.circle(360, 300, 30, fill=DARK); d.circle(348, 292, 8, fill=GOO); d.circle(372, 292, 8, fill=GOO)   # skull-ish face
        d.rect(345, 312, 375, 322, fill=GOO, r=3)
        for k, x in enumerate((560, 600, 630)): d.line([(x, 360 - k * 10), (x + 30, 330 - k * 10)], mix(GOO, DARK, 0.3), 6)
        return True
    if cid == 'scavenger':
        d.figure(230, 270, 1.15, mix(w, DARK, 0.1))
        d.rect(330, 250, 470, 285, fill=GREY, r=8)                                     # magazine flying in
        for k in range(5): d.bullet(360 + k * 24, 220, 50, 11, a, ang=-math.pi / 2)
        d.arc(420, 250, 120, 200, 340, a, 10); d.poly([(530, 210), (552, 250), (512, 245)], fill=a)
        d.circle(560, 330, 46, fill=RED); d.plus(560, 330, 0.7, WHITE) if hasattr(d, 'plus') else None
        d.line([(470, 330), (510, 330)], mix(a, DARK, 0.3), 6)
        return True
    if cid == 'squid':
        d.ellipse(350, 200, 85, 105, fill='#c46bff'); d.circle(320, 215, 16, fill=WHITE); d.circle(380, 215, 16, fill=WHITE)
        d.circle(323, 219, 7, fill=DARK); d.circle(383, 219, 7, fill=DARK)
        for k in range(6):
            x0 = 285 + k * 26; pts = [(x0 + math.sin(t * 0.9 + k) * 18, 280 + t * 22) for t in range(8)]
            d.line(pts, '#a24fe0', 14)
        for k, r in enumerate((150, 190, 230)): d.arc(350, 220, r, 300, 360, mix(a, DARK, 0.25 + k * 0.2), 5)
        for k in range(3): d.circle(560 + k * 30, 140 + k * 26, 7 + k * 3, fill=mix('#c46bff', WHITE, 0.4))
        return True
    if cid == 'bees':
        for k, (x, y) in enumerate(((260, 180), (420, 150), (330, 300), (500, 280))):
            d.ellipse(x, y, 46, 30, fill=YEL)
            for j in (-14, 6): d.rect(x + j, y - 28, x + j + 10, y + 28, fill=DARK)
            d.circle(x + 44, y, 14, fill=DARK); d.poly([(x - 46, y - 6), (x - 66, y), (x - 46, y + 6)], fill=DARK)
            d.ellipse(x - 6, y - 38, 22, 14, fill=mix(WHITE, '#bfe8ff', 0.5)); d.ellipse(x + 16, y - 36, 18, 12, fill=mix(WHITE, '#bfe8ff', 0.3))
            d.dashed([(x - 150, y + 40), (x - 80, y + 10)], mix(a, DARK, 0.3), 5, 10, 8)
        d.crosshair(600, 210, 40, a)
        return True
    if cid.startswith('echo-fire'):
        tiers = {'echo-fire': 1, 'echo-fire-uncommon': 2, 'echo-fire-rare': 3, 'echo-fire-legendary': 4}
        n = tiers.get(cid, 1)
        d.rect(80, 230, 260, 275, fill=mix(w, DARK, 0.15), r=10); d.rect(110, 270, 155, 340, fill=mix(w, DARK, 0.4), r=8)
        d.bullet(340, 252, 100, 22, w)
        for k in range(n):
            x = 445 + k * 62 + (4 - n) * 20; d.bullet(x, 252, 52, 18, mix(a, DARK, 0.15 * k))
        for k in range(n + 1): d.arc(330, 252, 60 + k * 26, 300, 60, mix(a, DARK, 0.2 + 0.15 * k), 5)
        return True
    if cid == 'shield-saiyan':
        # figure powering up: golden aura flames, swept-back spiky hair, sparks
        for k in range(9):
            ang = -math.pi / 2 + (k - 4) * 0.28
            flame(d, 350 + math.cos(ang) * 120, 300 + math.sin(ang) * 150, 1.3, mix(YEL, '#fff3b0', 0.3), WHITE, ang)
        d.ellipse(350, 300, 120, 165, fill=mix(YEL, DARK, 0.55))
        d.rect(305, 230, 395, 400, fill=w, r=45)                        # body (capsule)
        d.rect(318, 262, 382, 282, fill=DARK, r=7)                      # visor
        d.circle(338, 272, 5, fill='#4fe3ff'); d.circle(362, 272, 5, fill='#4fe3ff')
        # hair: swept back and up in layered spikes (not a crown)
        spikes = [(-50, 250, -95, 150), (-30, 238, -55, 112), (-6, 232, -10, 96), (18, 234, 38, 104), (40, 242, 85, 128), (55, 255, 118, 170)]
        for bx, by, tx, ty in spikes:
            d.poly([(350 + bx - 22, by + 8), (350 + tx, ty), (350 + bx + 26, by + 4)], fill=YEL)
        d.poly([(300, 262), (318, 228), (382, 226), (402, 258), (382, 246), (350, 240), (318, 250)], fill=YEL)
        d.poly([(330, 240), (350, 214), (360, 244)], fill=mix(YEL, WHITE, 0.35))
        for (x, y) in ((200, 200), (510, 190), (230, 380), (480, 400)): d.bolt(x, y, 0.45, mix('#9ee7ff', WHITE, 0.3))
        return True
    if cid == 'mod-critter':
        # a critter mid-leap, jaws open, a second one scuttling behind
        d.ellipse(380, 230, 90, 50, fill='#7fdcff'); d.circle(470, 215, 32, fill=DARK)
        d.poly([(490, 225), (545, 245), (495, 245)], fill=WHITE); d.poly([(490, 205), (545, 190), (497, 197)], fill=WHITE)
        d.circle(462, 205, 6, fill=YEL)
        for k in range(4): x = 330 + k * 30; d.line([(x, 265), (x - 30 - k * 4, 310 - k * 3)], DARK, 7)
        d.dashed([(150, 330), (230, 280), (300, 245)], mix(a, DARK, 0.3), 6, 14, 10)
        d.ellipse(190, 380, 50, 28, fill=mix('#7fdcff', DARK, 0.3)); d.circle(238, 375, 18, fill=DARK)
        for k in range(3): x = 165 + k * 22; d.line([(x, 400), (x - 10, 420)], DARK, 5)
        d.rect(80, 425, 620, 432, fill=mix(w, DARK, 0.6), r=3)
        return True
    return False


def rework(cid, d):
    if v26_art(cid, d): return True
    a, w = d.a, d.w
    # art review (AMON batch): the weakest pictures redrawn bigger and clearer
    if cid == 'mod-beam-rifle':
        d.rect(90, 230, 300, 280, fill=mix(w, DARK, 0.2), r=10); d.rect(130, 270, 175, 345, fill=mix(w, DARK, 0.4), r=8)
        d.rect(250, 215, 320, 236, fill=a, r=6); d.circle(320, 255, 22, fill=a)
        d.line([(330, 255), (470, 255), (530, 170), (640, 170)], mix(a, WHITE, 0.6), 26); d.line([(330, 255), (470, 255), (530, 170), (640, 170)], WHITE, 10)
        d.circle(470, 255, 16, fill=WHITE); d.circle(530, 170, 16, fill=WHITE)
        return True
    if cid == 'twin-barrel':
        d.rect(90, 210, 300, 238, fill=mix(w, DARK, 0.15), r=10); d.rect(90, 262, 300, 290, fill=mix(w, DARK, 0.15), r=10)
        d.rect(110, 238, 200, 262, fill=mix(w, DARK, 0.45)); d.rect(80, 205, 120, 295, fill=mix(w, DARK, 0.4), r=8)
        for ang, y in ((-0.22, 200), (0.22, 300)):
            d.bullet(450 + 40, y + (-30 if ang < 0 else 30), 140, 24, a, ang=ang)
            d.dashed([(310, 224 if ang < 0 else 276), (395, 205 if ang < 0 else 295)], mix(a, DARK, 0.3), 6, 12, 8)
        return True
    if cid == 'phase-step':
        for k, (x, t) in enumerate(((170, 0.75), (260, 0.55), (350, 0.3))):
            d.figure(x, 255, 1.0, mix(a, DARK, t), outline=k < 2)
        for y in (200, 255, 310): d.line([(50, y), (120, y)], mix(a, DARK, 0.5), 6)
        d.figure(470, 255, 1.1, w); d.shield(570, 250, 0.55, a, inner=mix(a, DARK, 0.45))
        return True
    if cid == 'shield-turret':
        d.circle(350, 270, 170, outline=a, width=10); d.circle(350, 270, 150, outline=mix(a, DARK, 0.5), width=4)
        d.turret(320, 300, 1.3, w)
        return True
    if cid == 'shield-gun-nest':   # v1.2.8: a sandbagged turret with a gunner behind it
        d.figure(185, 245, 1.25, mix(a, DARK, 0.1))
        d.turret(345, 270, 1.75, w); d.circle(362, 200, 14, fill=a)
        bag = mix(w, '#b8945a', 0.7)
        for x in range(205, 560, 70): d.rect(x - 34, 352, x + 34, 392, fill=bag, r=18)
        for x in range(240, 530, 70): d.rect(x - 34, 316, x + 34, 356, fill=mix(bag, WHITE, 0.15), r=18)
        for y in (185, 235): d.dashed([(560, y), (665, y)], a, 7, 16, 10)
        return True
    if cid == 'sentry-unit':
        d.turret(300, 290, 1.6, w); d.circle(330, 225, 10, fill=a)
        for y in (190, 250): d.dashed([(500, y), (640, y)], a, 6, 14, 10)
        return True
    if cid == 'spring-heels':
        d.line([(350 + (48 if k % 2 else -48), 410 - k * 16) for k in range(7)], a, 9)
        d.rect(290, 406, 410, 418, fill=mix(a, DARK, 0.4), r=5)
        d.rect(300, 300, 400, 312, fill=mix(a, DARK, 0.4), r=5)
        d.figure(350, 215, 1.2, w)
        for sx in (215, 485):
            for k in range(3): d.line([(sx + (k - 1) * 18, 330 - k * 8), (sx + (k - 1) * 18, 280 - k * 8)], mix(w, DARK, 0.3), 5)
    elif cid == 'wide-shells':
        d.circle(350, 250, 112, fill=a); d.circle(312, 212, 26, fill=mix(a, w, 0.7))
        d.circle(350, 250, 52, outline=mix(a, DARK, 0.45), width=5)
        for k in range(4):
            t = math.pi / 4 + k * math.pi / 2; c, s = math.cos(t), math.sin(t)
            d.line([(350 + c * 130, 250 + s * 130), (350 + c * 178, 250 + s * 178)], w, 9)
            d.poly([(350 + c * 196, 250 + s * 196), (350 + c * 168 - s * 18, 250 + s * 168 + c * 18), (350 + c * 168 + s * 18, 250 + s * 168 - c * 18)], fill=w)
    elif cid == 'heavy-slugs':
        d.wall(150, 380, 550, 396, w)
        d.bullet(350, 240, 230, 66, a, ang=math.pi / 2)
        for x in (250, 450):
            for k in range(3): d.line([(x + (k - 1) * 20, 150 + k * 12), (x + (k - 1) * 20, 210 + k * 12)], mix(w, DARK, 0.35), 5)
        for sd in (-1, 1):
            zig(d, [(350 + sd * 30, 396), (350 + sd * 70, 420), (350 + sd * 95, 412), (350 + sd * 140, 440)], mix(w, DARK, 0.25), 5)
            for k in range(3): d.circle(350 + sd * (110 + k * 32), 368 - k * 10, 14 - k * 3, fill=mix(w, DARK, 0.35))
    elif cid == 'padded-vest':
        d.figure(350, 250, 1.35, w)
        vest = mix(a, DARK, 0.45)
        for sd in (-1, 1):
            pts = [(350 + sd * 105, 175), (350 + sd * 52, 165), (350 + sd * 18, 245), (350 + sd * 18, 390), (350 + sd * 120, 390), (350 + sd * 128, 250)]
            d.poly(pts, fill=vest)
            for y in (270, 320, 365): d.line([(350 + sd * 26, y), (350 + sd * 118, y)], a, 5)
            d.line([(350 + sd * 72, 190), (350 + sd * 72, 385)], mix(a, DARK, 0.2), 4, caps=False)
    elif cid == 'hair-trigger':
        d.rect(150, 115, 540, 170, fill=w, r=10); d.rect(110, 128, 150, 156, fill=mix(w, DARK, 0.3), r=4)
        d.poly([(440, 165), (500, 165), (540, 330), (478, 340)], fill=mix(w, DARK, 0.2))
        d.arc(350, 175, 62, 0, 180, w, 9)
        d.line([(352, 168), (366, 200), (352, 228)], a, 14)
        for k in range(3): t = -0.9 + k * 0.45; d.line([(375 + math.cos(t) * 30, 220 + math.sin(t) * 30), (375 + math.cos(t) * 56, 220 + math.sin(t) * 56)], mix(w, DARK, 0.25), 5)
        feather(d, 270, 300, 175, -0.48, w, mix(a, DARK, 0.45))
    elif cid == 'field-rations':
        d.rect(320, 286, 575, 330, fill=w, r=6)
        d.line([(330, 293), (565, 293)], RED, 4, caps=False); d.line([(330, 323), (565, 323)], RED, 4, caps=False)
        d.plus(495, 308, 0.55, RED)
        d.circle(290, 240, 98, fill=mix(w, DARK, 0.15)); d.circle(290, 240, 84, fill=w)
        d.circle(290, 240, 66, outline=mix(w, DARK, 0.2), width=3); d.circle(290, 240, 48, outline=mix(w, DARK, 0.2), width=3)
        d.plus(290, 240, 1.25, RED)
    elif cid == 'big-iron':
        steel, dk = mix(w, DARK, 0.15), mix(w, DARK, 0.45)
        d.rect(330, 186, 585, 220, fill=w, r=5); d.rect(560, 176, 574, 190, fill=w, r=2)
        d.rect(355, 224, 520, 236, fill=dk, r=5)
        d.poly([(232, 176), (345, 176), (350, 252), (300, 266), (250, 252)], fill=steel)
        d.rect(262, 180, 352, 250, fill=a, r=14)
        for y in (198, 215, 232): d.line([(272, y), (342, y)], mix(a, DARK, 0.5), 5)
        d.poly([(236, 180), (206, 150), (222, 140), (258, 176)], fill=w)
        d.poly([(250, 250), (304, 258), (282, 372), (212, 378), (200, 352)], fill=WOOD)
        d.circle(250, 320, 9, fill=mix(WOOD, DARK, 0.5))
        d.arc(322, 262, 30, 0, 180, steel, 7); d.line([(318, 258), (326, 284)], w, 6)
        d.star(500, 330, 46, 20, 5, YEL, rot=-math.pi / 2); d.circle(500, 330, 10, fill=mix(YEL, DARK, 0.4))
    elif cid == 'incendiary-rounds':
        ang = -0.28; c, sn = math.cos(ang), math.sin(ang)
        bx, by = 430, 225
        T = lambda u, v: (bx + u * c - v * sn, by + u * sn + v * c)
        for col, k in ((RED, 1.0), (ORANGE, 0.72), (YEL, 0.42)):
            top = [T(-30 - 320 * t * k, -(46 * k) * (1 - t) ** 0.7 * (1 + 0.28 * math.sin(t * 19))) for t in [i / 30 for i in range(31)]]
            bot = [T(-30 - 320 * t * k, (46 * k) * (1 - t) ** 0.7 * (1 + 0.28 * math.sin(t * 19 + 2))) for t in [i / 30 for i in range(30, -1, -1)]]
            d.poly(top + bot, fill=col)
        d.bullet(bx, by, 200, 34, mix(w, ORANGE, 0.22), ang=ang)
        for u, v, r in ((-150, -80, 7), (-230, 70, 6), (-300, -40, 5), (-110, 85, 5), (-340, 30, 4), (-190, -95, 4)):
            d.circle(*T(u, v), r, fill=ORANGE if r > 5 else YEL)
    elif cid == 'leech-rounds':
        fangs(d, 350, 200, 1.0, '#8a2333')
        d.drop(440, 345, 0.42, RED); d.drop(258, 330, 0.3, RED)
        d.plus(545, 330, 0.75, a)
    elif cid == 'mirror-edge':
        top, right, bot, left = (360, 120), (450, 250), (360, 380), (270, 250)
        d.poly([top, right, bot, left], fill=mix(a, w, 0.35)); d.poly([top, right, (360, 250)], fill=mix(a, w, 0.7)); d.poly([left, bot, (360, 250)], fill=mix(a, DARK, 0.25))
        d.poly([(320, 180), (338, 160), (300, 290), (284, 262)], fill=w)
        d.line([(120, 150), (282, 238)], w, 7); d.line([(282, 250), (150, 345)], a, 7); d.bullet(150, 345, 60, 12, a, ang=math.atan2(95, -132))
        d.star(470, 150, 26, 6, 4, w); d.star(500, 340, 16, 4, 4, w); d.star(225, 160, 12, 3, 4, a)
    elif cid == 'seeker-chip':
        d.dashed(curve((255, 330), (480, 360), (488, 215)), a, 7, 18, 12)
        d.crosshair(495, 165, 40, w, 7)
        d.rect(170, 290, 250, 370, fill=a, r=8); d.rect(190, 310, 230, 350, fill=DARK, r=4)
        for k in range(3):
            o = 305 + k * 25
            for p in ((158, o, 170, o), (250, o, 262, o), (o - 120, 278, o - 120, 290), (o - 120, 370, o - 120, 382)): d.line([(p[0], p[1]), (p[2], p[3])], w, 5)
    elif cid == 'shrapnel-rounds':
        d.bullet(175, 250, 110, 20, w)
        for k in range(3): d.line([(70, 230 + k * 20), (110, 230 + k * 20)], mix(w, DARK, 0.4), 4)
        d.star(350, 250, 58, 24, 8, YEL)
        for k in range(8):
            t = k * 2 * math.pi / 8 + 0.2; c, s = math.cos(t), math.sin(t); R = 140 + (k % 2) * 25
            x, y = 350 + c * R, 250 + s * R
            d.poly([(x + c * 22, y + s * 22), (x - s * 14 - c * 8, y + c * 14 - s * 8), (x + s * 10 - c * 14, y - c * 10 - s * 14)], fill=a)
            d.line([(350 + c * (R - 70), 250 + s * (R - 70)), (350 + c * (R - 36), 250 + s * (R - 36))], mix(w, DARK, 0.3), 4)
    elif cid == 'tommy-gun':
        steel, dk = mix(w, DARK, 0.15), mix(w, DARK, 0.4)
        d.poly([(95, 215), (220, 200), (220, 252), (105, 290)], fill=WOOD)
        d.rect(215, 192, 405, 242, fill=w, r=6); d.rect(240, 182, 300, 194, fill=steel, r=3)
        d.rect(400, 205, 545, 230, fill=steel, r=4)
        for x in range(412, 532, 15): d.rect(x, 197, x + 7, 238, fill=dk, r=2)
        d.rect(545, 200, 585, 235, fill=w, r=4)
        d.poly([(262, 240), (300, 240), (290, 330), (252, 326)], fill=WOOD)
        d.poly([(420, 230), (452, 230), (456, 305), (424, 307)], fill=WOOD)
        d.circle(355, 288, 58, fill=a); d.circle(355, 288, 40, outline=mix(a, DARK, 0.4), width=5); d.circle(355, 288, 14, fill=DARK)
        d.arc(286, 254, 22, 0, 180, steel, 6)
    elif cid == 'troll-blood':
        troll(d, 320, 255, 1.1, a)
        d.drop(510, 210, 0.75, RED); d.plus(560, 320, 0.7, w)
    elif cid == 'hex-rounds':
        P2, DP = '#7b2cbf', '#3b0a4a'
        d.circle(350, 250, 165, fill=mix(DP, DARK, 0.4))
        d.circle(350, 250, 160, outline=P2, width=6); d.circle(350, 250, 136, outline=mix(P2, DARK, 0.45), width=3)
        for k in range(16):
            t = k * math.pi / 8; d.line([(350 + math.cos(t) * 168, 250 + math.sin(t) * 168), (350 + math.cos(t) * 190, 250 + math.sin(t) * 190)], P2, 5)
        for o in (0, math.pi):
            pts = [(350 + math.cos(o - math.pi / 2 + i * 2 * math.pi / 3) * 132, 250 + math.sin(o - math.pi / 2 + i * 2 * math.pi / 3) * 132) for i in range(3)]
            d.line(pts + [pts[0]], mix(P2, DARK, 0.25), 4, caps=False)
        eye = [(250 + t * 200, 250 - math.sin(math.pi * t) * 48) for t in [i / 20 for i in range(21)]] + [(250 + t * 200, 250 + math.sin(math.pi * t) * 48) for t in [i / 20 for i in range(20, -1, -1)]]
        d.poly(eye, fill='#1a0622'); d.line(eye[:21], '#c45bff', 5)
        d.circle(350, 250, 36, fill=RED); d.ellipse(350, 250, 7, 30, fill=DARK)
    elif cid == 'regretful-pact':
        fl, fi = '#7b3fe0', '#c79bff'
        pts = []
        for k in range(8): pts.append((240 + k * 31, 130, 0, -1)); pts.append((240 + k * 31, 370, 0, 1))
        for k in range(1, 8): pts.append((240, 130 + k * 30, -1, 0)); pts.append((460, 130 + k * 30, 1, 0))
        for i, (x, y, nx, ny) in enumerate(pts):
            L = 34 + (i * 37 % 5) * 7; t = math.atan2(ny, nx)
            flame(d, x, y, L / 70, fl, fi, t)
        d.rect(250, 140, 450, 360, fill='#d6c7a2', r=6); d.circle(250, 140, 22, fill='#b9aa86'); d.circle(450, 360, 22, fill='#b9aa86')
        for y in (190, 225, 260): d.line([(285, y), (415, y)], '#6e5f44', 5)
        d.circle(395, 315, 30, fill='#a8232e')
    elif cid == 'repentance':
        for k in range(12):
            t = k * math.pi / 6; d.poly([(350, 250), (350 + math.cos(t - 0.1) * 230, 250 + math.sin(t - 0.1) * 230), (350 + math.cos(t + 0.1) * 230, 250 + math.sin(t + 0.1) * 230)], fill=mix(YEL, DARK, 0.62))
        tear = [(340, 150), (325, 185), (345, 215), (322, 250), (344, 290), (326, 330), (340, 360)]
        d.poly([(240, 160), (340, 150)] + tear[1:] + [(250, 372)], fill='#e8dcc0')
        d.poly([(360, 140)] + [(x + 40, y - 6) for x, y in tear[1:]] + [(470, 356), (468, 146)], fill='#e8dcc0')
        for y in (195, 230): d.line([(265, y + 2), (318, y)], '#8a7a5a', 5); d.line([(395, y - 6), (445, y - 6)], '#8a7a5a', 5)
        d.d.pieslice([(320 - 26) * S, (318 - 26) * S, (320 + 26) * S, (318 + 26) * S], 90, 270, fill=rgb('#a8232e'))
        d.d.pieslice([(372 - 26) * S, (312 - 26) * S, (372 + 26) * S, (312 + 26) * S], 270, 450, fill=rgb('#a8232e'))
        d.ellipse(355, 96, 60, 16, outline=YEL, width=7)
    elif cid == 'scp':
        def side(p0, p2, out):
            m = ((p0[0] + p2[0]) / 2 + out[0], (p0[1] + p2[1]) / 2 + out[1]); return curve(p0, m, p2, 20)
        def pillow(cx, cy, hw, hh, bow, ear):
            c = [(cx - hw - ear, cy - hh - ear), (cx + hw + ear, cy - hh - ear), (cx + hw + ear, cy + hh + ear), (cx - hw - ear, cy + hh + ear)]
            return side(c[0], c[1], (0, -bow)) + side(c[1], c[2], (bow, 0)) + side(c[2], c[3], (0, bow)) + side(c[3], c[0], (-bow, 0))
        cloth = mix(w, a, 0.12)
        d.ellipse(352, 360, 165, 16, fill=mix(DARK, '#000000', 0.2))
        d.poly(pillow(350, 256, 130, 66, 36, 24), fill=mix(cloth, DARK, 0.28))
        d.poly(pillow(347, 249, 127, 63, 36, 24), fill=cloth)
        d.ellipse(305, 212, 70, 22, fill=mix(cloth, WHITE, 0.6))
        for x, y, dx, dy in ((196, 158, 1, 1), (504, 158, -1, 1), (504, 338, -1, -1), (196, 338, 1, -1)):
            d.line(curve((x + dx * 10, y + dy * 6), (x + dx * 34, y + dy * 18), (x + dx * 54, y + dy * 14), 10), mix(cloth, DARK, 0.3), 4, caps=False)
        d.circle(350, 250, 9, fill=mix(cloth, DARK, 0.35))
        for t in (0, 1.57, 3.14, 4.71): d.line([(350 + math.cos(t) * 14, 250 + math.sin(t) * 10), (350 + math.cos(t) * 30, 250 + math.sin(t) * 20)], mix(cloth, DARK, 0.25), 3, caps=False)
        d.bullet(575, 115, 70, 14, w, ang=math.atan2(70, -80)); d.dashed(curve((525, 165), (480, 210), (610, 235)), mix(w, DARK, 0.25), 5, 12, 10)
    elif cid == 'splinter-bounce':
        d.wall(500, 110, 516, 390, w)
        zig(d, [(160, 250), (490, 250)], a)
        for (x, y, wd) in ((300, 140, 6), (300, 360, 6), (250, 200, 4), (250, 300, 4)):
            zig(d, [(490, 250), (x, y)], a, wd); d.bullet(x, y, 34, 7, a, ang=math.atan2(y - 250, x - 490))
        d.star(492, 250, 40, 14, 8, YEL)
        for (x, y, t) in ((540, 190, 0.5), (548, 300, -0.4), (560, 245, 0.1)):
            d.poly([(x, y), (x + 26 * math.cos(t), y + 26 * math.sin(t)), (x + 6, y + 10)], fill=w)
    elif cid == 'sticky-bombs':
        brick = mix(w, DARK, 0.45)
        d.rect(470, 80, 620, 420, fill=brick, r=3)
        for k, y in enumerate(range(80, 420, 40)):
            d.line([(470, y), (620, y)], mix(brick, DARK, 0.35), 3, caps=False)
            for x in ((520, 580) if k % 2 else (500, 560)): d.line([(x, y), (x, min(y + 40, 420))], mix(brick, DARK, 0.35), 3, caps=False)
        blob = [(470 + math.cos(t) * 20 * (0.6 + 0.4 * abs(math.sin(t * 3.5))), 250 + math.sin(t) * 105 * (0.75 + 0.25 * math.cos(t * 5))) for t in [i * math.pi / 24 for i in range(48)]]
        d.poly(blob, fill=GOO)
        d.ellipse(462, 250, 20, 84, fill=GOO)
        for x, y1, r in ((462, 380, 11), (478, 405, 9), (450, 345, 8)): d.line([(x, 300), (x, y1)], GOO, r * 1.4); d.circle(x, y1 + 4, r, fill=GOO)
        d.bomb(392, 250, 1.0, a)
        for y0, y1 in ((205, 214), (292, 288)): d.line(curve((410, y0), (432, y0 - 4), (452, y1)), GOO, 7)
        d.ellipse(452, 250, 7, 34, fill=GOO)
        d.circle(372, 232, 9, fill=RED)
        for k in range(3): t = 2.3 + k * 0.4; d.line([(372 + math.cos(t) * 18, 232 + math.sin(t) * 18), (372 + math.cos(t) * 32, 232 + math.sin(t) * 32)], RED, 4)
    elif cid == 'shield-pentagram':
        blood, ember, dk = '#a8232e', '#ff5a3d', '#2a0a14'
        for k in range(7):
            t = math.pi + 0.25 + k * (math.pi - 0.5) / 6; d.poly([(350, 320), (350 + math.cos(t - 0.06) * 260, 320 + math.sin(t - 0.06) * 260), (350 + math.cos(t + 0.06) * 260, 320 + math.sin(t + 0.06) * 260)], fill=mix(blood, DARK, 0.55))
        d.ellipse(350, 330, 200, 64, fill=mix('#3b0a4a', DARK, 0.3))
        for k in range(18):
            t = k * 2 * math.pi / 18; x, y = 350 + math.cos(t) * 190, 330 + math.sin(t) * 58
            d.poly([(x - 9, y + 6), (x - 3, y - 22), (x + 1, y - 2), (x + 7, y - 26), (x + 10, y + 6)], fill='#4a2a2a')
        pts = [(350 + math.cos(-math.pi / 2 + k * 4 * math.pi / 5) * 150, 330 + math.sin(-math.pi / 2 + k * 4 * math.pi / 5) * 46) for k in range(5)]
        d.ellipse(350, 330, 160, 50, outline='#c45bff', width=5)
        d.line(pts + [pts[0]], '#c45bff', 5, caps=False)
        for x, y in ((290, 318), (410, 340), (350, 352), (250, 340), (450, 322)):
            d.rect(x - 7, y - 26, x + 7, y, fill='#efe6d2', r=3); d.ellipse(x, y - 34, 5, 9, fill='#ffb347')
    elif cid == 'shield-spaceking':
        gold, armor, trim = '#ffd23a', '#2f5fae', '#cfd6ea'
        for k in range(7):
            t = math.pi + 0.25 + k * (math.pi - 0.5) / 6; d.poly([(350, 300), (350 + math.cos(t - 0.06) * 260, 300 + math.sin(t - 0.06) * 260), (350 + math.cos(t + 0.06) * 260, 300 + math.sin(t + 0.06) * 260)], fill=mix(gold, DARK, 0.6))
        for sd in (-1, 1):
            d.ellipse(350 + sd * 118, 330, 78, 58, fill=armor); d.ellipse(350 + sd * 118, 318, 60, 34, fill=mix(armor, WHITE, 0.25))
            d.rect(350 + sd * 118 - 50, 344, 350 + sd * 118 + 50, 354, fill=gold, r=4)
        d.rect(268, 300, 432, 420, fill=mix(armor, DARK, 0.15), r=20)
        d.poly([(350, 312), (318, 344), (350, 400), (382, 344)], fill=gold)
        d.rect(278, 160, 422, 300, fill=armor, r=48)
        d.poly([(290, 214), (410, 214), (400, 240), (300, 240)], fill='#9be7ff')
        d.line([(305, 222), (360, 222)], WHITE, 4, caps=False)
        d.rect(318, 256, 382, 292, fill=mix(armor, DARK, 0.35), r=10)
        for x in (334, 350, 366): d.line([(x, 262), (x, 286)], trim, 4, caps=False)
        d.poly([(296, 168), (296, 124), (318, 146), (350, 108), (382, 146), (404, 124), (404, 168)], fill=gold)
        for x in (318, 350, 382): d.circle(x, 152, 7, fill=RED)
        d.ellipse(350, 92, 64, 14, outline=gold, width=6)
    elif cid == 'mod-flamethrower':
        d.rect(105, 195, 175, 335, fill=a, r=30); d.rect(120, 215, 160, 228, fill=mix(a, DARK, 0.4), r=4)
        d.line([(175, 300), (215, 300), (215, 285)], mix(w, DARK, 0.4), 8)
        d.rect(195, 250, 320, 290, fill=w, r=8); d.poly([(230, 288), (262, 288), (252, 345), (222, 342)], fill=mix(w, DARK, 0.2))
        d.rect(318, 258, 360, 282, fill=mix(w, DARK, 0.3), r=4)
        cone = [(360, 255), (420, 220), (465, 205), (505, 172), (545, 195), (600, 158), (590, 230), (615, 272), (588, 312), (602, 372), (552, 345), (505, 368), (462, 334), (418, 320), (360, 284)]
        for k, col in ((1.0, ORANGE), (0.66, YEL), (0.33, w)):
            d.poly([(360 + (x - 360) * k, 270 + (y - 270) * k) for x, y in cone], fill=col)
    elif cid == 'tiny-tank':
        d.rect(200, 285, 500, 345, fill=DARK, r=30)
        for x in (270, 350, 430): d.circle(x, 315, 20, fill=GREY)
        d.rect(220, 240, 480, 292, fill=a, r=14)
        d.rect(290, 180, 410, 248, fill=a, r=32)
        d.rect(400, 200, 545, 222, fill=GREY, r=8)
    # ---- cards that had no art yet
    elif cid == 'stutter-trigger':
        d.bullet(450, 250, 150, 26, w); d.bullet(270, 250, 150, 26, mix(a, DARK, 0.25))
        for k in range(3): d.line([(110, 215 + k * 35), (170, 215 + k * 35)], mix(w, DARK, 0.4), 5)
    elif cid == 'afterclap':
        d.bullet(430, 250, 170, 28, w); d.bullet(250, 250, 150, 24, mix(a, DARK, 0.45))
        for k in range(5): t = -0.9 + k * 0.45; d.line([(540 + math.cos(t) * 30, 250 + math.sin(t) * 30), (540 + math.cos(t) * 64, 250 + math.sin(t) * 64)], a, 6)
    elif cid == 'loose-sear':
        gear(d, 285, 255, 95, 10, a); zig(d, [(250, 175), (275, 225), (258, 260), (290, 300)], DARK, 6)
        d.bullet(480, 205, 120, 20, w, ang=-0.12); d.bullet(470, 300, 120, 20, w, ang=0.15)
    elif cid == 'second-thought':
        bubble(d, 380, 210, 160, 100, w, -1)
        d.circle(205, 345, 22, fill=w); d.circle(170, 385, 13, fill=w)
        d.bullet(330, 210, 110, 22, a); d.bullet(450, 210, 110, 22, mix(a, DARK, 0.3))
    elif cid == 'call-and-response':
        bubble(d, 240, 190, 120, 72, w, 1); d.bullet(240, 190, 110, 20, a)
        bubble(d, 460, 320, 120, 72, a, -1); d.bullet(460, 320, 110, 20, w)
    elif cid == 'rolling-thunder':
        for x, y, r in ((280, 180, 55), (345, 150, 70), (420, 180, 55), (350, 200, 60)): d.circle(x, y, r, fill=mix(w, DARK, 0.2))
        d.bolt(340, 300, 1.15, a)
        d.bullet(490, 330, 90, 16, w); d.bullet(530, 280, 90, 16, w)
    elif cid == 'encore-engine':
        gear(d, 280, 250, 110, 12, w, DARK); d.circle(280, 250, 30, fill=a)
        d.arc(280, 250, 140, 300, 40, a, 8)
        d.bullet(480, 215, 130, 22, a); d.bullet(500, 290, 130, 22, a)
    elif cid == 'standing-ovation':
        d.poly([(110, 100), (220, 100), (190, 250), (220, 400), (110, 400)], fill=mix(RED, DARK, 0.25))
        d.poly([(590, 100), (480, 100), (510, 250), (480, 400), (590, 400)], fill=mix(RED, DARK, 0.25))
        d.poly([(320, 100), (380, 100), (470, 380), (230, 380)], fill=mix(YEL, DARK, 0.6))
        d.wall(150, 380, 550, 396, w)
        for k in (-1, 0, 1): d.bullet(350 + k * 60, 250 - (k == 0) * 30, 120, 22, a if k else w, ang=-math.pi / 2 + k * 0.35)
        d.star(260, 160, 18, 5, 4, w); d.star(450, 140, 14, 4, 4, w)
    elif cid == 'drain-life':
        d.figure(220, 265, 0.95, a); d.figure(490, 265, 0.95, w, outline=True)
        pts = [(450 - t * 190, 230 + math.sin(t * 12) * 16) for t in [i / 40 for i in range(41)]]
        d.line(pts, RED, 7)
        for x in (300, 370): d.drop(x, 300, 0.22, RED)
    elif cid == 'shield-grove':
        gold = '#ffe08a'
        for k in range(7):
            t = math.pi + 0.25 + k * (math.pi - 0.5) / 6; d.poly([(350, 320), (350 + math.cos(t - 0.06) * 260, 320 + math.sin(t - 0.06) * 260), (350 + math.cos(t + 0.06) * 260, 320 + math.sin(t + 0.06) * 260)], fill=mix(gold, DARK, 0.6))
        d.ellipse(350, 330, 200, 64, fill=mix('#4caf50', DARK, 0.45))
        for k in range(18):
            t = k * 2 * math.pi / 18; x, y = 350 + math.cos(t) * 190, 330 + math.sin(t) * 58
            d.poly([(x - 10, y + 6), (x - 4, y - 26), (x + 1, y - 4), (x + 6, y - 30), (x + 10, y + 6)], fill='#6fd36a')
        for x, y in ((300, 320), (380, 340), (350, 310), (420, 318), (275, 345)):
            for k in range(5): d.circle(x + math.cos(k * 1.2566) * 9, y + math.sin(k * 1.2566) * 9, 7, fill=w)
            d.circle(x, y, 6, fill=YEL)
        d.ellipse(350, 160, 50, 14, outline=gold, width=7)
    elif cid == 'mod-breaker':
        d.d.pieslice([(240 - 95) * S, (255 - 95) * S, (240 + 95) * S, (255 + 95) * S], 90, 270, fill=rgb(w))
        d.d.pieslice([(320 - 95) * S, (245 - 95) * S, (320 + 95) * S, (245 + 95) * S], 270, 450, fill=rgb(a))
        for x, y, c in ((240, 255, DARK), (320, 245, DARK)): d.circle(x, y, 26, fill=c)
        d.line([(430, 140), (530, 370)], mix(w, DARK, 0.2), 18); d.rect(400, 110, 470, 160, fill=mix(w, DARK, 0.2), r=8)
        for k in range(4): t = -1.2 + k * 0.8; d.line([(280 + math.cos(t) * 120, 250 + math.sin(t) * 120), (280 + math.cos(t) * 150, 250 + math.sin(t) * 150)], YEL, 5)
    # ---- new combos
    elif cid == 'wildfire':
        d.star(350, 250, 60, 26, 8, YEL)
        for k in range(7):
            t = k * 2 * math.pi / 7 + 0.3; R = 105 + (k % 2) * 25
            d.line([(350 + math.cos(t) * 60, 250 + math.sin(t) * 60), (350 + math.cos(t) * (R - 10), 250 + math.sin(t) * (R - 10))], mix(w, DARK, 0.35), 4)
            flame(d, 350 + math.cos(t) * R, 250 + math.sin(t) * R, 1.05, ORANGE, a, t)
    elif cid == 'plague-doctor':
        cloak, hat, leather, bone = '#262a35', '#1c1f28', '#3b3340', '#e6d6ae'
        d.poly([(190, 420), (230, 320), (300, 285), (380, 290), (450, 330), (480, 420)], fill=cloak)
        d.poly([(300, 285), (340, 330), (380, 290)], fill=mix(cloak, WHITE, 0.12))
        d.circle(330, 220, 74, fill=leather)
        beak = curve((372, 188), (500, 215), (575, 300), 16) + curve((575, 300), (470, 268), (378, 262), 16)
        d.poly(beak, fill=bone)
        for t in (0.25, 0.45, 0.65): x0, y0 = curve((372, 188), (500, 215), (575, 300), 20)[int(t * 20)]; x1, y1 = curve((378, 262), (470, 268), (575, 300), 20)[int(t * 20)]; d.line([(x0, y0), (x1, y1)], mix(bone, DARK, 0.35), 3, caps=False)
        d.rect(360, 180, 382, 268, fill=mix(leather, DARK, 0.3), r=8)
        d.circle(338, 208, 26, fill=mix(leather, DARK, 0.4)); d.circle(338, 208, 19, fill=a); d.circle(331, 201, 6, fill=WHITE)
        d.ellipse(330, 152, 140, 20, fill=hat); d.rect(262, 72, 392, 156, fill=hat, r=12)
        d.rect(262, 128, 392, 144, fill=mix(GOO, DARK, 0.45))
        d.drop(150, 320, 0.6, GOO); d.drop(108, 380, 0.3, GOO)
        d.plus(560, 140, 0.9, w)
    elif cid == 'storm-caller':
        nodes = [(170, 170), (350, 320), (530, 180)]
        for p, q in zip(nodes, nodes[1:]):
            mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
            zig(d, [p, (mx - 20, my - 30), (mx + 20, my + 20), q], a, 10)
        for x, y in nodes:
            for k in range(3): t = k * math.pi / 3; d.line([(x - math.cos(t) * 40, y - math.sin(t) * 40), (x + math.cos(t) * 40, y + math.sin(t) * 40)], w, 7)
            d.circle(x, y, 10, fill=w)
    elif cid == 'curse-eater':
        d.circle(350, 300, 90, fill='#4a1466'); d.circle(350, 300, 70, outline='#c45bff', width=5)
        d.ellipse(350, 300, 40, 16, fill='#1a0622'); d.circle(350, 300, 12, fill=RED)
        fangs(d, 350, 150, 0.85, '#8a2333')
        d.plus(540, 330, 0.7, a)
    elif cid == 'thick-hide':
        troll(d, 350, 230, 1.0, '#5fe3a1')
        d.poly([(230, 330), (470, 330), (440, 410), (260, 410)], fill=mix(a, DARK, 0.35))
        for x in (300, 350, 400): d.line([(x, 335), (x, 405)], a, 5)
        d.plus(540, 170, 0.8, a)
    elif cid == 'overture':
        d.rect(170, 238, 330, 262, fill=a, r=10)
        for x in (220, 250, 280): d.rect(x - 7, 205, x + 7, 240, fill=mix(a, DARK, 0.25), r=3)
        d.poly([(320, 235), (430, 170), (430, 330), (320, 265)], fill=a)
        d.ellipse(430, 250, 20, 80, fill=mix(a, DARK, 0.4))
        d.bullet(510, 210, 90, 16, w, ang=-0.2); d.bullet(540, 280, 90, 16, w, ang=0.15)
        d.d.arc([(150) * S, (215) * S, (200) * S, (285) * S], 90, 270, fill=rgb(a), width=8 * S)
    elif cid == 'demolition':
        brick, mortar = '#b5563c', '#6e2f22'
        rows = [(110, 0), (150, 1), (190, 0), (230, 1), (270, 0), (310, 1), (350, 0)]
        for y, off in rows:
            for k in range(6):
                x0 = 110 + k * 70 - off * 35
                if x0 < 110: continue
                gone = math.hypot(x0 + 30 - 360, y + 20 - 230) < 120
                if not gone: d.rect(x0, y, min(x0 + 66, 530), y + 36, fill=brick, r=3)
        d.rect(100, 386, 540, 400, fill=mortar, r=3)
        d.star(330, 235, 150, 70, 12, mix(RED, ORANGE, 0.4), rot=0.1)
        d.star(330, 235, 105, 50, 10, ORANGE)
        d.star(330, 235, 60, 28, 8, YEL)
        d.star(470, 160, 72, 34, 9, ORANGE, rot=0.3); d.star(470, 160, 40, 18, 7, YEL)
        for x, y, t in ((560, 110, 0.4), (585, 260, -0.3), (130, 120, 0.8), (115, 300, -0.6), (520, 360, 0.2), (200, 70, -0.2)):
            c, sn = math.cos(t), math.sin(t); d.poly([(x - 22 * c + 11 * sn, y - 22 * sn - 11 * c), (x + 22 * c + 11 * sn, y + 22 * sn - 11 * c), (x + 22 * c - 11 * sn, y + 22 * sn + 11 * c), (x - 22 * c - 11 * sn, y - 22 * sn + 11 * c)], fill=brick)
        d.ellipse(300, 395, 70, 12, fill=GOO)
    else: return False
    return True

# ---------------------------------------------------------------- v1.2.15 round-2 cards (Devin): same flat glyph style
GOLD = '#ffd23a'
def tcg_art(cid, d):
    a, w = d.a, d.w
    if cid == 'gilded-shell':
        d.ellipse(350, 255, 150, 180, fill=GOLD); d.ellipse(350, 255, 120, 150, fill=mix(GOLD, '#ffffff', 0.35))
        d.figure(350, 270, 0.85, DARK)
        zig(d, [(250, 150), (300, 205), (275, 240), (330, 290)], DARK, 6)
        for x, y in ((520, 140), (180, 380), (540, 360)): d.star(x, y, 24, 9, 4, GOLD)
    elif cid == 'backpedal-boots':
        d.crosshair(560, 250, 48, a)
        d.figure(330, 250, 1.0, w)
        for y in (200, 250, 300): d.line([(250, y), (120, y)], mix(a, DARK, 0.3), 8); d.chevron(110, y, 0.35, a, 9)
        d.rect(270, 315, 330, 350, fill=WOOD, r=8); d.rect(330, 315, 395, 350, fill=WOOD, r=8)
    elif cid == 'opening-salvo':
        d.poly([(140, 210), (260, 180), (260, 320), (140, 290)], fill=GOLD); d.ellipse(270, 250, 30, 80, fill=mix(GOLD, DARK, 0.2))
        for k in range(3): d.bullet(400 + k * 80, 180 + k * 60, 110, 20, a, ang=0.1 * (k - 1))
        d.arc(240, 250, 120, -40, 40, w, 6); d.arc(240, 250, 160, -35, 35, w, 6)
    elif cid == 'tight-chamber':
        d.circle(330, 250, 150, fill=mix(w, DARK, 0.35)); d.circle(330, 250, 40, fill=DARK)
        for k in range(6):
            ang = k * math.pi / 3; x, y = 330 + math.cos(ang) * 95, 250 + math.sin(ang) * 95
            d.circle(x, y, 32, fill=DARK if k else a)
        d.bullet(560, 250, 150, 36, a); d.star(330 + 95, 250, 55, 20, 8, YEL)
    elif cid == 'cold-barrel':
        d.rect(100, 225, 420, 275, fill=mix('#bfe8ff', DARK, 0.2), r=12); d.rect(140, 270, 190, 350, fill=mix(w, DARK, 0.4), r=8)
        for k in range(5): d.line([(150 + k * 60, 225), (150 + k * 60, 205 - 10 * (k % 2))], '#e8f6ff', 6)
        for x, y in ((200, 150), (330, 140), (260, 380)):
            for k in range(3): ang = k * math.pi / 3; d.line([(x - math.cos(ang) * 26, y - math.sin(ang) * 26), (x + math.cos(ang) * 26, y + math.sin(ang) * 26)], '#e8f6ff', 6)
        d.bullet(560, 250, 170, 30, a)
    elif cid == 'light-frame':
        d.figure(260, 250, 1.25, mix(w, DARK, 0.6), outline=True)
        d.figure(260, 265, 0.95, w)
        feather(d, 470, 330, 260, -1.0, a, mix(a, DARK, 0.5))
    elif cid == 'pressure-stack':
        d.figure(520, 260, 1.0, mix(w, DARK, 0.2))
        for k in range(5): d.rect(120 + k * 62, 360 - k * 45, 170 + k * 62, 380, fill=mix(a, '#ff6a2a', k / 4), r=6)
        d.line([(130, 330), (420, 150)], w, 8); d.poly([(440, 135), (395, 150), (430, 185)], fill=w)
    elif cid == 'last-stand-rig':
        d.rect(170, 330, 530, 360, fill=DARK, r=10); d.rect(175, 335, 300, 355, fill=RED, r=8)
        d.figure(350, 220, 0.95, w); d.circle(350, 220, 130, outline=a, width=10)
        for y in (180, 230, 280): d.line([(150, y), (210, y)], a, 7)
    elif cid == 'ammo-leech':
        for k in range(3): d.bullet(470 + k * 30, 200 + k * 50, 120, 20, mix(w, DARK, 0.3 * k), ang=-0.2)
        d.ellipse(240, 250, 110, 80, fill=PURP); d.circle(300, 230, 14, fill=w)
        fangs(d, 330, 260, 0.9, PURP)
        d.dashed([(350, 250), (460, 210)], a, 6, 12, 8)
    elif cid == 'afterimage':
        for k, t in enumerate((0.8, 0.6, 0.35)): d.figure(180 + k * 90, 255, 1.0, mix(a, DARK, t), outline=k < 2)
        d.figure(500, 255, 1.1, w)
        for k in range(3): d.critter(200 + k * 10, 120 + k * 15, 0.25, YEL)
    elif cid == 'overpen-rounds':
        d.figure(300, 255, 1.0, mix(w, DARK, 0.3)); d.figure(520, 265, 0.9, mix(w, DARK, 0.5))
        d.line([(80, 250), (620, 250)], a, 10); d.bullet(620, 250, 90, 18, a)
        d.star(300, 250, 40, 16, 7, YEL)
    elif cid == 'spite-charge':
        d.ellipse(350, 360, 190, 40, outline=RED, width=8); d.ellipse(350, 360, 130, 26, outline=mix(RED, DARK, 0.4), width=6)
        d.bomb(350, 250, 1.2, DARK); d.star(372, 140, 30, 12, 6, ORANGE)
        d.circle(330, 250, 12, fill=RED); d.circle(370, 250, 12, fill=RED)
    elif cid == 'running-gun':
        d.figure(330, 250, 1.0, w)
        for y in (200, 250, 300): d.line([(240, y), (130, y)], mix(a, DARK, 0.3), 8)
        d.rect(370, 235, 520, 260, fill=mix(w, DARK, 0.3), r=6)
        for k in range(3): d.bullet(560 + k * 40, 210 + k * 35, 60, 12, a)
    elif cid == 'ground-pound':
        d.wall(110, 380, 590, 400, w)
        d.figure(350, 230, 1.0, w); d.line([(350, 60), (350, 140)], a, 10); d.poly([(320, 130), (380, 130), (350, 160)], fill=a)
        for s in (-1, 1):
            for k in range(3): d.arc(350 + s * (120 + k * 55), 380, 40 + k * 10, 200 if s < 0 else 290, 250 if s < 0 else 340, a, 7)
        for x in (170, 530): d.figure(x, 290, 0.5, mix(w, DARK, 0.5))
    elif cid == 'perfect-parry':
        d.shield(300, 250, 1.1, w, inner=mix(a, DARK, 0.3))
        d.star(420, 220, 90, 26, 4, '#ffffff', rot=0.3)
        d.bullet(560, 220, 110, 20, mix(w, DARK, 0.5), ang=math.pi)
        for k in range(6): ang = k * math.pi / 3; d.line([(420 + math.cos(ang) * 100, 220 + math.sin(ang) * 100), (420 + math.cos(ang) * 130, 220 + math.sin(ang) * 130)], w, 5)
    elif cid == 'battle-rhythm':
        d.ellipse(230, 300, 120, 50, fill=mix(a, DARK, 0.4)); d.rect(110, 230, 350, 300, fill=RED, r=4); d.ellipse(230, 230, 120, 50, fill=w)
        d.line([(160, 120), (210, 220)], WOOD, 12); d.line([(300, 120), (250, 220)], WOOD, 12)
        for k in range(5): d.circle(410 + k * 40, 380, 12, fill=a)
        d.bullet(520, 220, 190, 52, YEL)
    elif cid == 'gamblers-mag':
        for k, (x, y, rot) in enumerate(((240, 260, -0.2), (430, 230, 0.25))):
            c, s = math.cos(rot), math.sin(rot); T = lambda u, v: (x + u * c - v * s, y + u * s + v * c)
            d.poly([T(-80, -80), T(80, -80), T(80, 80), T(-80, 80)], fill=w)
            for (u, v) in (((-40, -40), (40, 40), (0, 0)) if k == 0 else ((-40, -40), (40, -40), (-40, 40), (40, 40), (0, 0))): d.circle(*T(u, v), 14, fill=RED if k else DARK)
        d.star(580, 120, 40, 15, 5, a); d.star(120, 380, 30, 11, 5, a)
    elif cid == 'payback':
        d.figure(250, 255, 1.0, w); d.star(250, 210, 38, 14, 6, RED)
        d.arc(390, 250, 110, 200, 340, a, 12); d.poly([(500, 210), (470, 265), (530, 255)], fill=a)
        d.bullet(530, 330, 160, 34, RED, ang=0.2)
    elif cid == 'bounty-mark':
        d.figure(380, 270, 1.0, mix(w, DARK, 0.15)); d.crosshair(380, 230, 70, RED, 8)
        d.line([(200, 380), (200, 100)], WOOD, 10); d.poly([(205, 100), (300, 125), (205, 160)], fill=a)
        for k in range(3): d.star(520 + k * 30, 120, 18, 7, 5, GOLD)
    elif cid == 'overdrive-core':
        d.circle(350, 250, 140, fill=mix(a, DARK, 0.55)); d.circle(350, 250, 105, fill=DARK)
        d.bolt(350, 250, 1.4, YEL)
        for k in range(3): d.circle(160 + k * 0, 150 + k * 100, 22, fill=YEL if k == 0 else mix(w, DARK, 0.6))
    elif cid == 'blood-volley':
        d.drop(200, 230, 1.0, RED)
        for k in range(7): ang = -0.6 + k * 0.2; d.bullet(330 + math.cos(ang) * 210, 250 + math.sin(ang) * 210, 80, 14, mix(RED, a, 0.4), ang=ang)
        for k in range(7): ang = -0.6 + k * 0.2; d.dashed([(270, 250), (270 + math.cos(ang) * 200, 250 + math.sin(ang) * 200)], mix(RED, DARK, 0.4), 4, 10, 8)
    elif cid == 'snare-plate':
        d.ellipse(350, 330, 200, 60, fill=mix(a, DARK, 0.5)); d.ellipse(350, 320, 170, 46, fill=mix(w, DARK, 0.5))
        for k in range(9): x = 200 + k * 37; d.poly([(x - 14, 320), (x, 250 + (k % 2) * 20), (x + 14, 320)], fill=w)
        d.figure(350, 170, 0.6, mix(w, DARK, 0.2))
    elif cid == 'ascension-core':
        for k in range(3): d.rect(170 + k * 70, 360 - k * 90, 530 - k * 70, 390 - k * 90, fill=mix(a, DARK, 0.6 - 0.2 * k), r=6)
        d.figure(350, 120, 0.6, w); d.star(350, 70, 40, 15, 5, GOLD)
    elif cid == 'chain-encore':
        for k in range(4): d.ellipse(170 + k * 110, 250, 70, 40, outline=mix(a, w, k / 4), width=14)
        d.bullet(620, 250, 70, 16, a)
    elif cid == 'gravity-well':
        for k in range(5): d.circle(350, 250, 40 + k * 32, outline=mix(a, DARK, k / 6), width=7)
        d.circle(350, 250, 28, fill=DARK); d.circle(350, 250, 12, fill=a)
        for x, y in ((130, 150), (570, 340), (560, 140)): d.figure(x, y, 0.45, w); d.line([(x + (350 - x) * 0.2, y + (250 - y) * 0.2), (x + (350 - x) * 0.45, y + (250 - y) * 0.45)], a, 6)
    elif cid == 'shield-scorched-floor':
        d.ellipse(350, 360, 230, 50, fill=mix(ORANGE, DARK, 0.4))
        for x in (170, 250, 330, 410, 490): flame(d, x, 350, 0.55 + 0.25 * ((x // 80) % 2))
        d.figure(350, 230, 0.9, w); d.circle(350, 230, 120, outline=a, width=8)
    elif cid == 'shield-purge-pulse':
        for k in range(3): d.circle(350, 250, 80 + k * 55, outline=mix(w, a, k / 3), width=10 - k * 2)
        d.figure(350, 255, 0.7, w)
        for x, y, r in ((120, 130, -0.5), (590, 140, 0.4), (130, 390, 0.3), (580, 380, -0.3)): d.rect(x - 30, y - 18, x + 30, y + 18, fill=mix(WOOD, DARK, 0.3), r=4); d.star(x, y, 30, 10, 6, ORANGE, rot=r)
    elif cid == 'shield-swap-shot':
        d.figure(180, 255, 0.9, w); d.figure(520, 255, 0.9, mix(RED, w, 0.2))
        d.arc(350, 220, 170, 200, 340, a, 10); d.poly([(510, 140), (500, 195), (540, 175)], fill=a)
        d.arc(350, 290, 170, 20, 160, a, 10); d.poly([(190, 365), (200, 310), (160, 330)], fill=a)
        d.circle(350, 250, 34, fill=a); d.circle(350, 250, 18, fill=w)
    elif cid == 'mod-squad-caller':
        for k, x in enumerate((210, 350, 490)):
            d.figure(x, 280, 0.7, mix(w, a, 0.3 * k)); d.rect(x - 32, 200, x + 32, 214, fill='#4a5a2a', r=6); d.ellipse(x, 198, 34, 16, fill='#4a5a2a')
            d.rect(x + 20, 270, x + 80, 282, fill=mix(w, DARK, 0.5), r=4)
        d.star(350, 110, 36, 14, 5, YEL)
    # combos
    elif cid == 'gilded-phoenix':
        feather(d, 250, 320, 200, -2.2, ORANGE, RED); feather(d, 450, 320, 200, -0.95, ORANGE, RED)
        d.ellipse(350, 270, 90, 110, fill=GOLD); d.ellipse(350, 270, 70, 88, fill=mix(GOLD, '#ffffff', 0.4)); d.figure(350, 280, 0.55, DARK)
    elif cid == 'jackhammer':
        d.rect(300, 90, 400, 250, fill=GREY, r=10); d.rect(330, 250, 370, 380, fill=mix(w, DARK, 0.3), r=6); d.poly([(330, 380), (370, 380), (350, 420)], fill=w)
        d.line([(260, 120), (440, 120)], DARK, 12)
        for k in range(4): d.rect(450 + k * 40, 330 - k * 40, 480 + k * 40, 390, fill=mix(a, ORANGE, k / 3), r=4)
        for s in (-1, 1): d.arc(350, 410, 60, 200 if s < 0 else 290, 250 if s < 0 else 340, a, 6)
    elif cid == 'riposte':
        d.shield(250, 250, 0.9, w, inner=mix(a, DARK, 0.3))
        d.line([(330, 340), (600, 120)], '#dfe6f2', 12); d.rect(300, 330, 350, 350, fill=WOOD, r=4)
        d.star(470, 230, 40, 12, 4, '#ffffff')
    elif cid == 'crescendo':
        for k in range(5): d.circle(170 + k * 90, 360 - k * 50, 26 + k * 6, fill=mix(a, YEL, k / 4)); d.line([(196 + k * 90 + k * 6, 360 - k * 50), (196 + k * 90 + k * 6, 260 - k * 50)], w, 6)
    elif cid == 'trappers-kit':
        d.ellipse(230, 330, 130, 40, fill=mix(w, DARK, 0.5))
        for k in range(7): x = 130 + k * 33; d.poly([(x - 12, 330), (x, 280 + (k % 2) * 16), (x + 12, 330)], fill=w)
        for k in range(2): d.mine(440 + k * 120, 320, 0.7, DARK, RED)
    elif cid == 'implosion-rounds':
        for k in range(4): d.circle(350, 250, 60 + k * 40, outline=mix(a, DARK, k / 5), width=7)
        d.star(350, 250, 90, 40, 10, ORANGE); d.star(350, 250, 55, 24, 8, YEL)
        for x, y in ((120, 120), (590, 380)): d.dashed([(x, y), (x + (350 - x) * 0.5, y + (250 - y) * 0.5)], w, 6, 12, 8)
    elif cid == 'patient-hunter':
        d.circle(220, 230, 90, fill=WOOD); d.circle(185, 215, 26, fill=YEL); d.circle(255, 215, 26, fill=YEL); d.circle(185, 215, 10, fill=DARK); d.circle(255, 215, 10, fill=DARK)
        d.poly([(210, 245), (230, 245), (220, 270)], fill=ORANGE)
        d.rect(320, 240, 560, 262, fill='#bfe8ff', r=8); d.bullet(620, 251, 100, 20, a)
    elif cid == 'featherweight':
        d.circle(330, 190, 110, fill=RED); d.line([(330, 300), (330, 400)], w, 4)
        d.figure(330, 200, 0.6, w); feather(d, 520, 350, 200, -1.2, a, mix(a, DARK, 0.5))
    else: return False
    return True


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]; force = '--force' in sys.argv
    done = []
    for cid in sorted(os.listdir(os.path.join(ROOT, 'cards'))):
        f = os.path.join(ROOT, 'cards', cid, 'card.json')
        if cid.startswith('_') or not os.path.exists(f) or (args and cid not in args): continue
        out = os.path.join(ROOT, 'cards', cid, 'art.png')
        if os.path.exists(out) and not force and not args: continue
        c = json.load(open(f, encoding='utf-8'))
        d = D(cid, c.get('rarity', 'common'))
        if tcg_art(cid, d) or rework(cid, d) or art(cid, d): d.save(out); done.append(cid)
    print('drew', len(done), 'cards:', ' '.join(done))

if __name__ == '__main__': main()
