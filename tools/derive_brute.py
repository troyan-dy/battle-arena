#!/usr/bin/env python3
"""derive_brute.py — fallback brute when the generator can't draw one: the approved ghoul made hulking (1.4× wider, 1.1× taller,
nearest-neighbour so the pixel grid stays), darker and bluer, with orange eyes; then cut into its own rig."""
import os, subprocess, numpy as np
from PIL import Image
SK = os.path.expanduser('~/.claude/skills/ref2game/scripts')
im = Image.open('art/gen/ghoul.png').convert('RGBA'); bb = im.getbbox(); im = im.crop(bb)
im = im.resize((round(im.width * 1.4), round(im.height * 1.1)), Image.NEAREST)
a = np.array(im).astype(np.float32); rgb = a[..., :3]
red = (rgb[..., 0] > 140) & (rgb[..., 1] < 90) & (rgb[..., 2] < 90); red[int(a.shape[0] * 0.35):] = False   # the eyes (head only) → orange
skin = ~red & (a[..., 3] > 0) & (np.abs(rgb[..., 0] - rgb[..., 2]) < 60)
rgb[skin] = rgb[skin] * np.array([0.78, 0.8, 0.95])                                     # darker, cooler slate
rgb[red] = np.array([255, 150, 40])
a[..., :3] = np.clip(rgb, 0, 255); out = Image.fromarray(a.astype(np.uint8))
pad = Image.new('RGBA', (out.width + 40, out.height + 40)); pad.paste(out, (20, 20)); pad.save('art/gen/brute.png')
print(subprocess.run(['python3', f'{SK}/rigcut.py', 'brute', '--height', '240'], capture_output=True, text=True).stdout[-120:])
print(subprocess.run(['python3', 'tools/rigclean.py', 'brute'], capture_output=True, text=True).stdout)
print(subprocess.run(['python3', f'{SK}/prep.py'], capture_output=True, text=True).stdout[-40:])
