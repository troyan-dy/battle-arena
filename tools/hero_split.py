#!/usr/bin/env python3
"""hero_split.py — split the approved hero drawing into the held staff (art/gen/hero_staff.png) and the figure without it
(art/gen/hero.png, the rigcut source); the full drawing stays as art/gen/hero_full.png (portrait source).
Polygons are in 'rig1' px: the drawing cropped to its alpha box and scaled to 280 px high (as rigcut.py does)."""
import json, numpy as np, subprocess, os, re
from PIL import Image, ImageDraw
SRC = 'art/gen/hero_full.png'
if not os.path.exists(SRC): os.replace('art/gen/hero.png', SRC)
im = Image.open(SRC).convert('RGBA'); P = np.array(im)
def box(a):
    ys, xs = np.where(a[:, :, 3] > 60); return (max(0, xs.min() - 3), max(0, ys.min() - 3), min(a.shape[1], xs.max() + 4), min(a.shape[0], ys.max() + 4))
b1 = box(P); s1 = 280 / (b1[3] - b1[1])
to_orig = lambda pts: [(x / s1 + b1[0], y / s1 + b1[1]) for x, y in pts]
STAFF = [[(124, 0), (191, 0), (191, 119), (133, 119), (131, 62), (122, 56)],
         [(132, 146), (191, 146), (191, 250), (124, 250), (124, 222), (129, 214), (130, 150)]]
mimg = Image.new('L', im.size, 0); d = ImageDraw.Draw(mimg)
for poly in STAFF: d.polygon(to_orig(poly), fill=255)
sm = (np.array(mimg) > 0) & (P[:, :, 3] > 0)
st = P.copy(); st[~sm] = 0
# bridge the shaft behind the hand: rows with no staff between the two pieces get a shifted copy of the shaft just below
rows = np.where((st[:, :, 3] > 60).any(axis=1))[0]; gaps = [y for y in range(rows.min(), rows.max()) if not (st[y, :, 3] > 60).any()]
if gaps:
    g0, g1 = gaps[0], gaps[-1]; cx = lambda y: np.where(st[y, :, 3] > 60)[0].mean()
    xa, xb = cx(g0 - 1), cx(g1 + 1)
    for y in range(g0, g1 + 1):
        src = g1 + 1 + (y - g0) % 6; dx = int(round(xa + (xb - xa) * (y - g0 + 1) / (g1 - g0 + 2) - cx(src)))
        st[y] = np.roll(st[src], dx, axis=0)
Image.fromarray(st).save('art/gen/hero_staff.png')
fig = P.copy(); fig[sm] = 0; Image.fromarray(fig).save('art/gen/hero.png')
# rig2 = the figure's own crop/scale (what rigcut will use)
b2 = box(fig); s2 = 280 / (b2[3] - b2[1])
r1to2 = lambda pts: [((x / s1 + b1[0] - b2[0]) * s2, (y / s1 + b1[1] - b2[1]) * s2) for x, y in pts]
fmt = lambda pts: ';'.join(f'{x:.1f},{y:.1f}' for x, y in pts)
ARM = {'L': [(2, 128), (18, 100), (46, 98), (50, 112), (45, 135), (41, 165), (37, 188), (3, 190), (0, 160)],
       'R': [(103, 104), (124, 99), (134, 111), (161, 117), (161, 147), (130, 149), (111, 147), (103, 130)]}
SH = {'L': (32, 108), 'R': (114, 110)}; HAND = {'L': (16, 178), 'R': (146, 132)}
args = ['python3', os.path.expanduser('~/.claude/skills/ref2game/scripts/rigcut.py'), 'hero', '--height', '280']
for k in 'LR': args += ['--arm', f'{k}={fmt(r1to2(ARM[k]))}', '--sh', f'{k}={fmt(r1to2([SH[k]]))}', '--hand', f'{k}={fmt(r1to2([HAND[k]]))}']
print(subprocess.run(args, capture_output=True, text=True).stdout[-400:])
# the staff in rig2 px: its texture (orig canvas) maps by the same transform; grip = the hand centre
R = json.loads(re.sub(r'^window\.RIGS = |;\s*$', '', open('live/rigs.js').read().strip()))
R['hero']['staff'] = {'tex': 'hero_staff', 'ox': -b2[0] * s2, 'oy': -b2[1] * s2, 'k': s2, 'w': im.size[0] * s2, 'h': im.size[1] * s2,
                      'grip': list(r1to2([HAND['R']])[0]), 'tip': list(r1to2([(162, 28)])[0]), 'butt': list(r1to2([(132, 244)])[0])}
open('live/rigs.js', 'w').write('window.RIGS = ' + json.dumps(R) + ';\n'); print('staff', R['hero']['staff'])
subprocess.run(['python3', 'tools/rigclean.py', 'hero'])
