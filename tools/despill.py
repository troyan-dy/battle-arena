"""despill.py — leftover magenta key pixels near the alpha edge: faint ones → transparent,
solid ones → median of their non-magenta neighbours."""
import numpy as np
from scipy import ndimage

from assetkit import ALPHA

HALF_ALPHA = 128
SOLID_ALPHA = 200
EDGE_REACH = 3         # px from the transparent area that count as the edge
SPILL_MARGIN = 35      # red and blue over green
SPILL_RED_BLUE_SPREAD = 70
WINDOW_BEFORE = 2      # the neighbourhood is 5×5 around the pixel
WINDOW_AFTER = 3


def _magenta_hue(rgb: np.ndarray) -> np.ndarray:
    red, green, blue = np.moveaxis(rgb.astype(int), -1, 0)
    over_green = (red - green > SPILL_MARGIN) & (blue - green > SPILL_MARGIN)
    return over_green & (np.abs(red - blue) < SPILL_RED_BLUE_SPREAD)


def _magenta_fringe(pixels: np.ndarray) -> np.ndarray:
    alpha = pixels[..., ALPHA]
    edge = ndimage.binary_dilation(alpha < HALF_ALPHA, iterations=EDGE_REACH) & (alpha > 0)
    return _magenta_hue(pixels[..., :ALPHA]) & edge


def _neighbour_colour(pixels: np.ndarray, magenta: np.ndarray, row: int, col: int):
    window = (
        slice(max(0, row - WINDOW_BEFORE), row + WINDOW_AFTER),
        slice(max(0, col - WINDOW_BEFORE), col + WINDOW_AFTER),
    )
    neighbours = pixels[window].reshape(-1, 4)
    clean = neighbours[~magenta[window].reshape(-1) & (neighbours[..., ALPHA] > HALF_ALPHA)]
    if clean.size:
        return np.median(clean[..., :ALPHA], 0)
    return None


def _refill_solid(out: np.ndarray, pixels: np.ndarray, magenta: np.ndarray, solid: np.ndarray) -> None:
    for row, col in zip(*np.where(solid)):
        colour = _neighbour_colour(pixels, magenta, row, col)
        if colour is None:
            out[row, col, ALPHA] = 0
        else:
            out[row, col, :ALPHA] = colour


def despill(pixels: np.ndarray) -> tuple:
    """The despilled RGBA pixels and how many magenta pixels there were."""
    magenta = _magenta_fringe(pixels)
    alpha = pixels[..., ALPHA]
    out = pixels.copy()
    out[magenta & (alpha < SOLID_ALPHA), ALPHA] = 0
    _refill_solid(out, pixels, magenta, magenta & (alpha >= SOLID_ALPHA))
    return out, int(magenta.sum())
