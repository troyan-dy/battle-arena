#!/usr/bin/env python3
"""rigclean.py NAME... — drop stray alpha islands from rig parts in art/gen (a coat sliver cut into an arm, specks on the body):
limbs keep components ≥ 25 % of their largest, the body drops islands under 40 px."""
import glob
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

from assetkit import ALPHA, RGBA

ALPHA_SOLID = 20
BODY_MIN_ISLAND = 40
LIMB_KEEP_SHARE = 0.25


def kept_islands(sizes: np.ndarray, is_body: bool) -> list:
    """Labels (1-based) of the islands a part keeps."""
    threshold = BODY_MIN_ISLAND if is_body else LIMB_KEEP_SHARE * sizes.max()
    return [index + 1 for index, size in enumerate(sizes) if size >= threshold]


def stray_pixels(solid: np.ndarray, is_body: bool) -> tuple:
    """The pixels of the islands to drop, and how many islands those are."""
    labels, count = ndimage.label(solid)
    if count <= 1:
        return np.zeros_like(solid), 0
    sizes = ndimage.sum(np.ones_like(labels), labels, range(1, count + 1))
    keep = kept_islands(sizes, is_body)
    return ~np.isin(labels, keep) & solid, count - len(keep)


def clean_part(path: str) -> None:
    """Drop the stray islands of one rig part in place."""
    pixels = np.array(Image.open(path).convert(RGBA))
    drop, islands = stray_pixels(pixels[..., ALPHA] > ALPHA_SOLID, is_body=path.endswith('__body.png'))
    if drop.any():
        pixels[drop] = 0
        Image.fromarray(pixels).save(path)
        print(path, 'dropped', int(drop.sum()), 'px in', islands, 'islands')


def main() -> None:
    """Clean every part of every rig named on the command line."""
    for name in sys.argv[1:]:
        for path in sorted(glob.glob(f'art/gen/{name}__*.png')):
            clean_part(path)


if __name__ == '__main__':
    main()
