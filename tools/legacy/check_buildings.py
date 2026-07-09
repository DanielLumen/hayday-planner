import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HTML = ROOT / "index.html"
WIKI = ROOT / "wiki_products.json"

html = HTML.read_text(encoding="utf-8")
wiki = json.loads(WIKI.read_text(encoding="utf-8"))

# Parse HTML items by building
items_by_bld = {}
m = re.search(r'items:\[(.*?)\]\s*,\s*searchMode', html, re.DOTALL)
if not m: m = re.search(r'items:\s*\[(.*?)\];', html, re.DOTALL)
text = m.group(1)
pat = r'\{id:"([^"]+)",nameCN:"([^"]+)",emoji:"[^"]*",(?:bld:"([^"]+)",)?ing:\[(.*?)\],t:(\d+),tg:(\d+),st:"([^"]+)"\}'
for m in re.finditer(pat, text):
    bld = m.group(3) or ""
    if not bld: continue
    items_by_bld.setdefault(bld, []).append(m.group(2))

# Parse HTML buildings
bm = re.search(r'buildings:\[(.*?)\]', html, re.DOTALL)
blds = {}
for m in re.finditer(r'\{id:"([^"]+)",nameCN:"([^"]+)",slots:(\d+)\}', bm.group(1)):
    blds[m.group(1)] = m.group(2)

# Build wiki product counts
# Map wiki building names to HTML building IDs
wiki_count = {}
for wiki_name, data in wiki.items():
    prods = data.get("products", [])
    if not prods: continue
    # Find HTML building by name
    wiki_count[wiki_name] = len(prods)

# Build name mapping: wiki building name -> HTML id
name_to_id = {
    "Feed Mill": "feed_mill", "Bakery": "bakery", "Sugar Mill": "sugar_mill",
    "Dairy": "dairy", "Popcorn Pot": "popcorn_pot", "BBQ Grill": "bbq_grill",
    "Pie Oven": "pie_oven", "Cake Oven": "cake_oven", "Loom": "loom",
    "Sewing Machine": "sewing_machine", "Juice Press": "juice_press",
    "Ice Cream Maker": "ice_cream_maker", "Jam Maker": "jam_maker",
    "Jeweler": "jewelry_maker", "Coffee Kiosk": "coffee_kiosk",
    "Soup Kitchen": "soup_kitchen", "Candle Maker": "candle_maker",
    "Candy Machine": "candy_maker", "Sauce Maker": "sauce_maker",
    "Flower Shop": "flower_shop", "Sushi Bar": "sushi_bar",
    "Smoothie Mixer": "smoothie_mixer", "Waffle Maker": "waffle_maker",
    "Salad Bar": "salad_bar", "Sandwich Bar": "sandwich_bar",
    "Tea Stand": "tea_stand", "Taco Kitchen": "taco_kitchen",
    "Hot Dog Stand": "hotdog_stand", "Deep Fryer": "deep_fryer",
    "Essential Oils Lab": "essential_oils", "Preservation Station": "preservation",
    "Donut Maker": "donut_maker", "Pasta Maker": "pasta_maker",
    "Pasta Kitchen": "pasta_kitchen", "Fudge Shop": "fudge_shop",
    "Porridge Bar": "porridge_bar", "Milkshake Bar": "milkshake_bar",
    "Wok Kitchen": "wok_kitchen", "Stew Pot": "stew_pot",
    "Omelet Station": "omelet_station", "Fondue Pot": "fondue_pot",
    "Yogurt Maker": "yogurt_maker", "Cupcake Maker": "cupcake_maker",
    "Doner Kebab Stand": "kebab_stand", "Bath Kiosk": "bath_kiosk",
    "Hat Maker": "hat_maker", "Pottery Studio": "pottery_studio",
    "Perfumerie": "perfumerie", "Lure Workbench": "lure_workbench",
    "Net Maker": "net_maker", "Honey Extractor": "honey_extractor",
    "Smelter": "smelter"
}

print("=== 产品数量对比 ===")
issues = []
for wiki_name, html_id in name_to_id.items():
    wc = wiki_count.get(wiki_name, -1)
    hc = len(items_by_bld.get(html_id, []))
    if wc < 0:
        print(f"? {wiki_name} -> {html_id}: HTML有{hc}个, wiki无数据")
    elif wc != hc:
        print(f"MISMATCH {wiki_name} -> {html_id}: wiki有{wc}个, HTML有{hc}个")
        issues.append((wiki_name, html_id, wc, hc))
    else:
        pass  # Match

if issues:
    print(f"\n共有 {len(issues)} 个建筑产品数不一致")
else:
    print("\n所有建筑产品数一致!")

# For mismatches, show wiki products and HTML products
for wiki_name, html_id, wc, hc in issues:
    html_products = items_by_bld.get(html_id, [])
    wiki_products = [p.get("level","?") for p in wiki.get(wiki_name, {}).get("products", [])]
    print(f"\n--- {wiki_name} ({html_id}) ---")
    print(f"  Wiki ({wc}个): {wiki_products}")
    print(f"  HTML ({hc}个): {html_products}")
