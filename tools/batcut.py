#!/usr/bin/env python3
"""batcut.py — cut the approved bat (art/gen/bat.png, wings spread) into bat__body, bat__wingL, bat__wingR on one canvas
(trimmed whole, scaled to 220 px high) + shoulder pivots and wing tips → live/rigs.js (RIGS.bat). Polygons in source px."""
import json, re, os, numpy as np
from PIL import Image, ImageDraw
im = Image.open('art/gen/bat.png').convert('RGBA'); P = np.array(im); W0, H0 = im.size
WL = [(0, 200), (548, 200), (548, 440), (598, 498), (628, 535), (630, 610), (626, 770), (0, 770)]
WR = [(W0 - 1 - x, y) for x, y in WL]
mask = lambda poly: np.array((lambda m: (ImageDraw.Draw(m).polygon(poly, fill=255), m)[1])(Image.new('L', im.size, 0))) > 0
mL, mR = mask(WL) & (P[:, :, 3] > 0), mask(WR) & (P[:, :, 3] > 0); mB = (P[:, :, 3] > 0) & ~mL & ~mR
ys, xs = np.where(P[:, :, 3] > 60); b = (xs.min() - 3, ys.min() - 3, xs.max() + 4, ys.max() + 4); s = 220 / (b[3] - b[1])
cw, ch = round((b[2] - b[0]) * s), 220
for nm, m in (('body', mB), ('wingL', mL), ('wingR', mR)):
    q = P.copy(); q[~m] = 0; Image.fromarray(q).crop(b).resize((cw, ch), Image.LANCZOS).save(f'art/gen/bat__{nm}.png')
R2 = lambda p: [(p[0] - b[0]) * s, (p[1] - b[1]) * s]
meta = {'w': cw, 'h': ch, 'bh': ch, 'cx': R2((767, 560))[0], 'cy': R2((767, 560))[1], 'shL': R2((622, 560)), 'shR': R2((W0 - 1 - 622, 560)),
        'tipL': R2((40, 420)), 'tipR': R2((W0 - 41, 420)), 'head': R2((767, 560)), 'parts': ['body', 'wingL', 'wingR']}
rp = 'live/rigs.js'; R = json.loads(re.sub(r'^window\.RIGS = |;\s*$', '', open(rp).read().strip())); R['bat'] = meta
open(rp, 'w').write('window.RIGS = ' + json.dumps(R) + ';\n'); print(meta)
import subprocess; subprocess.run(['python3', 'tools/rigclean.py', 'bat'])
