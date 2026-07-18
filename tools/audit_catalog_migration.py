#!/usr/bin/env python3
"""Read-only audit for a catalog ID/image mapping and a Hay Day backup."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import validate as project_data  # noqa: E402


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain an object")
    return value


def rows_by_decision(rows: list[dict], decision: str) -> list[dict]:
    return [row for row in rows if row.get("decision") == decision]


def duplicate_values(values: list[str]) -> list[str]:
    return sorted(value for value, count in Counter(values).items() if value and count > 1)


def semantic_hash(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def cycle_groups(rename_map: dict[str, str]) -> list[list[str]]:
    cycles = []
    completed = set()
    for start in rename_map:
        if start in completed:
            continue
        path = []
        positions = {}
        current = start
        while current in rename_map and current not in completed:
            if current in positions:
                cycles.append(path[positions[current] :])
                break
            positions[current] = len(path)
            path.append(current)
            current = rename_map[current]
        completed.update(path)
    return cycles


def final_id_duplicates(current_ids: set[str], rename_map: dict[str, str], new_ids: list[str]) -> list[str]:
    final_ids = [rename_map.get(item_id, item_id) for item_id in current_ids] + new_ids
    return duplicate_values(final_ids)


def project_catalog_before_migration(
    items: list[dict],
    buildings: dict[str, dict],
    item_rename: dict[str, str],
    building_rename: dict[str, str],
    new_item_ids: set[str],
    new_building_ids: set[str],
) -> tuple[list[dict], dict[str, dict]]:
    """Reconstruct the legacy-ID catalog from the already migrated built-in catalog."""
    item_inverse = {target: source for source, target in item_rename.items()}
    building_inverse = {target: source for source, target in building_rename.items()}
    legacy_items = []
    for source in items:
        if source["id"] in new_item_ids:
            continue
        item = copy.deepcopy(source)
        item["id"] = item_inverse.get(item["id"], item["id"])
        if item.get("bld"):
            item["bld"] = building_inverse.get(item["bld"], item["bld"])
        for ingredient in item.get("ing", []):
            ingredient["i"] = item_inverse.get(ingredient["i"], ingredient["i"])
        legacy_items.append(item)
    legacy_buildings = {
        building_inverse.get(building_id, building_id): copy.deepcopy(building)
        for building_id, building in buildings.items()
        if building_id not in new_building_ids
    }
    return legacy_items, legacy_buildings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mapping", type=Path)
    parser.add_argument("backup", type=Path)
    args = parser.parse_args()

    mapping = load_json(args.mapping)
    backup = load_json(args.backup)
    if mapping.get("version") != 2 or mapping.get("type") != "hayday-catalog-id-image-mapping":
        raise ValueError("unexpected mapping format")
    if backup.get("version") != 3 or not isinstance(backup.get("items"), dict):
        raise ValueError("unexpected backup format")

    item_rows = mapping.get("items", [])
    building_rows = mapping.get("buildings", [])
    if not isinstance(item_rows, list) or not isinstance(building_rows, list):
        raise ValueError("mapping rows must be arrays")

    matched_items = rows_by_decision(item_rows, "matched")
    matched_buildings = rows_by_decision(building_rows, "matched")
    new_items = rows_by_decision(item_rows, "new")
    new_buildings = rows_by_decision(building_rows, "new")
    item_rename = {
        row["legacyId"]: row["canonicalId"]
        for row in matched_items
        if row.get("legacyId") and row.get("canonicalId") and row["legacyId"] != row["canonicalId"]
    }
    building_rename = {
        row["legacyId"]: row["canonicalId"]
        for row in matched_buildings
        if row.get("legacyId") and row.get("canonicalId") and row["legacyId"] != row["canonicalId"]
    }
    base_html = (ROOT / "index.html").read_text(encoding="utf-8-sig")
    base_items, base_buildings = project_catalog_before_migration(
        project_data.parse_items(base_html),
        project_data.parse_buildings(base_html),
        item_rename,
        building_rename,
        {row["canonicalId"] for row in new_items},
        {row["canonicalId"] for row in new_buildings},
    )
    edits = backup.get("edits") if isinstance(backup.get("edits"), dict) else {}
    current_items, retained, duplicate_ingredients = project_data.apply_edits(base_items, edits)
    current_item_by_id = {item["id"]: item for item in current_items}
    current_item_ids = set(current_item_by_id)
    current_building_ids = set(base_buildings)
    backup_item_ids = set(backup["items"])

    missing_item_legacy = sorted(
        row["legacyId"] for row in matched_items if row.get("legacyId") not in current_item_ids
    )
    missing_building_legacy = sorted(
        row["legacyId"] for row in matched_buildings if row.get("legacyId") not in current_building_ids
    )
    mapped_item_ids = {row.get("legacyId") for row in matched_items}
    mapped_building_ids = {row.get("legacyId") for row in matched_buildings}
    unmatched_items = [
        {"legacyId": item["id"], "nameCN": item.get("nameCN", "")}
        for item in current_items
        if item["id"] not in mapped_item_ids
    ]
    unmatched_buildings = [
        {"legacyId": building_id, "nameCN": base_buildings[building_id]["nameCN"]}
        for building_id in sorted(current_building_ids - mapped_building_ids)
    ]

    name_mismatches = []
    for row in matched_items:
        item = current_item_by_id.get(row.get("legacyId"))
        if item and row.get("nameCN") != item.get("nameCN"):
            name_mismatches.append(
                {
                    "legacyId": row["legacyId"],
                    "mappingNameCN": row.get("nameCN", ""),
                    "backupNameCN": item.get("nameCN", ""),
                }
            )

    recipe_impacts = []
    ingredient_edges_changed = 0
    building_refs_changed = 0
    for item in current_items:
        ingredient_changes = [
            {"from": ingredient["i"], "to": item_rename[ingredient["i"]]}
            for ingredient in item.get("ing", [])
            if ingredient["i"] in item_rename
        ]
        building_change = (
            {"from": item.get("bld", ""), "to": building_rename[item["bld"]]}
            if item.get("bld") in building_rename
            else None
        )
        if ingredient_changes or building_change or item["id"] in item_rename:
            recipe_impacts.append(
                {
                    "legacyId": item["id"],
                    "canonicalId": item_rename.get(item["id"], item["id"]),
                    "ingredientChanges": ingredient_changes,
                    "buildingChange": building_change,
                }
            )
        ingredient_edges_changed += len(ingredient_changes)
        building_refs_changed += int(building_change is not None)

    item_orders = backup.get("itemOrders") if isinstance(backup.get("itemOrders"), dict) else {}
    item_order_item_refs = sum(
        1
        for values in item_orders.values()
        if isinstance(values, list)
        for item_id in values
        if item_id in item_rename
    )
    item_order_building_keys = sum(1 for building_id in item_orders if building_id in building_rename)
    filter_order = backup.get("filterOrder") if isinstance(backup.get("filterOrder"), list) else []
    filter_building_refs = sum(
        1
        for entry in filter_order
        if isinstance(entry, dict) and entry.get("bld") in building_rename
    )
    order = backup.get("order") if isinstance(backup.get("order"), list) else []
    order_building_refs = sum(1 for value in order if value in building_rename)

    protected_snapshot = [
        {
            "id": item["id"],
            "t": item.get("t"),
            "tg": item.get("tg"),
            "st": item.get("st"),
            "bld": item.get("bld"),
            "ing": item.get("ing", []),
            "stock": backup["items"].get(item["id"]),
        }
        for item in current_items
    ]
    user_image_keys = sorted((backup.get("itemImages") or {}).keys())

    all_rows = item_rows + building_rows
    explicit_conflicts = [row for row in all_rows if row.get("status") == "conflict"]
    pending_rows = [
        row for row in all_rows if row.get("decision") not in {"matched", "new", "unrelated", "unsure"}
    ]
    final_item_duplicates = final_id_duplicates(
        current_item_ids,
        item_rename,
        [row["canonicalId"] for row in new_items],
    )
    final_building_duplicates = final_id_duplicates(
        current_building_ids,
        building_rename,
        [row["canonicalId"] for row in new_buildings],
    )

    blocking = {
        "mappingConflicts": len(explicit_conflicts),
        "pendingRows": len(pending_rows),
        "missingItemLegacyIds": missing_item_legacy,
        "missingBuildingLegacyIds": missing_building_legacy,
        "duplicateMappedItemLegacyIds": duplicate_values([row.get("legacyId", "") for row in matched_items]),
        "duplicateMappedBuildingLegacyIds": duplicate_values([row.get("legacyId", "") for row in matched_buildings]),
        "duplicateItemCanonicalIds": duplicate_values([row.get("canonicalId", "") for row in item_rows]),
        "duplicateBuildingCanonicalIds": duplicate_values([row.get("canonicalId", "") for row in building_rows]),
        "finalItemIdCollisions": final_item_duplicates,
        "finalBuildingIdCollisions": final_building_duplicates,
        "backupCatalogMismatch": sorted(current_item_ids ^ backup_item_ids),
        "retainedDeletedDependencies": retained,
        "duplicateIngredients": duplicate_ingredients,
    }
    blocker_count = sum(
        value if isinstance(value, int) else len(value)
        for value in blocking.values()
    )

    report = {
        "status": "PASS" if blocker_count == 0 else "BLOCKED",
        "mappingFile": str(args.mapping),
        "backupFile": str(args.backup),
        "mappingImportedBackupName": mapping.get("importedBackupName", ""),
        "counts": {
            "referenceItems": len(item_rows),
            "referenceBuildings": len(building_rows),
            "matchedItems": len(matched_items),
            "matchedBuildings": len(matched_buildings),
            "newItems": len(new_items),
            "newBuildings": len(new_buildings),
            "currentItems": len(current_items),
            "currentBuildings": len(current_building_ids),
            "renamedItemIds": len(item_rename),
            "unchangedItemIds": len(matched_items) - len(item_rename),
            "renamedBuildingIds": len(building_rename),
            "unchangedBuildingIds": len(matched_buildings) - len(building_rename),
            "unmatchedItems": len(unmatched_items),
            "unmatchedBuildings": len(unmatched_buildings),
            "nameMismatchesAgainstLatestBackup": len(name_mismatches),
        },
        "newCatalogRows": {
            "items": [
                {"canonicalId": row["canonicalId"], "nameCN": row.get("nameCN", ""), "nameEN": row.get("nameEN", "")}
                for row in new_items
            ],
            "buildings": [
                {"canonicalId": row["canonicalId"], "nameCN": row.get("nameCN", ""), "nameEN": row.get("nameEN", "")}
                for row in new_buildings
            ],
        },
        "unmatchedLocalRows": {
            "items": sorted(unmatched_items, key=lambda row: row["legacyId"]),
            "buildings": unmatched_buildings,
        },
        "nameMismatchesAgainstLatestBackup": name_mismatches,
        "migrationImpact": {
            "recipeRecordsTouched": len(recipe_impacts),
            "ingredientReferencesRenamed": ingredient_edges_changed,
            "itemBuildingReferencesRenamed": building_refs_changed,
            "backupStockKeysRenamed": sum(1 for item_id in backup["items"] if item_id in item_rename),
            "modifiedEditKeysRenamed": sum(1 for item_id in (edits.get("mod") or {}) if item_id in item_rename),
            "deletedEditIdsRenamed": sum(1 for item_id in (edits.get("del") or []) if item_id in item_rename),
            "checkedKeysRenamed": sum(1 for item_id in (backup.get("checked") or {}) if item_id in item_rename),
            "itemOrderItemReferencesRenamed": item_order_item_refs,
            "itemOrderBuildingKeysRenamed": item_order_building_keys,
            "filterOrderBuildingReferencesRenamed": filter_building_refs,
            "displayOrderBuildingReferencesRenamed": order_building_refs,
            "userImageKeys": user_image_keys,
            "userImageKeysRenamed": [
                {"from": item_id, "to": item_rename[item_id]}
                for item_id in user_image_keys
                if item_id in item_rename
            ],
            "renameCycles": cycle_groups({**item_rename, **building_rename}),
            "protectedSnapshotSha256": semantic_hash(protected_snapshot),
        },
        "blockingChecks": blocking,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if blocker_count == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
