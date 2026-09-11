import numpy as np
import shapely

from sea_router.registry import PortPair
from sea_router.router import _remove_kinks, _string_pull, choose_cell_size, estimate_leg


def test_port_pair_is_order_independent():
    assert PortPair.of("takamatsu", "tonosho") == PortPair.of("tonosho", "takamatsu")
    assert PortPair.of("takamatsu", "tonosho").key == "takamatsu--tonosho"


def test_short_legs_use_fine_cells_and_long_legs_stay_within_budget():
    assert choose_cell_size(40_000, 30_000, 10_000) == 20
    size = choose_cell_size(950_000, 560_000, 560_000)
    assert 950_000 * 560_000 / size**2 <= 25_000_000


def test_string_pull_straightens_open_water():
    water = np.ones((10, 10), dtype=bool)
    penalty = np.zeros((10, 10))
    path = np.array([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]])
    assert _string_pull(path, water, penalty).tolist() == [[0, 0], [4, 4]]


def test_remove_kinks_straightens_an_eight_direction_dogleg():
    water = np.ones((20, 20), dtype=bool)
    penalty = np.zeros((20, 20))
    # 東へ進んでから南東へ曲がる経路（開けた海なので直線で結べる）
    points = np.array([[0, 0], [0, 10], [9, 19]])
    assert _remove_kinks(points, water, penalty, lambda _a, _b: True).tolist() == [[0, 0], [9, 19]]


def _wall_with_gap(bbox):
    """経度 133.05 に南北の陸の壁を置き、北緯 34.0 付近だけ幅 約300 m の海峡を開けた陸地。"""
    south = shapely.box(133.04, 33.90, 133.06, 33.9985)
    north = shapely.box(133.04, 34.0015, 133.06, 34.10)
    return np.array([south, north])


def test_route_goes_through_the_strait_without_crossing_land():
    # 海峡から南北にずれた2点を結ぶ。直線だと壁を横切るので、海峡を通るはず
    est = estimate_leg(_wall_with_gap, (133.00, 34.03), (133.10, 33.97))
    line = shapely.LineString(est.coordinates)
    assert est.land_crossing_m == 0
    assert not line.intersects(shapely.union_all(_wall_with_gap(None)))
    # 壁を越える点の緯度が海峡の範囲にある
    crossing = line.intersection(shapely.LineString([(133.05, 33.9), (133.05, 34.1)]))
    assert 33.9985 < crossing.y < 34.0015


def test_long_leg_uses_coarse_path_and_corridor_but_still_finds_the_strait():
    # マス数の上限を小さくして、2段階（粗いマス目 → 回廊）で探させる
    est = estimate_leg(_wall_with_gap, (133.00, 34.03), (133.10, 33.97), max_cells=200_000)
    line = shapely.LineString(est.coordinates)
    assert est.stage == "corridor"
    assert est.land_crossing_m == 0
    crossing = line.intersection(shapely.LineString([(133.05, 33.9), (133.05, 34.1)]))
    assert 33.9985 < crossing.y < 34.0015


def test_port_on_land_is_snapped_to_nearest_water():
    # 出発港を壁の中（陸）に置く
    est = estimate_leg(_wall_with_gap, (133.045, 34.05), (133.10, 34.05))
    assert est.snap_from_m > 0
    assert est.coordinates[0] == [133.045, 34.05]


def test_widens_the_search_area_when_the_route_must_round_a_distant_cape():
    # 2点の間に南北に長い陸（北端は 34.30 付近）があり、最初の計算範囲では回り込めない
    def peninsula(bbox):
        return np.array([shapely.box(133.04, 33.50, 133.06, 34.30)])

    est = estimate_leg(peninsula, (133.00, 34.00), (133.10, 34.00))
    line = shapely.LineString(est.coordinates)
    assert est.land_crossing_m == 0
    assert line.bounds[3] > 34.30
