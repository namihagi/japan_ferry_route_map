"""推定形状を計算して data/estimated/ に保存する CLI。

pnpm data:estimate                  # 必要な区間のうち、未計算か港の座標が変わったものだけ計算する
pnpm data:estimate --force          # 必要な区間をすべて計算し直す
pnpm data:estimate --pair A B       # 港 A-B を試しに計算し、.cache/estimated-trial/ に保存する
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .land import DEFAULT_LAND_PATH, read_land
from .registry import PortPair, load_ports, pairs_needing_estimate
from .router import METHOD, NoRouteError, estimate_leg

DATA_DIR = Path("data")
ESTIMATED_DIR = DATA_DIR / "estimated"
TRIAL_DIR = Path(".cache/estimated-trial")


def _is_up_to_date(file: Path, coord_a: tuple[float, float], coord_b: tuple[float, float]) -> bool:
    if not file.exists():
        return False
    props = json.loads(file.read_text(encoding="utf-8"))["properties"]
    return (
        props.get("method") == METHOD
        and props.get("fromCoord") == list(coord_a)
        and props.get("toCoord") == list(coord_b)
    )


def _write(file: Path, pair: PortPair, coord_a, coord_b, est) -> None:
    feature = {
        "type": "Feature",
        "properties": {
            "from": pair.a,
            "to": pair.b,
            "fromCoord": list(coord_a),
            "toCoord": list(coord_b),
            "method": METHOD,
            "stage": est.stage,
            "cellSizeM": est.cell_size_m,
            "snapFromM": est.snap_from_m,
            "snapToM": est.snap_to_m,
            "landCrossingM": est.land_crossing_m,
        },
        "geometry": {"type": "LineString", "coordinates": est.coordinates},
    }
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(feature, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="推定形状（海上だけを通る最短経路）を計算する")
    parser.add_argument("--force", action="store_true", help="計算済みの区間も計算し直す")
    parser.add_argument("--pair", nargs=2, metavar=("PORT_A", "PORT_B"), help="指定した港の組だけを試しに計算する")
    parser.add_argument("--land", type=Path, default=DEFAULT_LAND_PATH, help="陸地ポリゴンの shapefile")
    args = parser.parse_args()

    ports = load_ports(DATA_DIR)
    if args.pair:
        pairs, out_dir, force = [PortPair.of(*args.pair)], TRIAL_DIR, True
    else:
        pairs, out_dir, force = pairs_needing_estimate(DATA_DIR), ESTIMATED_DIR, args.force

    failed = False
    for pair in pairs:
        missing = [p for p in (pair.a, pair.b) if p not in ports]
        if missing:
            print(
                f"{pair.key}: 港台帳に {', '.join(missing)} がありません（data/ports.yaml を確認する）", file=sys.stderr
            )
            failed = True
            continue
        coord_a, coord_b = ports[pair.a], ports[pair.b]
        file = out_dir / f"{pair.key}.geojson"
        if not force and _is_up_to_date(file, coord_a, coord_b):
            print(f"{pair.key}: 計算済み（スキップ）")
            continue
        started = time.monotonic()
        try:
            est = estimate_leg(lambda bbox: read_land(args.land, bbox), coord_a, coord_b)
        except NoRouteError as error:
            print(f"{pair.key}: 失敗: {error}", file=sys.stderr)
            failed = True
            continue
        _write(file, pair, coord_a, coord_b, est)
        print(
            f"{pair.key}: {len(est.coordinates)} 点、{est.stage}、マス {est.cell_size_m} m、"
            f"{time.monotonic() - started:.1f} 秒 → {file}"
        )
        for warning in est.warnings:
            print(f"  警告: {warning}", file=sys.stderr)

    if not pairs:
        print("推定形状が必要な区間はありません（全区間に osmWays がある）")
    sys.exit(1 if failed else 0)
