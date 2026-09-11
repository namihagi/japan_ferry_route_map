"""経度緯度と、区間ごとのローカルな平面座標（メートル）の変換。"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

EARTH_RADIUS_M = 6_371_008.8


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


@dataclass(frozen=True)
class LocalProjection:
    """区間の中心付近で正距円筒図法を使う平面座標。区間程度の広さなら歪みは小さい。"""

    lon0: float
    lat0: float

    @property
    def _kx(self) -> float:
        return math.radians(1) * EARTH_RADIUS_M * math.cos(math.radians(self.lat0))

    @property
    def _ky(self) -> float:
        return math.radians(1) * EARTH_RADIUS_M

    def forward(self, lonlat: np.ndarray) -> np.ndarray:
        """(n, 2) の経度緯度 → (n, 2) の x, y（メートル）。"""
        xy = np.empty_like(lonlat, dtype=float)
        xy[:, 0] = (lonlat[:, 0] - self.lon0) * self._kx
        xy[:, 1] = (lonlat[:, 1] - self.lat0) * self._ky
        return xy

    def inverse(self, xy: np.ndarray) -> np.ndarray:
        lonlat = np.empty_like(xy, dtype=float)
        lonlat[:, 0] = xy[:, 0] / self._kx + self.lon0
        lonlat[:, 1] = xy[:, 1] / self._ky + self.lat0
        return lonlat
