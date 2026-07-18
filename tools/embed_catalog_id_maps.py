#!/usr/bin/env python3
"""Embed the audited rename maps in catalog-migration.js."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def rename_map(rows: list[dict]) -> dict[str, str]:
    return {
        row["legacyId"]: row["canonicalId"]
        for row in rows
        if row.get("decision") == "matched"
        and row.get("legacyId")
        and row.get("canonicalId")
        and row["legacyId"] != row["canonicalId"]
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mapping", type=Path)
    parser.add_argument("module", type=Path)
    args = parser.parse_args()
    data = json.loads(args.mapping.read_text(encoding="utf-8-sig"))
    item_ids = rename_map(data.get("items", []))
    building_ids = rename_map(data.get("buildings", []))
    if len(item_ids) != 81 or len(building_ids) != 5:
        raise ValueError(
            f"unexpected rename counts: items={len(item_ids)}, buildings={len(building_ids)}"
        )
    source = args.module.read_text(encoding="utf-8")
    item_pattern = re.compile(r"var ITEM_IDS=/\* CATALOG_ITEM_IDS \*/\{.*?\};")
    building_pattern = re.compile(r"var BUILDING_IDS=/\* CATALOG_BUILDING_IDS \*/\{.*?\};")
    if not item_pattern.search(source) or not building_pattern.search(source):
        raise ValueError("catalog migration placeholders are missing")
    source = item_pattern.sub(
        "var ITEM_IDS=/* CATALOG_ITEM_IDS */"
        + json.dumps(item_ids, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        + ";",
        source,
        count=1,
    )
    source = building_pattern.sub(
        "var BUILDING_IDS=/* CATALOG_BUILDING_IDS */"
        + json.dumps(building_ids, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        + ";",
        source,
        count=1,
    )
    args.module.write_text(source, encoding="utf-8")
    print(f"embedded {len(item_ids)} item and {len(building_ids)} building renames")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
