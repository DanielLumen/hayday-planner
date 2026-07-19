import argparse
import copy
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HTML = ROOT / "index.html"
DATA = ROOT / "data.json"
WIKI = ROOT / "wiki_products.json"
ICONS = ROOT / "icons"
CATALOG_MIGRATION = ROOT / "catalog-migration.js"

ITEM_RE = re.compile(
    r'\{id:"([^"]+)",nameCN:"([^"]+)",emoji:"[^"]*",'
    r'(?:bld:"([^"]+)",)?ing:\[(.*?)\],t:(\d+),tg:(\d+),st:"([^"]+)"\}'
)
ING_RE = re.compile(r'i:"([^"]+)",q:(\d+)')
BUILDING_RE = re.compile(
    r'\{id:"([^"]+)",nameCN:"([^"]+)"'
    r'(?:,emoji:"[^"]*")?(?:,slots:(\d+))?\}'
)


def array_source(source, marker):
    marker_at = source.find(marker)
    if marker_at < 0:
        raise ValueError(f"Cannot find {marker}")
    start = source.find("[", marker_at + len(marker))
    depth = 0
    quote = None
    escaped = False
    for index in range(start, len(source)):
        char = source[index]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in "\"'":
            quote = char
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return source[start + 1 : index]
    raise ValueError(f"Unclosed array after {marker}")


def parse_items(html):
    items = []
    for match in ITEM_RE.finditer(array_source(html, "\nitems:")):
        ingredients = [
            {"i": ing.group(1), "q": int(ing.group(2))}
            for ing in ING_RE.finditer(match.group(4))
        ]
        items.append(
            {
                "id": match.group(1),
                "nameCN": match.group(2),
                "bld": match.group(3) or "",
                "ing": ingredients,
                "t": int(match.group(5)),
                "tg": int(match.group(6)),
                "st": match.group(7),
            }
        )
    return items


def parse_buildings(html):
    buildings = {}
    for match in BUILDING_RE.finditer(array_source(html, "\nbuildings:")):
        buildings[match.group(1)] = {
            "nameCN": match.group(2),
            "slots": int(match.group(3) or 0),
        }
    return buildings


def catalog_id_maps():
    source = CATALOG_MIGRATION.read_text(encoding="utf-8")
    item_match = re.search(r"var ITEM_IDS=/\* CATALOG_ITEM_IDS \*/(\{.*?\});", source)
    building_match = re.search(r"var BUILDING_IDS=/\* CATALOG_BUILDING_IDS \*/(\{.*?\});", source)
    if not item_match or not building_match:
        raise ValueError("Cannot parse catalog ID migration maps")
    return json.loads(item_match.group(1)), json.loads(building_match.group(1))


def migrate_item_record(item, item_ids, building_ids):
    if not isinstance(item, dict):
        return copy.deepcopy(item)
    result = copy.deepcopy(item)
    if isinstance(result.get("id"), str):
        result["id"] = item_ids.get(result["id"], result["id"])
    if isinstance(result.get("bld"), str):
        result["bld"] = building_ids.get(result["bld"], result["bld"])
    if isinstance(result.get("ing"), list):
        for ingredient in result["ing"]:
            if isinstance(ingredient, dict) and isinstance(ingredient.get("i"), str):
                ingredient["i"] = item_ids.get(ingredient["i"], ingredient["i"])
    return result


def migrate_edits(edits, item_ids, building_ids):
    if not isinstance(edits, dict):
        return edits
    result = copy.deepcopy(edits)
    modified = {}
    for source_id, changes in result.get("mod", {}).items():
        target_id = item_ids.get(source_id, source_id)
        if target_id in modified:
            raise ValueError(f"Edit ID migration collision: {source_id} -> {target_id}")
        migrated = migrate_item_record(changes, item_ids, building_ids)
        if isinstance(migrated, dict):
            migrated.pop("id", None)
        modified[target_id] = migrated
    result["mod"] = modified
    result["add"] = [
        migrate_item_record(item, item_ids, building_ids)
        for item in result.get("add", [])
    ]
    result["del"] = list(
        dict.fromkeys(item_ids.get(item_id, item_id) for item_id in result.get("del", []))
    )
    return result


def load_edits():
    if not DATA.exists():
        return {}
    saved = json.loads(DATA.read_text(encoding="utf-8-sig"))
    raw = saved.get("hd_edits", "{}")
    edits = json.loads(raw) if isinstance(raw, str) else raw
    if str(saved.get("hd_catalog_id_version", "")) != "2":
        item_ids, building_ids = catalog_id_maps()
        edits = migrate_edits(edits, item_ids, building_ids)
    return edits if isinstance(edits, dict) else {}


def normalize_ingredients(ingredients):
    totals = {}
    for ingredient in ingredients if isinstance(ingredients, list) else []:
        item_id = ingredient.get("i") if isinstance(ingredient, dict) else None
        if item_id:
            totals[item_id] = totals.get(item_id, 0) + max(1, int(ingredient.get("q", 1)))
    return [{"i": item_id, "q": quantity} for item_id, quantity in totals.items()]


def apply_edits(base_items, edits):
    items = copy.deepcopy(base_items)
    modified = edits.get("mod", {}) if isinstance(edits.get("mod"), dict) else {}
    added = edits.get("add", []) if isinstance(edits.get("add"), list) else []
    deleted = set(edits.get("del", []) if isinstance(edits.get("del"), list) else [])

    for item in items:
        if isinstance(modified.get(item["id"]), dict):
            item.update(copy.deepcopy(modified[item["id"]]))

    known_ids = {item["id"] for item in items}
    for item in added:
        if isinstance(item, dict) and item.get("id") and item["id"] not in known_ids:
            items.append(copy.deepcopy(item))
            known_ids.add(item["id"])

    duplicate_ingredients = []
    for item in items:
        ingredient_ids = [ing.get("i") for ing in item.get("ing", []) if isinstance(ing, dict)]
        if len(ingredient_ids) != len(set(ingredient_ids)):
            duplicate_ingredients.append(item["id"])
        item["ing"] = normalize_ingredients(item.get("ing", []))

    referenced = {ing["i"] for item in items for ing in item["ing"]}
    retained = sorted(item["id"] for item in items if item["id"] in deleted and item["id"] in referenced)
    items = [item for item in items if item["id"] not in deleted or item["id"] in referenced]
    return items, retained, duplicate_ingredients


def integrity_errors(items, buildings):
    errors = []
    id_counts = Counter(item.get("id") for item in items)
    errors.extend(f"duplicate item id: {item_id}" for item_id, count in id_counts.items() if count > 1)

    item_ids = set(id_counts)
    for item in items:
        if not item.get("nameCN"):
            errors.append(f'{item.get("id")}: empty Chinese name')
        if item.get("bld") and item["bld"] not in buildings:
            errors.append(f'{item["id"]}: unknown building {item["bld"]}')
        if int(item.get("t", -1)) < 0:
            errors.append(f'{item["id"]}: negative production time')
        if int(item.get("tg", 0)) < 1:
            errors.append(f'{item["id"]}: target must be positive')
        for ingredient in item.get("ing", []):
            if ingredient["i"] not in item_ids:
                errors.append(f'{item["id"]}: unknown ingredient {ingredient["i"]}')
            if int(ingredient["q"]) < 1:
                errors.append(f'{item["id"]}: invalid quantity for {ingredient["i"]}')

    graph = {item["id"]: [ing["i"] for ing in item.get("ing", [])] for item in items}
    state = {}

    def visit(item_id, path):
        if state.get(item_id) == 1:
            cycle_at = path.index(item_id) if item_id in path else 0
            errors.append("ingredient cycle: " + " -> ".join(path[cycle_at:] + [item_id]))
            return
        if state.get(item_id) == 2:
            return
        state[item_id] = 1
        for ingredient_id in graph.get(item_id, []):
            visit(ingredient_id, path + [item_id])
        state[item_id] = 2

    for item_id in graph:
        if not state.get(item_id):
            visit(item_id, [])
    return list(dict.fromkeys(errors))


def slug_id(value):
    return re.sub(r"[^a-z0-9]+", "_", str(value).lower()).strip("_")


def wiki_times():
    if not WIKI.exists():
        return {}
    wiki = json.loads(WIKI.read_text(encoding="utf-8-sig"))
    result = {}
    for category in wiki.values():
        products = category.get("products", []) if isinstance(category, dict) else category
        for product in products if isinstance(products, list) else []:
            if not isinstance(product, dict):
                continue
            item_id = product.get("id") or slug_id(product.get("level") or product.get("name") or "")
            raw_time = str(product.get("time", "")).strip()
            if item_id and raw_time.isdigit():
                result[item_id] = int(raw_time) * 60
    return result


def fmt_time(seconds):
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}h{minutes}m" if minutes else f"{hours}h"
    return f"{minutes}m{secs}s" if secs else f"{minutes}m"


def main():
    parser = argparse.ArgumentParser(description="Validate Hay Day planner data")
    parser.add_argument("--verbose", action="store_true", help="list warnings and wiki differences")
    args = parser.parse_args()

    try:
        html = HTML.read_text(encoding="utf-8-sig")
        base_items = parse_items(html)
        buildings = parse_buildings(html)
        if not base_items or not buildings:
            raise ValueError("Parsed data is unexpectedly empty")
        base_item_emojis = re.findall(r'emoji:"([^"]*)"', array_source(html, "\nitems:"))
        if len(base_item_emojis) != len(base_items) or any(emoji != "📦" for emoji in base_item_emojis):
            raise ValueError("Every built-in item must use the unified 📦 fallback icon")
        edits = load_edits()
        items, retained, duplicate_ingredients = apply_edits(base_items, edits)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}")
        return 1

    errors = integrity_errors(items, buildings)
    missing_icons = [item["id"] for item in items if not (ICONS / f'{item["id"]}.png').exists()]
    zero_times = [item["id"] for item in items if int(item.get("t", 0)) == 0]
    reference = wiki_times()
    mismatches = [
        (item, reference[item["id"]])
        for item in items
        if reference.get(item["id"], 0) and int(item.get("t", 0)) != reference[item["id"]]
    ]

    print(f"Base data: {len(base_items)} items, {len(buildings)} buildings")
    print(
        f"Effective data: {len(items)} items "
        f"({len(edits.get('mod', {}))} modified, {len(edits.get('add', []))} added, "
        f"{len(edits.get('del', []))} deletion requests)"
    )
    print(f"Integrity: {'PASS' if not errors else f'FAIL ({len(errors)} errors)'}")
    print(
        f"Reference reminder: {len(mismatches)} time differences "
        "(manual overrides kept)"
    )
    print(
        "Warnings: "
        f"{len(zero_times)} zero-time items, {len(missing_icons)} missing icons, "
        f"{len(duplicate_ingredients)} normalized duplicate recipes, {len(retained)} retained dependencies"
    )

    for error in errors:
        print(f"  ERROR {error}")
    if args.verbose:
        for item, wiki_time in mismatches:
            print(f'  REF {item["nameCN"]} ({item["id"]}): app={fmt_time(int(item["t"]))}, reference={fmt_time(wiki_time)}')
        for item_id in duplicate_ingredients:
            print(f"  WARN merged duplicate ingredient in {item_id}")
        for item_id in retained:
            print(f"  WARN retained deleted item because recipes still use it: {item_id}")
        for item_id in missing_icons:
            print(f"  WARN missing icon: {item_id}")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
