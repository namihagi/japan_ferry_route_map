"""陸地ポリゴン（OSM land polygons、ODbL）の読み込み。"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pyogrio.raw
import shapely

# https://osmdata.openstreetmap.de/data/land-polygons.html の land-polygons-split-4326
DEFAULT_LAND_PATH = Path(".cache/land/land-polygons-split-4326/land_polygons.shp")


def read_land(path: Path, bbox: tuple[float, float, float, float]) -> np.ndarray:
    """bbox（経度緯度）にかかる陸地ポリゴンを、bbox で切り取った配列で返す。"""
    if not path.exists():
        raise FileNotFoundError(
            f"陸地ポリゴンがありません: {path}\n"
            "https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip を"
            " .cache/land/ に展開してください（data/README.md の「推定形状」を参照）。"
        )
    _meta, _fids, wkb, _fields = pyogrio.raw.read(path, bbox=bbox, read_geometry=True, columns=[])
    polygons = shapely.from_wkb(wkb)
    clipped = shapely.clip_by_rect(polygons, *bbox)
    return clipped[~shapely.is_empty(clipped)]
