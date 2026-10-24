#!/usr/bin/env python3
"""derive_brute.py — fallback brute when the generator can't draw one: the approved ghoul made hulking (1.4× wider, 1.1× taller,
nearest-neighbour so the pixel grid stays), darker and bluer, with orange eyes; then cut into its own rig."""
import numpy as np
from PIL import Image

from assetkit import ALPHA, OPAQUE, PYTHON, RGBA, SKILL_SCRIPTS, run_stdout

GROW_WIDTH = 1.4
GROW_HEIGHT = 1.1
EYE_RED_MIN = 140
EYE_GREEN_BLUE_MAX = 90
HEAD_SHARE = 0.35            # eyes are only searched in the top of the figure
SKIN_RED_BLUE_SPREAD = 60
SLATE_TINT = (0.78, 0.8, 0.95)   # darker, cooler slate
EYE_ORANGE = (255, 150, 40)
PAD = 20
RIG_HEIGHT = '240'
RIGCUT_TAIL = 120
PREP_TAIL = 40


def hulking_ghoul() -> Image.Image:
    """The approved ghoul trimmed and stretched, nearest-neighbour."""
    ghoul = Image.open('art/gen/ghoul.png').convert(RGBA)
    ghoul = ghoul.crop(ghoul.getbbox())
    size = (round(ghoul.width * GROW_WIDTH), round(ghoul.height * GROW_HEIGHT))
    return ghoul.resize(size, Image.NEAREST)


def eye_mask(rgb: np.ndarray) -> np.ndarray:
    """Saturated red in the head: the eyes."""
    head_rows = int(rgb.shape[0] * HEAD_SHARE)
    in_head = np.arange(rgb.shape[0]).reshape(-1, 1) < head_rows
    reddish = rgb[..., 0] > EYE_RED_MIN
    no_green_blue = np.all(rgb[..., 1:] < EYE_GREEN_BLUE_MAX, axis=-1)
    return reddish & no_green_blue & in_head


def skin_mask(pixels: np.ndarray, eyes: np.ndarray) -> np.ndarray:
    """Opaque, not too saturated between red and blue, not the eyes."""
    red_blue_spread = np.abs(pixels[..., 0] - pixels[..., 2])
    return ~eyes & (pixels[..., ALPHA] > 0) & (red_blue_spread < SKIN_RED_BLUE_SPREAD)


def recolour(pixels: np.ndarray) -> None:
    """Skin to slate and eyes to orange, in place (float RGBA)."""
    rgb = pixels[..., :ALPHA]
    eyes = eye_mask(rgb)
    skin = skin_mask(pixels, eyes)
    rgb[skin] = rgb[skin] * np.array(SLATE_TINT)
    rgb[eyes] = np.array(EYE_ORANGE)
    pixels[..., :ALPHA] = np.clip(rgb, 0, OPAQUE)


def padded(brute: Image.Image) -> Image.Image:
    """The brute on a canvas with PAD px of transparent margin."""
    canvas = Image.new(RGBA, (brute.width + PAD * 2, brute.height + PAD * 2))
    canvas.paste(brute, (PAD, PAD))
    return canvas


def main() -> None:
    """Derive the brute, then cut and clean its rig and re-run prep."""
    pixels = np.array(hulking_ghoul()).astype(np.float32)
    recolour(pixels)
    padded(Image.fromarray(pixels.astype(np.uint8))).save('art/gen/brute.png')
    rigcut = run_stdout(PYTHON, f'{SKILL_SCRIPTS}/rigcut.py', 'brute', '--height', RIG_HEIGHT)
    print(rigcut[-RIGCUT_TAIL:])
    print(run_stdout(PYTHON, 'tools/rigclean.py', 'brute'))
    print(run_stdout(PYTHON, f'{SKILL_SCRIPTS}/prep.py')[-PREP_TAIL:])


if __name__ == '__main__':
    main()
