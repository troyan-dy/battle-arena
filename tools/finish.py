#!/usr/bin/env python3
"""finish.py [NAME...] — rebuild finished assets from the generator's raw output (art/raw) into art/gen, reproducibly:
chroma key → despill leftover magenta → LAB grade toward the reference (asset critic r1 measurements) → mirror where the baked
light faces the wrong way → cut rigs (hero_split / rigcut / batcut + rigclean). Never re-grades its own output."""
import os
import sys
from types import MappingProxyType
from typing import NamedTuple, Optional

import numpy as np
from PIL import Image

import pickers as select
from assetkit import PYTHON, RGBA, SKILL_SCRIPTS, run_output
from despill import despill
from grade import grade

MAGENTA = 'ff00ff'
GREEN = '00ff00'
CYAN = '00ffff'
RIGCUT_TAIL = 160
SCRIPT_TAIL = 200
PREP_TAIL = 60
# grade rules: (selector, lightness gain, lightness gamma, target hue or None, hue pull, chroma gain)
STONE = ((select.neutral, 0.7, 1.35, 245, 0.7, 1.3), (select.moss, 0.7, 1.2, None, 0, 0.6))
# name: (key colour, despill, grade rules, mirror, out name (None: the same), rig height for rigcut, script to run after)
SPEC = MappingProxyType({
    'hero': (MAGENTA, True, ((select.warm, 1.0, 1.0, 88, 0.5, 0.7),), False, 'hero_full', None, 'tools/hero_split.py'),
    'ghoul': (MAGENTA, True, ((select.skin, 0.8, 1.25, 265, 0.8, 1.0),), False, None, '200', None),
    'skeleton': (MAGENTA, True, (), False, None, '220', None),
    'brute': (MAGENTA, True, ((select.skin, 0.62, 1.3, 260, 0.6, 1.2),), False, None, '260', None),
    'bat': (
        GREEN,
        False,
        ((select.wing, 0.75, 1.15, 330, 0.5, 0.6), (select.shadow, 0.85, 1.2, 300, 0.6, 1.2)),
        False,
        None,
        None,
        'tools/batcut.py',
    ),
    'prop_grave': (MAGENTA, True, STONE, False, None, None, None),
    'prop_wall': (MAGENTA, True, STONE, False, None, None, None),
    'prop_pillar': (MAGENTA, True, STONE, False, None, None, None),
    'prop_rocks': (MAGENTA, True, STONE, False, None, None, None),
    'prop_torch': (MAGENTA, True, (), False, None, None, None),
    'prop_bush': (MAGENTA, True, (), False, None, None, None),
    'pick_coin': (MAGENTA, True, ((select.coloured, 0.92, 1.05, 75, 0.4, 0.75),), True, None, None, None),
    'pick_xp': (MAGENTA, True, ((select.coloured, 0.9, 1.1, None, 0, 0.75),), False, None, None, None),
    'pick_xp5': (GREEN, False, ((select.coloured, 0.82, 1.15, None, 0, 0.65),), False, None, None, None),
    'pick_heart': (MAGENTA, False, (), False, None, None, None),
    'prop_pillar_v2': (MAGENTA, True, STONE, False, 'prop_pillar', None, None),
    'prop_torch_v2': (MAGENTA, True, (), False, 'prop_torch', None, None),
    'ground_tex': (None, False, (), False, None, None, None),
    'fx_firesword': (CYAN, False, (), False, None, None, None),
    'icon_ice': (None, False, (), False, None, None, None),
    'icon_bolt': (None, False, (), False, None, None, None),
    'icon_hole': (None, False, (), False, None, None, None),
    'icon_fire': (None, False, (), False, None, None, None),
    'icon_heart': (MAGENTA, True, (), False, None, None, None),
    'icon_boot': (MAGENTA, True, (), False, None, None, None),
    'icon_gold': (MAGENTA, True, (), False, None, None, None),
    'ui_skull': (MAGENTA, True, (), False, None, None, None),
})
# a v2 raw replaces its v1 (the same output name): finish v1 only when no v2 exists
SKIP_IF = MappingProxyType({'prop_pillar': 'prop_pillar_v2', 'prop_torch': 'prop_torch_v2'})


class AssetSpec(NamedTuple):
    """How one raw becomes a finished asset (see SPEC)."""

    key: Optional[str]
    despill: bool
    rules: tuple
    mirror: bool
    out: Optional[str]
    rig_height: Optional[str]
    script: Optional[str]


def process(target: str, spec: AssetSpec) -> int:
    """Despill, grade and mirror the keyed image in place as the spec says; the despilled pixel count."""
    pixels = np.array(Image.open(target).convert(RGBA))
    despilled = 0
    if spec.despill:
        pixels, despilled = despill(pixels)
    if spec.rules:
        pixels = grade(pixels, spec.rules)
    if spec.mirror:
        pixels = np.flip(pixels, axis=1).copy()
    Image.fromarray(pixels).save(target)
    return despilled


def run_after(spec: AssetSpec, out: str) -> None:
    """Cut the rig or run the follow-up script of a finished asset."""
    if spec.rig_height:
        print(run_output(PYTHON, f'{SKILL_SCRIPTS}/rigcut.py', out, '--height', spec.rig_height)[-RIGCUT_TAIL:])
        print(run_output(PYTHON, 'tools/rigclean.py', out))
    elif spec.script:
        print(run_output(PYTHON, spec.script)[-SCRIPT_TAIL:])


def finish(name: str) -> None:
    """Rebuild one asset from art/raw/NAME.png."""
    spec = AssetSpec(*SPEC[name])
    source = f'art/raw/{name}.png'
    if not os.path.exists(source):
        print(name, 'no raw')
        return
    out = spec.out or name
    target = f'art/gen/{out}.png'
    if spec.key:
        run_output(PYTHON, f'{SKILL_SCRIPTS}/gen.py', 'key', source, target, '--key', spec.key)
    else:
        Image.open(source).convert(RGBA).save(target)   # opaque full-frame (textures, square icons)
    print(name, '->', target, 'despilled', process(target, spec))
    run_after(spec, out)


def _has_raw(name: str) -> bool:
    return os.path.exists(f'art/raw/{name}.png')


def default_names() -> list:
    """Every asset with a raw, except a v1 whose v2 exists."""
    return [name for name in SPEC if _has_raw(name) and not _has_raw(SKIP_IF.get(name, '-'))]


def main() -> None:
    """Finish the assets named on the command line (default: all), then re-run prep."""
    for name in sys.argv[1:] or default_names():
        finish(name)
    print(run_output(PYTHON, f'{SKILL_SCRIPTS}/prep.py')[-PREP_TAIL:])


if __name__ == '__main__':
    main()
