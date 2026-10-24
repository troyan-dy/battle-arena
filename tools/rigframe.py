"""rigframe.py — rigcut.py's frame of a drawing (its padded alpha box scaled to the rig height), points moved between frames."""
from typing import NamedTuple

import numpy as np

from assetkit import ALPHA

ALPHA_SOLID = 60
BOX_PAD_BEFORE = 3
BOX_PAD_AFTER = 4


class Frame(NamedTuple):
    """A crop box of the source and the scale that makes it the rig height."""

    box: tuple
    scale: float


def alpha_frame(pixels: np.ndarray, rig_height: int) -> Frame:
    """The padded, clamped box of the solid pixels, as rigcut.py crops it."""
    rows, cols = np.where(pixels[..., ALPHA] > ALPHA_SOLID)
    height, width = pixels.shape[:2]
    box = (
        max(0, cols.min() - BOX_PAD_BEFORE),
        max(0, rows.min() - BOX_PAD_BEFORE),
        min(width, cols.max() + BOX_PAD_AFTER),
        min(height, rows.max() + BOX_PAD_AFTER),
    )
    return Frame(box, rig_height / (box[3] - box[1]))


def source_point(point: tuple, frame: Frame) -> tuple:
    """A point in the frame's px, in source px."""
    source_x = point[0] / frame.scale + frame.box[0]
    source_y = point[1] / frame.scale + frame.box[1]
    return (source_x, source_y)


def reframe(point: tuple, origin: Frame, target: Frame) -> tuple:
    """A point in origin-frame px, in target-frame px."""
    source_x, source_y = source_point(point, origin)
    return ((source_x - target.box[0]) * target.scale, (source_y - target.box[1]) * target.scale)


def points_arg(points) -> str:
    """Points as rigcut.py takes them: 'x,y;x,y'."""
    return ';'.join(f'{point_x:.1f},{point_y:.1f}' for point_x, point_y in points)
