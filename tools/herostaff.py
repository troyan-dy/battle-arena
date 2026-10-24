"""herostaff.py — cut the held staff out of the hero drawing and bridge the shaft where the hand hid it."""
import numpy as np

from assetkit import ALPHA, polygon_mask
from rigframe import ALPHA_SOLID, Frame, source_point

SHAFT_PERIOD = 6   # the bridge repeats this many rows of the shaft below the hand
# the staff in rig1 px (the full drawing's frame): above and below the hand
STAFF = (
    (
        (124, 0),
        (191, 0),
        (191, 119),
        (133, 119),
        (131, 62),
        (122, 56),
    ),
    (
        (132, 146),
        (191, 146),
        (191, 250),
        (124, 250),
        (124, 222),
        (129, 214),
        (130, 150),
    ),
)


def split(pixels: np.ndarray, rig1: Frame) -> tuple:
    """The staff alone and the figure without it."""
    outlines = [[source_point(point, rig1) for point in polygon] for polygon in STAFF]
    inside = polygon_mask((pixels.shape[1], pixels.shape[0]), outlines)
    on_staff = inside & (pixels[..., ALPHA] > 0)
    staff = pixels.copy()
    staff[~on_staff] = 0
    figure = pixels.copy()
    figure[on_staff] = 0
    return staff, figure


def _shaft_centre(solid: np.ndarray, row: int) -> float:
    return np.where(solid[row])[0].mean()


def _gap_centre(row: int, gap: tuple, ends: tuple) -> float:
    first, last = gap
    start, end = ends
    return start + (end - start) * (row - first + 1) / (last - first + 2)


def _fill_gap(staff: np.ndarray, solid: np.ndarray, first: int, last: int) -> None:
    ends = (_shaft_centre(solid, first - 1), _shaft_centre(solid, last + 1))
    for row in range(first, last + 1):
        source_row = last + 1 + (row - first) % SHAFT_PERIOD
        shift = int(round(_gap_centre(row, (first, last), ends) - _shaft_centre(solid, source_row)))
        staff[row] = np.roll(staff[source_row], shift, axis=0)


def bridge_shaft(staff: np.ndarray) -> None:
    """Fill the rows hidden behind the hand with shifted copies of the shaft just below, in place."""
    solid = staff[..., ALPHA] > ALPHA_SOLID
    rows = np.where(solid.any(axis=1))[0]
    gaps = [row for row in range(rows.min(), rows.max()) if not solid[row].any()]
    if gaps:
        _fill_gap(staff, solid, gaps[0], gaps[-1])
