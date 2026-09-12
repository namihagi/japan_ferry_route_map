"""海上だけを通る最短経路（推定形状）の計算。

区間の長さに応じて、次のどちらかで探す（docs/spec.md「推定形状」）。

- 短い区間：区間の周囲全体を細かいマス目（30 km 未満は 20 m、それ以外は 40 m）にして一度に探す。
- 長い区間（細かいマス目ではマスが多すぎる区間）：2段階で探す。
  1. 粗いマス目（約450 m）で大まかな経路を出し、見通しの利く範囲で直線にする。粗いマスは、
     中の小さなマス（約150 m）が1つでも海なら通れるとし、狭い海峡を閉じないようにする。
     陸の割合が大きいマスほど通りにくくする。
  2. 大まかな経路を約50 km ごとに区切り、それぞれの周囲（回廊）だけを細かいマス目で探し直す。
     回廊の中で見つからなければ回廊を広げる。それでも見つからなければ、区間全体を
     マス数の上限に収まる最も細かいマス目で探す（警告を出す）。

細かいマス目での探索：
- マスの中心が陸なら通れない。陸に近いマスほど通りにくくし、線が岸に張り付かないようにする。
  中心は海でも陸に触れているマス（マスより小さい島や、岸にかかるマス）は、さらに通りにくくする。
- 8近傍の最小コスト経路（skimage.graph.MCP_Geometric）を求め、見通しの利く範囲を直線でつなぐ。

最後に、区間全体を陸地ポリゴンと突き合わせながら直線化し、陸を横切っていないか検証する。
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from itertools import pairwise

import numpy as np
import rasterio.features
import shapely
from rasterio.transform import from_origin
from scipy import ndimage
from skimage.draw import line as raster_line
from skimage.graph import MCP_Geometric

from .geo import LocalProjection, haversine_m

# 細かいマス目の大きさ（メートル）
FINE_CELL_M = 40
SHORT_LEG_CELL_M = 20
SHORT_LEG_M = 30_000
# 粗いマス目の大きさ（メートル）と、通れるかを判定する小さなマスへの分割数
COARSE_CELL_M = 450
COARSE_SUBDIVISION = 3
# 1回の探索で使うマス数の上限
MAX_CELLS = 12_000_000
# 回廊：大まかな経路を区切る長さと、経路からの幅（メートル）。見つからなければ幅を広げる
CHUNK_M = 50_000
CORRIDOR_WIDTHS_M = (5_000, 15_000)
# 陸地を読む範囲は、計算範囲よりこれだけ広くする。回廊やマス目の端は計算範囲の外へはみ出すため、
# その分の陸地を読んでおかないと、外側が海として扱われて陸を突き抜ける経路ができる
LAND_MARGIN_M = max(CORRIDOR_WIDTHS_M) + 5_000
# 全体を1段階で探し直すときのマスの大きさの候補（メートル）
FALLBACK_CELL_SIZES_M = (20, 40, 60, 100, 150, 250, 400, 600, 1000)
# 陸からこの距離（またはマス3つ分の大きい方）以内のマスは通りにくくする（メートル）
SHORE_ZONE_M = 150.0
SHORE_ZONE_CELLS = 3
SHORE_PENALTY = 4.0
# 陸に触れているマスに、さらに足すコスト
TOUCHING_LAND_PENALTY = 4.0
# 港の近くで最寄りの海のマスを探す距離の上限と、警告を出す距離（メートル）
MAX_SNAP_M = 3_000.0
WARN_SNAP_M = 500.0
# 線が陸を横切る長さが、これを超えたら警告を出す（メートル）
WARN_CROSSING_M = 50.0

METHOD = "corridor-grid-v2"  # 計算方法を変えたら上げる（計算済みの推定形状が再計算される）

LandReader = Callable[[tuple[float, float, float, float]], np.ndarray]
"""bbox（経度緯度）を受け取り、その範囲の陸地ポリゴン（経度緯度）の配列を返す関数。"""

Bounds = tuple[float, float, float, float]


@dataclass
class Estimate:
    coordinates: list[list[float]]
    stage: str
    """single（1段階）/ corridor（2段階）/ fallback（2段階で見つからず、全体を粗く探した）"""
    cell_size_m: int
    snap_from_m: float
    snap_to_m: float
    land_crossing_m: float
    warnings: list[str]


class NoRouteError(RuntimeError):
    pass


@dataclass(frozen=True)
class _Grid:
    """平面座標（メートル）上の正方形のマス目。行は北から南、列は西から東に数える。"""

    xmin: float
    ymax: float
    cell: float
    rows: int
    cols: int

    @staticmethod
    def covering(bounds: Bounds, cell: float) -> _Grid:
        xmin, ymin, xmax, ymax = bounds
        rows = max(1, math.ceil((ymax - ymin) / cell))
        cols = max(1, math.ceil((xmax - xmin) / cell))
        return _Grid(xmin, ymax, cell, rows, cols)

    @property
    def size(self) -> int:
        return self.rows * self.cols

    @property
    def extent(self) -> Bounds:
        """マス目が実際に覆う範囲。行数・列数は切り上げなので、渡した範囲より少し外側まで広い。"""
        return (
            self.xmin,
            self.ymax - self.rows * self.cell,
            self.xmin + self.cols * self.cell,
            self.ymax,
        )

    def rasterize(self, geoms: np.ndarray | list, all_touched: bool = False) -> np.ndarray:
        if len(geoms) == 0:
            return np.zeros((self.rows, self.cols), dtype=bool)
        return rasterio.features.rasterize(
            ((g, 1) for g in geoms),
            out_shape=(self.rows, self.cols),
            transform=from_origin(self.xmin, self.ymax, self.cell, self.cell),
            fill=0,
            dtype="uint8",
            all_touched=all_touched,
        ).astype(bool)

    def cell_of(self, xy: np.ndarray) -> tuple[int, int]:
        return int((self.ymax - xy[1]) // self.cell), int((xy[0] - self.xmin) // self.cell)

    def centers(self, rc: np.ndarray) -> np.ndarray:
        return np.column_stack([self.xmin + (rc[:, 1] + 0.5) * self.cell, self.ymax - (rc[:, 0] + 0.5) * self.cell])

    def snap(self, passable: np.ndarray, xy: np.ndarray, max_m: float, label: str) -> tuple[tuple[int, int], float]:
        """xy を含むマスが通れなければ、max_m 以内で最寄りの通れるマスに寄せる。寄せた距離も返す。"""
        r, c = self.cell_of(xy)
        if not (0 <= r < self.rows and 0 <= c < self.cols):
            raise NoRouteError(f"{label}が計算範囲の外にある")
        if passable[r, c]:
            return (r, c), 0.0
        radius = math.ceil(max_m / self.cell)
        r0, c0 = max(0, r - radius), max(0, c - radius)
        rr, cc = np.nonzero(passable[r0 : r + radius + 1, c0 : c + radius + 1])
        if len(rr) == 0:
            raise NoRouteError(f"{label}から {max_m:.0f} m 以内に海のマスがない")
        distances = np.hypot(rr + r0 - r, cc + c0 - c) * self.cell
        k = int(np.argmin(distances))
        if distances[k] > max_m:
            raise NoRouteError(f"{label}から {max_m:.0f} m 以内に海のマスがない")
        return (int(rr[k] + r0), int(cc[k] + c0)), float(distances[k])


class _Land:
    """区間の周囲の陸地ポリゴン（平面座標）と、その空間索引。"""

    def __init__(self, polygons: np.ndarray) -> None:
        self.polygons = polygons
        self.tree = shapely.STRtree(polygons)

    def within(self, bounds: Bounds) -> np.ndarray:
        clipped = shapely.clip_by_rect(self.polygons[self.tree.query(shapely.box(*bounds))], *bounds)
        return clipped[~shapely.is_empty(clipped)]

    def intersects(self, geom: shapely.Geometry) -> bool:
        return len(self.tree.query(geom, predicate="intersects")) > 0

    def within_distance(self, geom: shapely.Geometry, distance: float) -> bool:
        if distance <= 0:
            return self.intersects(geom)
        return len(self.tree.query(geom, predicate="dwithin", distance=distance)) > 0

    def clearance(self, points: np.ndarray) -> np.ndarray:
        """各点から最寄りの陸までの距離。"""
        result = np.full(len(points), np.inf)
        if len(self.polygons) == 0:
            return result
        (point_idx, _), distances = self.tree.query_nearest(shapely.points(points), return_distance=True)
        result[point_idx] = distances
        return result

    def crossing_length(self, line: shapely.LineString) -> float:
        hits = self.tree.query(line, predicate="intersects")
        return float(sum(shapely.intersection(line, self.polygons[i]).length for i in hits))


def choose_cell_size(width_m: float, height_m: float, distance_m: float, max_cells: int = MAX_CELLS) -> int:
    """マス数が上限に収まる範囲で、できるだけ細かいマスを選ぶ（短い区間は 20 m、それ以外は 40 m から）。"""
    floor = SHORT_LEG_CELL_M if distance_m < SHORT_LEG_M else FINE_CELL_M
    needed = math.sqrt(width_m * height_m / max_cells)
    for size in FALLBACK_CELL_SIZES_M:
        if size >= max(floor, needed):
            return size
    return FALLBACK_CELL_SIZES_M[-1]


def _bbox(a: tuple[float, float], b: tuple[float, float], margin_m: float) -> Bounds:
    lat_mid = (a[1] + b[1]) / 2
    dlat = margin_m / 111_000
    dlon = margin_m / (111_000 * math.cos(math.radians(lat_mid)))
    return (min(a[0], b[0]) - dlon, min(a[1], b[1]) - dlat, max(a[0], b[0]) + dlon, max(a[1], b[1]) + dlat)


# 計算範囲（港の組を囲む範囲の余白）。経路が見つからなければ、次の余白で探し直す
MARGINS = ((15_000.0, 0.35), (40_000.0, 0.7), (80_000.0, 1.2))
# 経路の長さが直線距離のこの倍数を超えたら、計算範囲の外に近道があるかもしれないので広げて探し直す
DETOUR_RATIO = 1.3


def _path_length_m(coordinates: list[list[float]]) -> float:
    return sum(haversine_m(tuple(a), tuple(b)) for a, b in pairwise(coordinates))


def estimate_leg(
    read_land: LandReader,
    port_from: tuple[float, float],
    port_to: tuple[float, float],
    max_cells: int = MAX_CELLS,
) -> Estimate:
    """海上だけを通る最短経路を探す。

    計算範囲は港の組を囲む範囲に余白を足したもの。経路が見つからないとき、または見つかっても
    遠回り（直線距離の DETOUR_RATIO 倍超）のときは、余白を広げて探し直し、最も短い経路を採る。
    """
    distance = haversine_m(port_from, port_to)
    best: Estimate | None = None
    error: NoRouteError | None = None
    for minimum, scale in MARGINS:
        try:
            est = _estimate_within(read_land, port_from, port_to, max(minimum, distance * scale), max_cells)
        except NoRouteError as e:
            error = e
            continue
        if best is None or _path_length_m(est.coordinates) < _path_length_m(best.coordinates):
            best = est
        if _path_length_m(best.coordinates) <= distance * DETOUR_RATIO:
            break
    if best is None:
        raise NoRouteError(f"計算範囲を広げても見つからない（{error}）")
    return best


def _estimate_within(
    read_land: LandReader,
    port_from: tuple[float, float],
    port_to: tuple[float, float],
    margin_m: float,
    max_cells: int,
) -> Estimate:
    distance = haversine_m(port_from, port_to)
    bbox = _bbox(port_from, port_to, margin_m)
    proj = LocalProjection((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
    (xmin, ymin), (xmax, ymax) = proj.forward(np.array([[bbox[0], bbox[1]], [bbox[2], bbox[3]]]))
    bounds: Bounds = (xmin, ymin, xmax, ymax)
    land = _Land(shapely.transform(read_land(_bbox(port_from, port_to, margin_m + LAND_MARGIN_M)), proj.forward))
    start, end = proj.forward(np.array([port_from, port_to]))

    cell = SHORT_LEG_CELL_M if distance < SHORT_LEG_M else FINE_CELL_M
    warnings: list[str] = []
    if _Grid.covering(bounds, cell).size <= max_cells:
        stage = "single"
        points, snap_from, snap_to = _fine_search(land, bounds, cell, start, end)
    else:
        try:
            stage = "corridor"
            points, snap_from, snap_to = _corridor_search(land, bounds, cell, start, end, max_cells)
        except NoRouteError as error:
            stage = "fallback"
            cell = choose_cell_size(xmax - xmin, ymax - ymin, distance, max_cells)
            points, snap_from, snap_to = _fine_search(land, bounds, cell, start, end)
            warnings.append(f"回廊の中で経路が見つからず（{error}）、区間全体を {cell} m のマス目で探した")

    for label, snap in (("出発港", snap_from), ("到着港", snap_to)):
        if snap > WARN_SNAP_M:
            warnings.append(f"{label}を最寄りの海まで {snap:.0f} m 寄せた（目視で確認する）")

    points = _straighten(points, land)
    crossing = land.crossing_length(shapely.LineString(points)) if len(points) >= 2 else 0.0
    if crossing > WARN_CROSSING_M:
        warnings.append(f"線が陸を {crossing:.0f} m 横切っている（目視で確認する）")

    lonlat = proj.inverse(points)
    coordinates = [list(port_from), *[[float(x), float(y)] for x, y in lonlat], list(port_to)]
    return Estimate(
        coordinates=[[round(x, 6), round(y, 6)] for x, y in coordinates],
        stage=stage,
        cell_size_m=cell,
        snap_from_m=round(snap_from, 1),
        snap_to_m=round(snap_to, 1),
        land_crossing_m=round(crossing, 1),
        warnings=warnings,
    )


def _fine_search(
    land: _Land,
    bounds: Bounds,
    cell: float,
    start: np.ndarray,
    end: np.ndarray,
    corridor: shapely.Geometry | None = None,
    max_snap: tuple[float, float] = (MAX_SNAP_M, MAX_SNAP_M),
) -> tuple[np.ndarray, float, float]:
    """細かいマス目で start から end までを探し、見通しの利く範囲を直線でつないだ点列を返す。"""
    grid = _Grid.covering(bounds, cell)
    # 陸地はマス目が覆う範囲で切り取る。渡した範囲で切り取ると、はみ出した端のマスが
    # 陸なしの海と判定され、そこを通り抜ける経路ができてしまう
    polygons = land.within(grid.extent)
    touching = grid.rasterize(polygons, all_touched=True)
    water = ~grid.rasterize(polygons)
    if corridor is not None:
        water &= grid.rasterize([corridor], all_touched=True)

    start_rc, snap_start = grid.snap(water, start, max_snap[0], "出発点")
    end_rc, snap_end = grid.snap(water, end, max_snap[1], "到着点")

    # 陸から近いほど高いコスト。陸は通れない（無限大）
    penalty = np.zeros((grid.rows, grid.cols), dtype=np.float32)
    if touching.any():
        shore_zone = max(SHORE_ZONE_M, SHORE_ZONE_CELLS * cell)
        dist_to_land = ndimage.distance_transform_edt(~touching).astype(np.float32) * cell
        penalty = (SHORE_PENALTY * np.clip(1 - dist_to_land / shore_zone, 0, 1)).astype(np.float32)
        penalty[touching] += TOUCHING_LAND_PENALTY
    costs = np.where(water, 1.0 + penalty, np.inf)

    mcp = MCP_Geometric(costs, fully_connected=True)
    cumulative, _ = mcp.find_costs([start_rc], [end_rc])
    if not np.isfinite(cumulative[end_rc]):
        raise NoRouteError("海の上だけを通る経路が見つからない")
    path = np.array(mcp.traceback(end_rc))

    def clear_of_land(a: np.ndarray, b: np.ndarray) -> bool:
        return not land.intersects(shapely.LineString(grid.centers(np.array([a, b]))))

    pulled = _remove_kinks(_string_pull(path, water, penalty, clear_of_land), water, penalty, clear_of_land)
    return grid.centers(pulled), snap_start, snap_end


def _coarse_path(land: _Land, bounds: Bounds, start: np.ndarray, end: np.ndarray, max_cells: int) -> np.ndarray:
    """粗いマス目で大まかな経路を探し、マスの中心の点列（両端は start と end）を返す。"""
    xmin, ymin, xmax, ymax = bounds
    k = COARSE_SUBDIVISION
    sub_cell = max(COARSE_CELL_M / k, math.sqrt((xmax - xmin) * (ymax - ymin) / max_cells))
    coarse = _Grid.covering(bounds, sub_cell * k)
    sub = _Grid(coarse.xmin, coarse.ymax, sub_cell, coarse.rows * k, coarse.cols * k)
    land_fraction = sub.rasterize(land.polygons).reshape(coarse.rows, k, coarse.cols, k).mean(axis=(1, 3))
    passable = land_fraction < 1
    costs = np.where(passable, 1.0 + 2.0 * land_fraction, np.inf)

    start_rc, _ = coarse.snap(passable, start, MAX_SNAP_M + coarse.cell, "出発港")
    end_rc, _ = coarse.snap(passable, end, MAX_SNAP_M + coarse.cell, "到着港")
    mcp = MCP_Geometric(costs, fully_connected=True)
    cumulative, _ = mcp.find_costs([start_rc], [end_rc])
    if not np.isfinite(cumulative[end_rc]):
        raise NoRouteError("粗いマス目でも海の上だけを通る経路が見つからない")
    # 8方向の移動でできたカドを、見通しの利く範囲で直線にしてから回廊の芯にする
    path = np.array(mcp.traceback(end_rc))
    penalty = land_fraction.astype(np.float32)
    pulled = _remove_kinks(_string_pull(path, passable, penalty), passable, penalty, lambda _a, _b: True)
    xy = coarse.centers(pulled)
    line = shapely.LineString(np.vstack([start, xy[1:-1], end]) if len(xy) > 2 else np.vstack([start, end]))
    # 回廊を約 CHUNK_M ごとに区切れるよう、直線化で減った点を補う
    return shapely.get_coordinates(shapely.segmentize(line, coarse.cell * 10))


def _split(points: np.ndarray, chunk_m: float) -> list[np.ndarray]:
    """点列を、道のりがおよそ chunk_m ずつになるよう区切る（区切りの点は前後で共有する）。"""
    along = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(points, axis=0).T))])
    pieces = max(1, math.ceil(along[-1] / chunk_m))
    cuts = np.searchsorted(along, along[-1] * np.arange(1, pieces) / pieces)
    indices = sorted({0, len(points) - 1, *(int(i) for i in cuts if 0 < i < len(points) - 1)})
    return [points[a : b + 1] for a, b in pairwise(indices)]


def _corridor_search(
    land: _Land, bounds: Bounds, cell: float, start: np.ndarray, end: np.ndarray, max_cells: int
) -> tuple[np.ndarray, float, float]:
    """粗いマス目の経路に沿った回廊の中を、区切りごとに細かいマス目で探す。"""
    pieces = _split(_coarse_path(land, bounds, start, end, max_cells), CHUNK_M)
    last = len(pieces) - 1
    collected: list[np.ndarray] = []
    current = start
    snap_from = snap_to = 0.0
    for k, piece in enumerate(pieces):
        target = end if k == last else piece[-1]
        line = shapely.LineString(np.vstack([current, piece[1:-1], target]) if len(piece) > 2 else [current, target])
        error: NoRouteError | None = None
        for width in CORRIDOR_WIDTHS_M:
            corridor = line.buffer(width)
            try:
                points, snap_start, snap_end = _fine_search(
                    land,
                    corridor.bounds,
                    cell,
                    current,
                    target,
                    corridor=corridor,
                    max_snap=(MAX_SNAP_M if k == 0 else 5 * cell, MAX_SNAP_M if k == last else width),
                )
                break
            except NoRouteError as e:
                error = e
        else:
            raise NoRouteError(f"区切り {k + 1}/{len(pieces)}: {error}")
        if k == 0:
            snap_from = snap_start
        if k == last:
            snap_to = snap_end
        collected.append(points if k == 0 else points[1:])
        current = points[-1]
    return np.vstack(collected), snap_from, snap_to


def _straighten(points: np.ndarray, land: _Land) -> np.ndarray:
    """陸地ポリゴンと突き合わせながら、区間全体を直線化する。

    点 i から、できるだけ遠い点 j へ直線でつなぐ。直線は、元の点 i..j より陸に近づいてはならない
    （岸からの距離の要求は SHORE_ZONE_M が上限。港の近くなど元から岸に近い所では要求も小さくなる）。
    """
    if len(points) <= 2:
        return points
    clearance = land.clearance(points)
    kept = [0]
    i = 0
    while i < len(points) - 1:
        j = len(points) - 1
        while j > i + 1:
            required = 0.8 * min(SHORE_ZONE_M, float(clearance[i : j + 1].min()))
            if not land.within_distance(shapely.LineString(points[[i, j]]), required):
                break
            j -= 1
        kept.append(j)
        i = j
    return points[kept]


def _string_pull(
    path: np.ndarray,
    water: np.ndarray,
    penalty: np.ndarray,
    clear_of_land: Callable[[np.ndarray, np.ndarray], bool] = lambda _i, _j: True,
) -> np.ndarray:
    """経路のマス列を、見通しの利く範囲で直線につなぐ。

    i から j への直線は、通るマスがすべて海で、かつ元の経路の i..j 区間より陸に近づかない
    （通るマスの penalty の最大値が、元の区間の最大値を超えない）ときだけ採用する。
    さらに clear_of_land（陸地ポリゴンとの交差判定）を満たすまで、j を1つずつ手前に戻す。
    """
    kept = [0]
    i = 0
    n = len(path)
    while i < n - 1:
        best = i + 1
        running_max = penalty[path[i][0], path[i][1]]
        for j in range(i + 1, n):
            running_max = max(running_max, penalty[path[j][0], path[j][1]])
            if _segment_penalty(path[i], path[j], water, penalty) <= running_max + 1e-9:
                best = j
            elif j - best > 64:
                # しばらく見通せない状態が続いたら打ち切る（計算量を抑えるため）
                break
        while best > i + 1 and not clear_of_land(path[i], path[best]):
            best -= 1
        kept.append(best)
        i = best
    return path[kept]


def _segment_penalty(a: np.ndarray, b: np.ndarray, water: np.ndarray, penalty: np.ndarray) -> float:
    """a から b への直線が通るマスの penalty の最大値。陸のマスを通るなら無限大。"""
    rr, cc = raster_line(a[0], a[1], b[0], b[1])
    return float(penalty[rr, cc].max()) if water[rr, cc].all() else math.inf


def _remove_kinks(
    points: np.ndarray,
    water: np.ndarray,
    penalty: np.ndarray,
    clear_of_land: Callable[[np.ndarray, np.ndarray], bool],
) -> np.ndarray:
    """前後の点を直接つないでも陸に近づかないなら、間の点を取り除く（変わらなくなるまで繰り返す）。

    MCP の経路は8方向の移動の組み合わせなので、開けた海でも「東へ進んでから北東へ」のような
    折れ曲がりが残る。見通しによる直線化では取り切れないものをここで直す。
    """
    kept = list(points)
    changed = True
    while changed:
        changed = False
        k = 1
        while k < len(kept) - 1:
            prev, cur, nxt = kept[k - 1], kept[k], kept[k + 1]
            current = max(_segment_penalty(prev, cur, water, penalty), _segment_penalty(cur, nxt, water, penalty))
            if _segment_penalty(prev, nxt, water, penalty) <= current + 1e-9 and clear_of_land(prev, nxt):
                del kept[k]
                changed = True
            else:
                k += 1
    return np.array(kept)
