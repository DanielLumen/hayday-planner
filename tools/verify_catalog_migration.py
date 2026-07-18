#!/usr/bin/env python3
"""Verify that catalog migration changes IDs/images without changing user data semantics."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

import sys

sys.path.insert(0, str(ROOT))
import validate  # noqa: E402


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def remap_keys(value: dict, id_map: dict[str, str], label: str) -> dict:
    result = {}
    for source_id, record in value.items():
        target_id = id_map.get(source_id, source_id)
        if target_id in result:
            raise ValueError(f"{label} collision: {source_id} -> {target_id}")
        result[target_id] = record
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mapping", type=Path)
    parser.add_argument("backup", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--expected-data-sha256", required=True)
    args = parser.parse_args()

    if sha256(ROOT / "data.json") != args.expected_data_sha256:
        raise ValueError("data.json changed during catalog migration")
    mapping = json.loads(args.mapping.read_text(encoding="utf-8-sig"))
    backup = json.loads(args.backup.read_text(encoding="utf-8-sig"))
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    item_ids = {
        row["legacyId"]: row["canonicalId"]
        for row in mapping["items"]
        if row.get("decision") == "matched"
        and row.get("legacyId")
        and row["legacyId"] != row["canonicalId"]
    }
    building_ids = {
        row["legacyId"]: row["canonicalId"]
        for row in mapping["buildings"]
        if row.get("decision") == "matched"
        and row.get("legacyId")
        and row["legacyId"] != row["canonicalId"]
    }
    if len(item_ids) != 81 or len(building_ids) != 5:
        raise ValueError("rename map counts changed")

    old_html = subprocess.check_output(
        ["git", "show", "HEAD:index.html"], cwd=ROOT, text=True
    )
    old_base = validate.parse_items(old_html)
    old_effective, old_retained, old_duplicates = validate.apply_edits(
        old_base, backup["edits"]
    )
    if old_retained or old_duplicates:
        raise ValueError("pre-migration effective catalog is not clean")
    expected = [
        validate.migrate_item_record(item, item_ids, building_ids)
        for item in old_effective
    ]

    new_html = (ROOT / "index.html").read_text(encoding="utf-8-sig")
    new_base = validate.parse_items(new_html)
    new_effective, new_retained, new_duplicates = validate.apply_edits(
        new_base, validate.load_edits()
    )
    if new_retained or new_duplicates:
        raise ValueError("post-migration effective catalog is not clean")
    new_ids = {
        row["canonicalId"] for row in mapping["items"] if row.get("decision") == "new"
    }
    comparable_actual = [item for item in new_effective if item["id"] not in new_ids]
    expected.sort(key=lambda item: item["id"])
    comparable_actual.sort(key=lambda item: item["id"])
    if expected != comparable_actual:
        for expected_item, actual_item in zip(expected, comparable_actual):
            if expected_item != actual_item:
                raise ValueError(
                    "effective item changed beyond ID references: "
                    + json.dumps(
                        {"expected": expected_item, "actual": actual_item},
                        ensure_ascii=False,
                    )
                )
        raise ValueError("effective catalog item counts differ")

    migrated_stock = remap_keys(backup["items"], item_ids, "stock")
    if len(migrated_stock) != len(backup["items"]):
        raise ValueError("stock records were lost")
    migrated_images = remap_keys(backup.get("itemImages", {}), item_ids, "image")
    if set(migrated_images) != {"peanuts"}:
        raise ValueError("user image key was not preserved as peanuts")
    if migrated_images["peanuts"] != backup["itemImages"]["peanut"]:
        raise ValueError("user image content changed")

    icon_errors = []
    for record in manifest["images"]:
        icon_path = ROOT / "icons" / record["file"]
        if not icon_path.exists() or sha256(icon_path) != record["sha256"]:
            icon_errors.append(record["id"])
    if icon_errors:
        raise ValueError(f"installed icon mismatches: {icon_errors[:5]}")

    report = {
        "status": "PASS",
        "dataJsonSha256": sha256(ROOT / "data.json"),
        "preservedEffectiveItems": len(expected),
        "newItems": len(new_ids),
        "effectiveItemsAfter": len(new_effective),
        "stockRecordsPreserved": len(migrated_stock),
        "userImagesPreserved": len(migrated_images),
        "installedImagesVerified": len(manifest["images"]),
        "renamedItemIds": len(item_ids),
        "renamedBuildingIds": len(building_ids),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
