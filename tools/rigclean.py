#!/usr/bin/env python3
"""rigclean.py NAME... — drop stray alpha islands from rig parts in art/gen (a coat sliver cut into an arm, specks on the body):
limbs keep components ≥ 25 % of their largest, the body drops islands under 40 px."""
import sys, glob, numpy as np
from PIL import Image
from scipy import ndimage
for name in sys.argv[1:]:
    for f in sorted(glob.glob(f'art/gen/{name}__*.png')):
        im = np.array(Image.open(f).convert('RGBA')); m = im[:, :, 3] > 20; lab, n = ndimage.label(m)
        if n <= 1: continue
        sz = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1)); body = f.endswith('__body.png')
        keep = [i + 1 for i, v in enumerate(sz) if (v >= 40 if body else v >= 0.25 * sz.max())]
        drop = ~np.isin(lab, keep) & m
        if drop.any(): im[drop] = 0; Image.fromarray(im).save(f); print(f, 'dropped', int(drop.sum()), 'px in', n - len(keep), 'islands')
