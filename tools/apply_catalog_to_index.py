#!/usr/bin/env python3
"""Apply an audited catalog mapping atomically to the built-in HTML catalog."""

from __future__ import annotations

import argparse
import hashlib
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


def replace_quoted_ids(source: str, replacements: dict[str, str]) -> tuple[str, int]:
    alternatives = "|".join(
        re.escape(value) for value in sorted(replacements, key=len, reverse=True)
    )
    pattern = re.compile(r"(?P<quote>['\"])(?P<id>" + alternatives + r")(?P=quote)")
    count = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal count
        count += 1
        return f"{match.group('quote')}{replacements[match.group('id')]}{match.group('quote')}"

    return pattern.sub(replace, source), count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mapping", type=Path)
    parser.add_argument("index", type=Path)
    parser.add_argument("--expected-sha256", required=True)
    args = parser.parse_args()

    raw = args.index.read_bytes()
    actual_hash = hashlib.sha256(raw).hexdigest()
    if actual_hash != args.expected_sha256:
        raise ValueError(f"index baseline changed: expected {args.expected_sha256}, got {actual_hash}")
    mapping = json.loads(args.mapping.read_text(encoding="utf-8-sig"))
    item_rows = mapping.get("items", [])
    building_rows = mapping.get("buildings", [])
    item_ids = rename_map(item_rows)
    building_ids = rename_map(building_rows)
    if len(item_ids) != 81 or len(building_ids) != 5:
        raise ValueError("unexpected audited rename counts")

    source = raw.decode("utf-8")
    source, quoted_replacements = replace_quoted_ids(
        source, {**item_ids, **building_ids}
    )
    source = source.replace(
        "|tnt|",
        "|tnt_barrel|",
    )

    building_anchor = '{id:"honey_extractor",nameCN:"摇蜜机",slots:1}\n]'
    new_buildings = [
        row for row in building_rows if row.get("decision") == "new"
    ]
    if len(new_buildings) != 3 or building_anchor not in source:
        raise ValueError("new building insertion anchor or rows are invalid")
    building_lines = [
        f'{{id:{json.dumps(row["canonicalId"])},nameCN:{json.dumps(row["nameCN"], ensure_ascii=False)}}}'
        for row in new_buildings
    ]
    source = source.replace(
        building_anchor,
        '{id:"honey_extractor",nameCN:"摇蜜机",slots:1},\n'
        + ",\n".join(building_lines)
        + "\n]",
        1,
    )

    item_anchor = (
        '{id:"guava_compote",nameCN:"番石榴果酱",emoji:"🫙",'
        'bld:"preservation_station",ing:[{i:"guava",q:3},{i:"white_sugar",q:1}],'
        't:6240,tg:3,st:"barn"},\n]'
    )
    new_items = [row for row in item_rows if row.get("decision") == "new"]
    if len(new_items) != 3 or item_anchor not in source:
        raise ValueError("new item insertion anchor or rows are invalid")
    item_lines = [
        (
            f'{{id:{json.dumps(row["canonicalId"])},'
            f'nameCN:{json.dumps(row["nameCN"], ensure_ascii=False)},'
            'emoji:"🪤",bld:"net_maker",ing:[],t:0,tg:5,st:"barn"},'
        )
        for row in new_items
    ]
    source = source.replace(
        item_anchor,
        item_anchor[:-2] + "\n" + "\n".join(item_lines) + "\n]",
        1,
    )

    source, virtual_lobster_count = re.subn(
        r"\n\s*\{id:'__lobster_trap',[^\n]+\},",
        "",
        source,
        count=1,
    )
    source, virtual_duck_count = re.subn(
        r"\n\s*\{id:'__duck_trap',[^\n]+\},",
        "",
        source,
        count=1,
    )
    if virtual_lobster_count != 1 or virtual_duck_count != 1:
        raise ValueError("virtual trap rows were not removed exactly once")

    icon_match = re.search(r"var ICONS=(\{.*?\});\nICONS\.hand_pies=", source, re.DOTALL)
    if not icon_match:
        raise ValueError("ICONS object not found")
    icons = json.loads(icon_match.group(1))
    confirmed_rows = [
        row
        for row in item_rows + building_rows
        if row.get("decision") in {"matched", "new"}
    ]
    for row in confirmed_rows:
        icons[row["canonicalId"]] = f'icons/{row["canonicalId"]}.png'
    icon_json = json.dumps(icons, ensure_ascii=False, separators=(",", ":"))
    source = source[: icon_match.start(1)] + icon_json + source[icon_match.end(1) :]

    args.index.write_text(source, encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "PASS",
                "quotedIdOccurrencesReplaced": quoted_replacements,
                "itemRenames": len(item_ids),
                "buildingRenames": len(building_ids),
                "newItems": len(new_items),
                "newBuildings": len(new_buildings),
                "confirmedIconPaths": len(confirmed_rows),
                "sha256": hashlib.sha256(source.encode()).hexdigest(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
