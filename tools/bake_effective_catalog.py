#!/usr/bin/env python3
"""Bake the latest user-corrected effective records into the built-in catalog baseline."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(ROOT))
import validate  # noqa: E402


ITEM_LITERAL_RE = re.compile(
    r'\{id:"(?P<id>[^"]+)",nameCN:"(?P<name>[^"]+)",emoji:"(?P<emoji>[^"]*)",'
    r'(?:(?:bld:"(?P<bld>[^"]+)",))?ing:\[(?P<ingredients>.*?)\],'
    r't:(?P<time>\d+),tg:(?P<target>\d+),st:"(?P<storage>[^"]+)"\}'
)


def quote(value: str) -> str:
    return json.dumps(str(value), ensure_ascii=False)


def render_item(item: dict, emoji: str) -> str:
    prefix = (
        f'{{id:{quote(item["id"])},nameCN:{quote(item["nameCN"])},'
        f'emoji:{quote(emoji)},'
    )
    building = f'bld:{quote(item["bld"])},' if item.get("bld") else ""
    ingredients = ",".join(
        f'{{i:{quote(ingredient["i"])},q:{int(ingredient["q"])}}}'
        for ingredient in item.get("ing", [])
    )
    return (
        prefix
        + building
        + f'ing:[{ingredients}],t:{int(item["t"])},tg:{int(item["tg"])},'
        + f'st:{quote(item["st"])}}}'
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("backup", type=Path)
    parser.add_argument("index", type=Path)
    args = parser.parse_args()
    backup = json.loads(args.backup.read_text(encoding="utf-8-sig"))
    source = args.index.read_text(encoding="utf-8")
    base_items = validate.parse_items(source)
    item_ids, building_ids = validate.catalog_id_maps()
    edits = validate.migrate_edits(backup.get("edits", {}), item_ids, building_ids)
    effective, retained, duplicate_ingredients = validate.apply_edits(base_items, edits)
    if retained or duplicate_ingredients:
        raise ValueError("effective catalog contains retained deletions or duplicate ingredients")
    effective_by_id = {item["id"]: item for item in effective}
    replaced = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal replaced
        item = effective_by_id.get(match.group("id"))
        if not item:
            return match.group(0)
        replaced += 1
        return render_item(item, match.group("emoji"))

    result = ITEM_LITERAL_RE.sub(replace, source)
    if replaced != len(effective):
        raise ValueError(f"expected to bake {len(effective)} effective items, baked {replaced}")
    args.index.write_text(result, encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "PASS",
                "baseItems": len(base_items),
                "bakedEffectiveItems": replaced,
                "retainedUnmodifiedDeletedBaseItems": len(base_items) - replaced,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
