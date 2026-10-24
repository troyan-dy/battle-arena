"""assetkit.py — what the asset tools share: the ref2game scripts, subprocess helpers, live/rigs.js I/O."""
import json
import os
import re
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

PYTHON = 'python3'
RGBA = 'RGBA'
ALPHA = 3   # channel index of alpha in an RGBA pixel array
OPAQUE = 255
SKILL_SCRIPTS = os.path.expanduser('~/.claude/skills/ref2game/scripts')
RIGS_PATH = Path('live/rigs.js')
_RIGS_WRAPPER = re.compile(r'^window\.RIGS = |;\s*$')


def run_stdout(*args: str) -> str:
    """Run a command and return what it printed to stdout."""
    return subprocess.run(list(args), capture_output=True, text=True).stdout


def run_output(*args: str) -> str:
    """Run a command and return its stdout followed by its stderr."""
    completed = subprocess.run(list(args), capture_output=True, text=True)
    return completed.stdout + completed.stderr


def polygon_mask(size: tuple, polygons) -> np.ndarray:
    """Boolean mask of the filled polygons on a canvas of the given (width, height)."""
    canvas = Image.new('L', size, 0)
    draw = ImageDraw.Draw(canvas)
    for polygon in polygons:
        draw.polygon(polygon, fill=OPAQUE)
    return np.array(canvas) > 0


def load_rigs() -> dict:
    """All rigs from live/rigs.js."""
    return json.loads(_RIGS_WRAPPER.sub('', RIGS_PATH.read_text().strip()))


def save_rigs(rigs: dict) -> None:
    """Write all rigs back to live/rigs.js."""
    RIGS_PATH.write_text('window.RIGS = {0};\n'.format(json.dumps(rigs)))
