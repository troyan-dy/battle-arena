#!/usr/bin/env python3
"""batcut.py — cut the approved bat (art/gen/bat.png, wings spread) into bat__body, bat__wingL, bat__wingR on one canvas
(trimmed whole, scaled to 220 px high) + shoulder pivots and wing tips → live/rigs.js (RIGS.bat). Polygons in source px."""
import subprocess

import numpy as np
from PIL import Image

from assetkit import ALPHA, PYTHON, RGBA, load_rigs, polygon_mask, save_rigs

SOURCE = 'art/gen/bat.png'
RIG_HEIGHT = 220
ALPHA_SOLID = 60
BOX_PAD_BEFORE = 3
BOX_PAD_AFTER = 4
# the left wing; the right one is its mirror
WING_LEFT = (
    (0, 200),
    (548, 200),
    (548, 440),
    (598, 498),
    (628, 535),
    (630, 610),
    (626, 770),
    (0, 770),
)
BODY_CENTRE = (767, 560)
SHOULDER_LEFT = (622, 560)
TIP_LEFT = (40, 420)
PARTS = ('body', 'wingL', 'wingR')


def mirrored(point: tuple, width: int) -> tuple:
    """The point reflected across the vertical centre line of the source."""
    return (width - 1 - point[0], point[1])


def part_masks(pixels: np.ndarray) -> dict:
    """Each part's pixels: the wings by polygon, the body is the rest."""
    opaque = pixels[..., ALPHA] > 0
    canvas_size = (pixels.shape[1], pixels.shape[0])
    right_polygon = [mirrored(point, pixels.shape[1]) for point in WING_LEFT]
    wing_left = polygon_mask(canvas_size, [WING_LEFT]) & opaque
    wing_right = polygon_mask(canvas_size, [right_polygon]) & opaque
    return dict(zip(PARTS, (opaque & ~wing_left & ~wing_right, wing_left, wing_right)))


def crop_box(alpha: np.ndarray) -> tuple:
    """The solid pixels' bounding box, padded."""
    rows, cols = np.where(alpha > ALPHA_SOLID)
    return (
        cols.min() - BOX_PAD_BEFORE,
        rows.min() - BOX_PAD_BEFORE,
        cols.max() + BOX_PAD_AFTER,
        rows.max() + BOX_PAD_AFTER,
    )


def to_rig(point: tuple, box: tuple, scale: float) -> list:
    """A source-px point in rig px (the trimmed, scaled canvas)."""
    shift_x = point[0] - box[0]
    shift_y = point[1] - box[1]
    return [shift_x * scale, shift_y * scale]


def save_parts(pixels: np.ndarray, box: tuple, canvas: tuple) -> None:
    """Write each part, trimmed and scaled to the rig canvas, to art/gen."""
    for part, mask in part_masks(pixels).items():
        part_pixels = pixels.copy()
        part_pixels[~mask] = 0
        part_image = Image.fromarray(part_pixels).crop(box)
        part_image.resize(canvas, Image.LANCZOS).save(f'art/gen/bat__{part}.png')


def rig_meta(box: tuple, scale: float, width: int, canvas: tuple) -> dict:
    """RIGS.bat: canvas size, centre, shoulder pivots and wing tips in rig px."""
    centre = to_rig(BODY_CENTRE, box, scale)
    return {
        'w': canvas[0],
        'h': canvas[1],
        'bh': canvas[1],
        'cx': centre[0],
        'cy': centre[1],
        'shL': to_rig(SHOULDER_LEFT, box, scale),
        'shR': to_rig(mirrored(SHOULDER_LEFT, width), box, scale),
        'tipL': to_rig(TIP_LEFT, box, scale),
        'tipR': to_rig(mirrored(TIP_LEFT, width), box, scale),
        'head': to_rig(BODY_CENTRE, box, scale),
        'parts': list(PARTS),
    }


def main() -> None:
    """Cut the bat, record its rig, clean the parts."""
    pixels = np.array(Image.open(SOURCE).convert(RGBA))
    box = crop_box(pixels[..., ALPHA])
    scale = RIG_HEIGHT / (box[3] - box[1])
    canvas = (round((box[2] - box[0]) * scale), RIG_HEIGHT)
    save_parts(pixels, box, canvas)
    rigs = load_rigs()
    rigs['bat'] = rig_meta(box, scale, pixels.shape[1], canvas)
    save_rigs(rigs)
    print(rigs['bat'])
    subprocess.run([PYTHON, 'tools/rigclean.py', 'bat'])


if __name__ == '__main__':
    main()
