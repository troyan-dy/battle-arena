#!/usr/bin/env python3
"""finish.py [NAME...] — rebuild finished assets from the generator's raw output (art/raw) into art/gen, reproducibly:
chroma key → despill leftover magenta → LAB grade toward the reference (asset critic r1 measurements) → mirror where the baked
light faces the wrong way → cut rigs (hero_split / rigcut / batcut + rigclean). Never re-grades its own output."""
import sys, os, subprocess, numpy as np
from PIL import Image
from scipy import ndimage
SK = os.path.expanduser('~/.claude/skills/ref2game/scripts')
def run(*a): r = subprocess.run(list(a), capture_output=True, text=True); return r.stdout + r.stderr

def srgb2lab(c):
    c = c / 255.0; c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]); xyz = c @ M.T
    xyz = xyz / np.array([0.95047, 1.0, 1.08883]); f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)
def lab2srgb(lab):
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]; fy = (L + 16) / 116; fx = fy + a / 500; fz = fy - b / 200
    f = lambda t: np.where(t ** 3 > 0.008856, t ** 3, (t - 16 / 116) / 7.787)
    xyz = np.stack([f(fx) * 0.95047, f(fy), f(fz) * 1.08883], -1)
    M = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]]); c = np.clip(xyz @ M.T, 0, 1)
    return np.where(c > 0.0031308, 1.055 * c ** (1 / 2.4) - 0.055, 12.92 * c) * 255
def grade(im, rules):
    lab = srgb2lab(im[..., :3].astype(np.float64)); L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(a, b); h = np.degrees(np.arctan2(b, a)) % 360; out = lab.copy()
    for sel, kL, gam, hue_to, hue_w, kC in rules:
        m = sel(L, C, h); Ln = 100 * (np.clip(L, 0, 100) / 100) ** gam * kL
        hn = h if hue_to is None else h + hue_w * (((hue_to - h + 180) % 360) - 180); Cn = C * kC
        out[..., 0] = np.where(m, Ln, out[..., 0]); out[..., 1] = np.where(m, Cn * np.cos(np.radians(hn)), out[..., 1]); out[..., 2] = np.where(m, Cn * np.sin(np.radians(hn)), out[..., 2])
    r = im.copy(); r[..., :3] = np.round(lab2srgb(out)).astype(np.uint8); return r
def despill(im):
    """leftover magenta key pixels near the alpha edge: faint ones → transparent, solid ones → median of non-magenta neighbours"""
    rgb = im[..., :3].astype(int); a = im[..., 3]; R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    edge = ndimage.binary_dilation(a < 128, iterations=3) & (a > 0)
    mag = (R - G > 35) & (B - G > 35) & (np.abs(R - B) < 70) & edge
    out = im.copy(); out[mag & (a < 200), 3] = 0; ys, xs = np.where(mag & (a >= 200))
    for y, x in zip(ys, xs):
        y0, y1, x0, x1 = max(0, y - 2), y + 3, max(0, x - 2), x + 3; nb = im[y0:y1, x0:x1].reshape(-1, 4); nm = mag[y0:y1, x0:x1].reshape(-1)
        ok = nb[(~nm) & (nb[:, 3] > 128)]
        if len(ok): out[y, x, :3] = np.median(ok[:, :3], 0)
        else: out[y, x, 3] = 0
    return out, int(mag.sum())

neutral = lambda L, C, h: C < 25
moss = lambda L, C, h: (h > 90) & (h < 170) & (C >= 15)
skin = lambda L, C, h: (C < 28) & ~((h < 50) & (C > 20))
warm = lambda L, C, h: (h > 40) & (h < 110) & (C >= 15)
STONE = [(neutral, 0.70, 1.35, 245, 0.7, 1.3), (moss, 0.70, 1.2, None, 0, 0.6)]
# name: (key, despill, grade rules, mirror, out name, then)
SPEC = {
    'hero': ('ff00ff', True, [(warm, 1.0, 1.0, 88, 0.5, 0.7)], False, 'hero_full', ['python3', 'tools/hero_split.py']),
    'ghoul': ('ff00ff', True, [(skin, 0.80, 1.25, 265, 0.8, 1.0)], False, 'ghoul', ['RIG', 'ghoul', '200']),
    'skeleton': ('ff00ff', True, [], False, 'skeleton', ['RIG', 'skeleton', '220']),
    'brute': ('ff00ff', True, [(skin, 0.62, 1.3, 260, 0.6, 1.2)], False, 'brute', ['RIG', 'brute', '260']),
    'bat': ('00ff00', False, [(lambda L, C, h: (h > 260) & (h < 340) & (C > 15), 0.75, 1.15, 330, 0.5, 0.6), (lambda L, C, h: C < 20, 0.85, 1.2, 300, 0.6, 1.2)], False, 'bat', ['python3', 'tools/batcut.py']),
    'prop_grave': ('ff00ff', True, STONE, False, 'prop_grave', None), 'prop_wall': ('ff00ff', True, STONE, False, 'prop_wall', None),
    'prop_pillar': ('ff00ff', True, STONE, False, 'prop_pillar', None), 'prop_rocks': ('ff00ff', True, STONE, False, 'prop_rocks', None),
    'prop_torch': ('ff00ff', True, [], False, 'prop_torch', None), 'prop_bush': ('ff00ff', True, [], False, 'prop_bush', None),
    'pick_coin': ('ff00ff', True, [(lambda L, C, h: C > 0, 0.92, 1.05, 75, 0.4, 0.75)], True, 'pick_coin', None),
    'pick_xp': ('ff00ff', True, [(lambda L, C, h: C > 0, 0.90, 1.1, None, 0, 0.75)], False, 'pick_xp', None),
    'pick_xp5': ('00ff00', False, [(lambda L, C, h: C > 0, 0.82, 1.15, None, 0, 0.65)], False, 'pick_xp5', None),
    'pick_heart': ('ff00ff', False, [], False, 'pick_heart', None),
    'prop_pillar_v2': ('ff00ff', True, STONE, False, 'prop_pillar', None), 'prop_torch_v2': ('ff00ff', True, [], False, 'prop_torch', None),
    'ground_tex': (None, False, [], False, 'ground_tex', None), 'fx_firesword': ('00ffff', False, [], False, 'fx_firesword', None),
    'icon_ice': (None, False, [], False, 'icon_ice', None), 'icon_bolt': (None, False, [], False, 'icon_bolt', None),
    'icon_hole': (None, False, [], False, 'icon_hole', None), 'icon_fire': (None, False, [], False, 'icon_fire', None),
    'icon_heart': ('ff00ff', True, [], False, 'icon_heart', None), 'icon_boot': ('ff00ff', True, [], False, 'icon_boot', None),
    'icon_gold': ('ff00ff', True, [], False, 'icon_gold', None), 'ui_skull': ('ff00ff', True, [], False, 'ui_skull', None),
}
# a v2 raw replaces its v1 (the same output name): finish v1 only when no v2 exists
SKIP_IF = {'prop_pillar': 'prop_pillar_v2', 'prop_torch': 'prop_torch_v2'}
names = sys.argv[1:] or [n for n in SPEC if os.path.exists(f'art/raw/{n}.png') and not os.path.exists(f'art/raw/{SKIP_IF.get(n, "-")}.png')]
for n in names:
    key, dsp, rules, mirror, out, then = SPEC[n]; src = f'art/raw/{n}.png'
    if not os.path.exists(src): print(n, 'no raw'); continue
    tmp = f'art/gen/{out}.png'
    if key: run('python3', f'{SK}/gen.py', 'key', src, tmp, '--key', key)
    else: Image.open(src).convert('RGBA').save(tmp)                                   # opaque full-frame (textures, square icons)
    im = np.array(Image.open(tmp).convert('RGBA')); nd = 0
    if dsp: im, nd = despill(im)
    if rules: im = grade(im, rules)
    if mirror: im = im[:, ::-1].copy()
    Image.fromarray(im).save(tmp); print(n, '->', tmp, 'despilled', nd)
    if then:
        if then[0] == 'RIG': print(run('python3', f'{SK}/rigcut.py', then[1], '--height', then[2])[-160:]); print(run('python3', 'tools/rigclean.py', then[1]))
        else: print(run(*then)[-200:])
print(run('python3', f'{SK}/prep.py')[-60:])
