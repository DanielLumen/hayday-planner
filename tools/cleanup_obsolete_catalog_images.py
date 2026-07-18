#!/usr/bin/env python3
"""Delete only superseded legacy-ID images that no current catalog entry uses."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(ROOT))
import validate  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mapping", type=Path)
    parser.add_argument("index", type=Path)
    parser.add_argument("icons", type=Path)
    args = parser.parse_args()
    mapping = json.loads(args.mapping.read_text(encoding="utf-8-sig"))
    html = args.index.read_text(encoding="utf-8")
    current_ids = {item["id"] for item in validate.parse_items(html)}
    current_ids.update(validate.parse_buildings(html))
    renamed_sources = {
        row["legacyId"]
        for row in mapping.get("items", []) + mapping.get("buildings", [])
        if row.get("decision") == "matched"
        and row.get("legacyId")
        and row.get("legacyId") != row.get("canonicalId")
    }
    obsolete = sorted(renamed_sources - current_ids)
    still_current = sorted(renamed_sources & current_ids)
    deleted = []
    already_absent = []
    for image_id in obsolete:
        path = args.icons / f"{image_id}.png"
        if path.exists():
            path.unlink()
            deleted.append(image_id)
        else:
            already_absent.append(image_id)
    print(
        json.dumps(
            {
                "status": "PASS",
                "deletedObsoleteImages": len(deleted),
                "alreadyAbsentObsoleteImages": len(already_absent),
                "retainedChainTargetImages": still_current,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
