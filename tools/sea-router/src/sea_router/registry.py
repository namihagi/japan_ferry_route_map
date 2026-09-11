"""航路台帳・港台帳から、推定形状が必要な区間を取り出す。

台帳の検証は TypeScript 側（scripts/lib/registry.ts）が正本。ここでは必要な項目だけを読む。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class PortPair:
    """推定形状を共有する港の組。向きを持たず、ID の辞書順で a < b にそろえる。"""

    a: str
    b: str

    @staticmethod
    def of(x: str, y: str) -> PortPair:
        return PortPair(*sorted((x, y)))

    @property
    def key(self) -> str:
        return f"{self.a}--{self.b}"


def load_ports(data_dir: Path) -> dict[str, tuple[float, float]]:
    ports = yaml.safe_load((data_dir / "ports.yaml").read_text(encoding="utf-8"))
    return {p["id"]: (float(p["lon"]), float(p["lat"])) for p in ports}


def pairs_needing_estimate(data_dir: Path) -> list[PortPair]:
    """osmWays を持たない区間の港の組（全航路、重複なし）。"""
    pairs: set[PortPair] = set()
    for file in sorted((data_dir / "routes").glob("*.yaml")):
        route = yaml.safe_load(file.read_text(encoding="utf-8"))
        for leg in route.get("legs", []):
            if not leg.get("osmWays"):
                pairs.add(PortPair.of(leg["from"], leg["to"]))
    return sorted(pairs, key=lambda p: p.key)
