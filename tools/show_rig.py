#!/usr/bin/env python3
"""show_rig.py NAME OUT — the rig's parts reassembled (left) and colour-coded (right), 2x."""
import sys, json, re, glob, numpy as np
from PIL import Image
n, out = sys.argv[1], sys.argv[2]
R = json.loads(re.sub(r'^window\.RIGS = |;\s*$', '', open('live/rigs.js').read().strip()))[n]
W, H = int(R['w']), int(R['h']); cols = [(255,80,80),(255,160,60),(255,230,60),(80,140,255),(60,200,255),(60,255,220),(200,80,255),(80,255,80),(255,255,255),(255,120,200)]
comp = Image.new('RGBA', (W, H), (30, 30, 30, 255)); lab = np.zeros((H, W, 4), np.uint8); lab[:, :, 3] = 255
for i, p in enumerate(sorted(R['parts'])):
    im = Image.open(f'art/gen/{n}__{p}.png').convert('RGBA'); comp.alpha_composite(im); m = np.array(im)[:, :, 3] > 100; lab[m] = list(cols[i % len(cols)]) + [255]
    print(p, cols[i % len(cols)])
o = Image.new('RGBA', (W * 2, H)); o.paste(comp, (0, 0)); o.paste(Image.fromarray(lab), (W, 0)); o.resize((W * 4, H * 2), Image.NEAREST).save(out)
