#!/usr/bin/env python3
"""Validate the isolated catalog-mapping workbench and its generated data."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REFERENCE_PATH = ROOT / "catalog-reference.json"
LOCAL_PATH = ROOT / "catalog-local-base.json"
HTML_PATH = ROOT / "catalog-mapping.html"
SCRIPT_PATH = ROOT / "catalog-mapping.js"
BROWSER_DATA_PATH = ROOT / "catalog-mapping-data.js"

REFERENCE_FIELDS = {
    "kind",
    "canonicalId",
    "nameEN",
    "imageUrl",
    "sourceLabel",
    "sourceUrl",
}
LOCAL_ITEM_FIELDS = {"legacyId", "nameCN", "buildingId", "kind"}
LOCAL_BUILDING_FIELDS = {"legacyId", "nameCN", "kind"}
IGNORED_FIELDS = {"level", "price", "time", "xp", "ingredients", "quantities"}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def unique_ids(rows: list[dict], key: str, label: str) -> None:
    values = [row.get(key) for row in rows]
    require(all(values), f"{label} contains an empty {key}")
    require(len(values) == len(set(values)), f"{label} contains duplicate {key} values")


def main() -> None:
    reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))
    local = json.loads(LOCAL_PATH.read_text(encoding="utf-8"))
    html = HTML_PATH.read_text(encoding="utf-8")
    script = SCRIPT_PATH.read_text(encoding="utf-8")
    browser_data = BROWSER_DATA_PATH.read_text(encoding="utf-8")

    require(reference.get("version") == 1, "unexpected reference data version")
    require(local.get("version") == 1, "unexpected local catalog version")
    require(
        set(reference.get("policy", {}).get("ignoredFields", [])) == IGNORED_FIELDS,
        "reference data protection policy changed",
    )

    reference_rows = reference.get("items", []) + reference.get("buildings", [])
    require(reference.get("items"), "reference item list is empty")
    require(reference.get("buildings"), "reference building list is empty")
    for row in reference_rows:
        require(set(row) == REFERENCE_FIELDS, f"reference row has unsafe or missing fields: {row.get('canonicalId')}")
        require(row["sourceUrl"].startswith("https://haydaycalculator.shootingspeed.com/"), "unexpected source URL")
        require(row["imageUrl"].startswith("https://"), "reference image must use HTTPS")
    unique_ids(reference_rows, "canonicalId", "reference catalog")

    require(local.get("items"), "local item list is empty")
    require(local.get("buildings"), "local building list is empty")
    for row in local["items"]:
        require(set(row) == LOCAL_ITEM_FIELDS, f"local item has unexpected fields: {row.get('legacyId')}")
        require(row.get("kind") == "item", "local item kind mismatch")
    for row in local["buildings"]:
        require(set(row) == LOCAL_BUILDING_FIELDS, f"local building has unexpected fields: {row.get('legacyId')}")
        require(row.get("kind") == "building", "local building kind mismatch")
    unique_ids(local["items"], "legacyId", "local items")
    unique_ids(local["buildings"], "legacyId", "local buildings")

    require('href="./catalog-mapping.css"' in html, "mapping stylesheet is not linked")
    require('src="./catalog-mapping-data.js"' in html, "browser-readable catalog data is not linked")
    require('src="./catalog-mapping.js"' in html, "mapping script is not linked")
    require(
        html.index('src="./catalog-mapping-data.js"') < html.index('src="./catalog-mapping.js"'),
        "browser-readable data must load before the workbench script",
    )
    require("catalog-reference.json" in script, "reference catalog is not loaded")
    require("catalog-local-base.json" in script, "local base catalog is not loaded")
    require("window.HAYDAY_CATALOG_MAPPING_DATA" in script, "direct-file catalog fallback is missing")
    require(
        browser_data.startswith("window.HAYDAY_CATALOG_MAPPING_DATA = "),
        "browser-readable catalog data has an unexpected format",
    )
    browser_payload = json.loads(browser_data.split(" = ", 1)[1].removesuffix(";\n"))
    require(browser_payload["reference"] == reference, "browser reference data differs from JSON")
    require(browser_payload["local"] == local, "browser local data differs from JSON")
    require("hayday_catalog_mapping_draft_v1" in script, "isolated draft storage key is missing")
    require(
        re.search(r"localStorage\.setItem\(\s*STORAGE_KEY", script) is not None,
        "draft is not written through the isolated key",
    )
    html_ids = set(re.findall(r'\bid="([^"]+)"', html))
    referenced_ids = set(re.findall(r'byId\("([^"]+)"\)', script))
    require(not referenced_ids - html_ids, f"script references missing HTML IDs: {sorted(referenced_ids - html_ids)}")
    for decision in ("matched", "new", "unrelated", "unsure"):
        require(f'"{decision}"' in script, f"mapping decision is missing: {decision}")
    require("migrationPlan" in script, "exported ID and image migration plan is missing")
    require("preserveCustomImage: true" in script, "user-uploaded image protection is missing")
    require("hd_inv" not in script, "mapping workbench must not access inventory storage")
    require("hd_targets" not in script, "mapping workbench must not access target storage")
    require("itemImages" not in script, "mapping workbench must not import or overwrite user images")

    print(
        json.dumps(
            {
                "status": "PASS",
                "referenceItems": len(reference["items"]),
                "referenceBuildings": len(reference["buildings"]),
                "localItems": len(local["items"]),
                "localBuildings": len(local["buildings"]),
                "protectedFieldsIgnored": sorted(IGNORED_FIELDS),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
