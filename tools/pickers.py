"""pickers.py — which pixels a grade rule in finish.py touches, by LAB lightness, chroma and hue (degrees)."""
import numpy as np

COLOURED_CHROMA = 15
NEUTRAL_CHROMA_MAX = 25
SKIN_CHROMA_MAX = 28
RED_HUE_MAX = 50
RED_CHROMA_MIN = 20
SHADOW_CHROMA_MAX = 20
MOSS_HUES = (90, 170)
WARM_HUES = (40, 110)
WING_HUES = (260, 340)


def neutral(lightness: np.ndarray, chroma: np.ndarray, hue: np.ndarray) -> np.ndarray:
    """Greys (stone)."""
    return chroma < NEUTRAL_CHROMA_MAX


def moss(lightness: np.ndarray, chroma: np.ndarray, hue: np.ndarray) -> np.ndarray:
    """Coloured greens (moss on stone)."""
    return (hue > MOSS_HUES[0]) & (hue < MOSS_HUES[1]) & (chroma >= COLOURED_CHROMA)


def skin(lightness: np.ndarray, chroma: np.ndarray, hue: np.ndarray) -> np.ndarray:
    """Dull colours except saturated reds (eyes, blood)."""
    red = (hue < RED_HUE_MAX) & (chroma > RED_CHROMA_MIN)
    return (chroma < SKIN_CHROMA_MAX) & ~red


def warm(lightness: np.ndarray, chroma: np.ndarray, hue: np.ndarray) -> np.ndarray:
    """Coloured oranges and yellows."""
    return (hue > WARM_HUES[0]) & (hue < WARM_HUES[1]) & (chroma >= COLOURED_CHROMA)


def wing(lightness: np.ndarray, chroma: np.ndarray, hue: np.ndarray) -> np.ndarray:
    """Coloured purples (the bat's wing membrane)."""
    return (hue > WING_HUES[0]) & (hue < WING_HUES[1]) & (chroma > COLOURED_CHROMA)


def shadow(lightness: np.ndarray, chroma: np.ndarray, hue: np.ndarray) -> np.ndarray:
    """Near-greys (the bat's body)."""
    return chroma < SHADOW_CHROMA_MAX


def coloured(lightness: np.ndarray, chroma: np.ndarray, hue: np.ndarray) -> np.ndarray:
    """Anything with any chroma."""
    return chroma > 0
