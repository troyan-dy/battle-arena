"""grade.py — the LAB grade that finish.py applies toward the reference."""
from typing import Callable, NamedTuple, Optional

import numpy as np

from assetkit import ALPHA
from lab import lab_to_srgb, srgb_to_lab

HALF_TURN = 180
FULL_TURN = 360


class GradeRule(NamedTuple):
    """Where to grade (a selector of lightness, chroma, hue) and how."""

    select: Callable
    lightness_gain: float
    lightness_gamma: float
    hue_target: Optional[float]
    hue_pull: float
    chroma_gain: float


def _target_hue(hue: np.ndarray, rule: GradeRule) -> np.ndarray:
    if rule.hue_target is None:
        return hue
    return hue + rule.hue_pull * (((rule.hue_target - hue + HALF_TURN) % FULL_TURN) - HALF_TURN)


def _rule_lab(lch: tuple, rule: GradeRule) -> tuple:
    lightness = (np.clip(lch[0], 0, 100) / 100) ** rule.lightness_gamma
    hue = np.radians(_target_hue(lch[2], rule))
    chroma = lch[1] * rule.chroma_gain
    return (100 * lightness * rule.lightness_gain, chroma * np.cos(hue), chroma * np.sin(hue))


def _apply_rule(graded: np.ndarray, lch: tuple, rule: GradeRule) -> None:
    mask = rule.select(*lch)
    for channel, target in enumerate(_rule_lab(lch, rule)):
        graded[..., channel] = np.where(mask, target, graded[..., channel])


def _lch(lab: np.ndarray) -> tuple:
    lightness, green_red, blue_yellow = np.moveaxis(lab, -1, 0)
    hue = np.degrees(np.arctan2(blue_yellow, green_red)) % FULL_TURN
    return (lightness, np.hypot(green_red, blue_yellow), hue)


def grade(pixels: np.ndarray, rules) -> np.ndarray:
    """RGBA pixels graded in LAB; each rule (GradeRule fields) selects on the ungraded colour, later rules win."""
    lab = srgb_to_lab(pixels[..., :ALPHA].astype(np.float64))
    lch = _lch(lab)
    graded = lab.copy()
    for rule in rules:
        _apply_rule(graded, lch, GradeRule(*rule))
    out = pixels.copy()
    out[..., :ALPHA] = np.round(lab_to_srgb(graded)).astype(np.uint8)
    return out
