"""lab.py — sRGB 0..255 ↔ CIE LAB (D65)."""
import numpy as np

from assetkit import OPAQUE

CHANNEL_MAX = 255.0
SRGB_KNEE = 0.04045
LINEAR_KNEE = 0.0031308
SRGB_OFFSET = 0.055
SRGB_SCALE = 1.055
SRGB_GAMMA = 2.4
SRGB_SLOPE = 12.92
SRGB_TO_XYZ = ((0.4124, 0.3576, 0.1805), (0.2126, 0.7152, 0.0722), (0.0193, 0.1192, 0.9505))
XYZ_TO_SRGB = ((3.2406, -1.5372, -0.4986), (-0.9689, 1.8758, 0.0415), (0.0557, -0.204, 1.057))
WHITE_D65 = (0.95047, 1.0, 1.08883)
LAB_EPSILON = 0.008856
LAB_SLOPE = 7.787
LAB_L_SCALE = 116
LAB_L_OFFSET = 16
LAB_F_OFFSET = LAB_L_OFFSET / LAB_L_SCALE
LAB_A_SCALE = 500
LAB_B_SCALE = 200


def _srgb_to_xyz(rgb: np.ndarray) -> np.ndarray:
    scaled = rgb / CHANNEL_MAX
    linear = np.where(scaled > SRGB_KNEE, ((scaled + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_GAMMA, scaled / SRGB_SLOPE)
    return linear @ np.array(SRGB_TO_XYZ).T / np.array(WHITE_D65)


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB 0..255 → LAB."""
    xyz = _srgb_to_xyz(rgb)
    curve = np.where(xyz > LAB_EPSILON, np.cbrt(xyz), LAB_SLOPE * xyz + LAB_F_OFFSET)
    curve_x, curve_y, curve_z = np.moveaxis(curve, -1, 0)
    return np.stack(
        (
            LAB_L_SCALE * curve_y - LAB_L_OFFSET,
            LAB_A_SCALE * (curve_x - curve_y),
            LAB_B_SCALE * (curve_y - curve_z),
        ),
        -1,
    )


def _lab_curve_inverse(curve: np.ndarray) -> np.ndarray:
    cube = curve ** 3
    return np.where(cube > LAB_EPSILON, cube, (curve - LAB_F_OFFSET) / LAB_SLOPE)


def _linear_to_srgb(linear: np.ndarray) -> np.ndarray:
    companded = SRGB_SCALE * linear ** (1 / SRGB_GAMMA) - SRGB_OFFSET
    return np.where(linear > LINEAR_KNEE, companded, SRGB_SLOPE * linear) * OPAQUE


def lab_to_srgb(lab: np.ndarray) -> np.ndarray:
    """LAB → sRGB 0..255 (float, clipped to the gamut)."""
    lightness, green_red, blue_yellow = np.moveaxis(lab, -1, 0)
    curve_y = (lightness + LAB_L_OFFSET) / LAB_L_SCALE
    xyz = (
        _lab_curve_inverse(curve_y + green_red / LAB_A_SCALE) * WHITE_D65[0],
        _lab_curve_inverse(curve_y),
        _lab_curve_inverse(curve_y - blue_yellow / LAB_B_SCALE) * WHITE_D65[2],
    )
    return _linear_to_srgb(np.clip(np.stack(xyz, -1) @ np.array(XYZ_TO_SRGB).T, 0, 1))
