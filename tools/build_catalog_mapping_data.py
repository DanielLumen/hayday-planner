#!/usr/bin/env python3
"""Build the read-only catalog reconciliation data used by catalog-mapping.html.

The reference snapshots are captured from haydaycalculator.shootingspeed.com.
Only English names, image URLs, source labels, and canonical slugs are retained.
Production times, prices, levels, recipes, and quantities are intentionally
discarded.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REFERENCE_URL = "https://haydaycalculator.shootingspeed.com"


def canonical_id(href: str) -> str:
    slug = href.rstrip("/").split("/")[-1]
    return re.sub(r"[^a-z0-9]+", "_", slug.lower()).strip("_")


def first_line(text: str) -> str:
    return next((line.strip() for line in text.splitlines() if line.strip()), "")


def source_line(text: str) -> str:
    match = re.search(r"(?m)^Source:\s*(.+?)\s*$", text)
    return match.group(1).strip() if match else ""


def read_snapshot(path: Path, kind: str) -> list[dict]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise ValueError(f"{path} must contain an array")

    result = []
    seen = set()
    for row in rows:
        href = str(row.get("href") or "")
        image = str(row.get("image") or "")
        name = first_line(str(row.get("text") or ""))
        item_id = canonical_id(href)
        if not item_id or not name or not image or item_id in seen:
            continue
        seen.add(item_id)
        result.append(
            {
                "kind": kind,
                "canonicalId": item_id,
                "nameEN": name,
                "imageUrl": image,
                "sourceLabel": source_line(str(row.get("text") or "")) if kind == "item" else "",
                "sourceUrl": f"{REFERENCE_URL}{href}",
            }
        )
    return result


def extract_block(source: str, start: str, end: str) -> str:
    if start not in source or end not in source:
        raise ValueError(f"Cannot locate catalog block between {start!r} and {end!r}")
    return source.split(start, 1)[1].split(end, 1)[0]


def read_local_catalog(index_path: Path) -> dict:
    source = index_path.read_text(encoding="utf-8")
    buildings_block = extract_block(source, "buildings:[", "\n],\nitems:[")
    items_block = extract_block(source, "items:[", "\n]\n};")

    buildings = []
    for line in buildings_block.splitlines():
        match = re.search(r'\{id:"([^"]+)",nameCN:"([^"]+)"', line)
        if match:
            buildings.append({"legacyId": match.group(1), "nameCN": match.group(2), "kind": "building"})

    items = []
    for line in items_block.splitlines():
        match = re.search(r'\{id:"([^"]+)",nameCN:"([^"]+)"', line)
        if not match:
            continue
        building = re.search(r'bld:"([^"]+)"', line)
        items.append(
            {
                "legacyId": match.group(1),
                "nameCN": match.group(2),
                "buildingId": building.group(1) if building else "",
                "kind": "item",
            }
        )
    return {"items": items, "buildings": buildings}


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_browser_data(path: Path, reference: dict, local_catalog: dict) -> None:
    payload = {
        "reference": reference,
        "local": {"version": 1, **local_catalog},
    }
    path.write_text(
        "window.HAYDAY_CATALOG_MAPPING_DATA = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--goods", type=Path, required=True)
    parser.add_argument("--buildings", type=Path, required=True)
    parser.add_argument("--index", type=Path, default=ROOT / "index.html")
    parser.add_argument("--out-dir", type=Path, default=ROOT)
    args = parser.parse_args()

    reference_items = read_snapshot(args.goods, "item")
    reference_buildings = read_snapshot(args.buildings, "building")
    local_catalog = read_local_catalog(args.index)

    reference = {
        "version": 1,
        "source": REFERENCE_URL,
        "policy": {
            "acceptedFields": ["canonicalId", "nameEN", "imageUrl", "sourceLabel", "sourceUrl"],
            "ignoredFields": ["level", "price", "time", "xp", "ingredients", "quantities"],
        },
        "items": reference_items,
        "buildings": reference_buildings,
    }
    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_json(args.out_dir / "catalog-reference.json", reference)
    write_json(args.out_dir / "catalog-local-base.json", {"version": 1, **local_catalog})
    write_browser_data(args.out_dir / "catalog-mapping-data.js", reference, local_catalog)
    print(
        json.dumps(
            {
                "referenceItems": len(reference_items),
                "referenceBuildings": len(reference_buildings),
                "localItems": len(local_catalog["items"]),
                "localBuildings": len(local_catalog["buildings"]),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
