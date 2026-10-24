#!/usr/bin/env python3
"""hero_split.py — split the approved hero drawing into the held staff (art/gen/hero_staff.png) and the figure without it
(art/gen/hero.png, the rigcut source); the full drawing stays as art/gen/hero_full.png (portrait source).
Polygons are in 'rig1' px: the drawing cropped to its alpha box and scaled to 280 px high (as rigcut.py does)."""
import os
import subprocess
from types import MappingProxyType

import numpy as np
from PIL import Image

from assetkit import PYTHON, RGBA, SKILL_SCRIPTS, load_rigs, run_stdout, save_rigs
from herostaff import bridge_shaft, split
from rigframe import Frame, alpha_frame, points_arg, reframe

RIG = 'hero'
SOURCE = 'art/gen/hero_full.png'
FIGURE = 'art/gen/hero.png'
STAFF_OUT = 'art/gen/hero_staff.png'
RIG_HEIGHT = 280
RIGCUT_TAIL = 400
LEFT = 'L'
RIGHT = 'R'
# in rig1 px
ARM = MappingProxyType({
    LEFT: (
        (2, 128),
        (18, 100),
        (46, 98),
        (50, 112),
        (45, 135),
        (41, 165),
        (37, 188),
        (3, 190),
        (0, 160),
    ),
    RIGHT: (
        (103, 104),
        (124, 99),
        (134, 111),
        (161, 117),
        (161, 147),
        (130, 149),
        (111, 147),
        (103, 130),
    ),
})
SHOULDER = MappingProxyType({LEFT: (32, 108), RIGHT: (114, 110)})
HAND = MappingProxyType({LEFT: (16, 178), RIGHT: (146, 132)})
STAFF_TIP = (162, 28)
STAFF_BUTT = (132, 244)


def arm_args(side: str, rig1: Frame, rig2: Frame) -> list:
    """rigcut.py options for one arm: its outline, shoulder pivot and hand, in rig2 px."""
    outline = points_arg(reframe(point, rig1, rig2) for point in ARM[side])
    shoulder = points_arg([reframe(SHOULDER[side], rig1, rig2)])
    hand = points_arg([reframe(HAND[side], rig1, rig2)])
    return ['--arm', f'{side}={outline}', '--sh', f'{side}={shoulder}', '--hand', f'{side}={hand}']


def staff_meta(rig1: Frame, rig2: Frame, size: tuple) -> dict:
    """RIGS.hero.staff: its texture (source canvas) placed by the rig2 transform; grip = the right hand centre."""
    return {
        'tex': 'hero_staff',
        'ox': -rig2.box[0] * rig2.scale,
        'oy': -rig2.box[1] * rig2.scale,
        'k': rig2.scale,
        'w': size[0] * rig2.scale,
        'h': size[1] * rig2.scale,
        'grip': list(reframe(HAND[RIGHT], rig1, rig2)),
        'tip': list(reframe(STAFF_TIP, rig1, rig2)),
        'butt': list(reframe(STAFF_BUTT, rig1, rig2)),
    }


def cut(pixels: np.ndarray) -> tuple:
    """Write the staff and the figure; the full drawing's frame (rig1) and the figure's own (rig2, what rigcut uses)."""
    rig1 = alpha_frame(pixels, RIG_HEIGHT)
    staff, figure = split(pixels, rig1)
    bridge_shaft(staff)
    Image.fromarray(staff).save(STAFF_OUT)
    Image.fromarray(figure).save(FIGURE)
    return rig1, alpha_frame(figure, RIG_HEIGHT)


def main() -> None:
    """Split the hero, cut its rig with the arms, record the staff."""
    if not os.path.exists(SOURCE):
        os.replace(FIGURE, SOURCE)
    pixels = np.array(Image.open(SOURCE).convert(RGBA))
    rig1, rig2 = cut(pixels)
    rigcut = [PYTHON, f'{SKILL_SCRIPTS}/rigcut.py', RIG, '--height', str(RIG_HEIGHT)]
    rigcut += arm_args(LEFT, rig1, rig2) + arm_args(RIGHT, rig1, rig2)
    print(run_stdout(*rigcut)[-RIGCUT_TAIL:])
    rigs = load_rigs()
    rigs[RIG]['staff'] = staff_meta(rig1, rig2, (pixels.shape[1], pixels.shape[0]))
    save_rigs(rigs)
    print('staff', rigs[RIG]['staff'])
    subprocess.run([PYTHON, 'tools/rigclean.py', RIG])


if __name__ == '__main__':
    main()
