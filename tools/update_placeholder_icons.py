#!/usr/bin/env python3
"""Remove placeholder flags for rows that now have confirmed catalog images."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mapping", type=Path)
    parser.add_argument("icon_status", type=Path)
    args = parser.parse_args()
    mapping = json.loads(args.mapping.read_text(encoding="utf-8-sig"))
    confirmed_legacy_ids = {
        row.get("legacyId")
        for row in mapping.get("items", [])
        if row.get("decision") == "matched" and row.get("legacyId")
    }
    source = args.icon_status.read_text(encoding="utf-8")
    array_match = re.search(r"return \[\n\s*(.*?)\n\s*\];", source, re.DOTALL)
    if not array_match:
        raise ValueError("placeholder icon array not found")
    ids = re.findall(r"'([^']+)'", array_match.group(1))
    remaining = [item_id for item_id in ids if item_id not in confirmed_legacy_ids]
    replacement = "return [\n    " + ",".join(repr(item_id) for item_id in remaining) + "\n  ];"
    source = source[: array_match.start()] + replacement + source[array_match.end() :]
    args.icon_status.write_text(source, encoding="utf-8")
    print(
        json.dumps(
            {
                "previous": len(ids),
                "confirmedRemoved": len(ids) - len(remaining),
                "remaining": len(remaining),
                "remainingIds": remaining,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
