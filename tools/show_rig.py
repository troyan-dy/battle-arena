#!/usr/bin/env python3
"""show_rig.py NAME OUT — the rig's parts reassembled (left) and colour-coded (right), 2x."""
import sys

import numpy as np
from PIL import Image

from assetkit import ALPHA, OPAQUE, RGBA, load_rigs

BACKGROUND = (30, 30, 30, OPAQUE)
PART_ALPHA_SOLID = 100
COLOURS = (
    (255, 80, 80),
    (255, 160, 60),
    (255, 230, 60),
    (80, 140, 255),
    (60, 200, 255),
    (60, 255, 220),
    (200, 80, 255),
    (80, 255, 80),
    (255, 255, 255),
    (255, 120, 200),
)


def part_colour(index: int) -> tuple:
    """The colour of the index-th part (in sorted order) on the colour map."""
    return COLOURS[index % len(COLOURS)]


def load_parts(name: str, parts: list) -> list:
    """The rig's part images, in sorted part order."""
    return [Image.open(f'art/gen/{name}__{part}.png').convert(RGBA) for part in sorted(parts)]


def assembled(images: list, size: tuple) -> Image.Image:
    """The parts composited over a dark background."""
    canvas = Image.new(RGBA, size, BACKGROUND)
    for image in images:
        canvas.alpha_composite(image)
    return canvas


def colour_map(images: list, size: tuple) -> Image.Image:
    """Each part's solid pixels in its own colour on black."""
    width, height = size
    colours = np.full((height, width, 4), (0, 0, 0, OPAQUE), np.uint8)
    for index, image in enumerate(images):
        colours[np.array(image)[..., ALPHA] > PART_ALPHA_SOLID] = (*part_colour(index), OPAQUE)
    return Image.fromarray(colours)


def sheet(name: str, rig: dict) -> Image.Image:
    """Assembled parts (left) and their colour map (right), at 1x."""
    size = (int(rig['w']), int(rig['h']))
    images = load_parts(name, rig['parts'])
    canvas = Image.new(RGBA, (size[0] * 2, size[1]))
    canvas.paste(assembled(images, size), (0, 0))
    canvas.paste(colour_map(images, size), (size[0], 0))
    return canvas


def print_legend(parts: list) -> None:
    """Which colour on the map is which part."""
    for index, part in enumerate(sorted(parts)):
        print(part, part_colour(index))


def main() -> None:
    """Render the rig named on the command line into the given file."""
    name, out = sys.argv[1], sys.argv[2]
    rig = load_rigs()[name]
    print_legend(rig['parts'])
    rendered = sheet(name, rig)
    rendered.resize((rendered.width * 2, rendered.height * 2), Image.NEAREST).save(out)


if __name__ == '__main__':
    main()
