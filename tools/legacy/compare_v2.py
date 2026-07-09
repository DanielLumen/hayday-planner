import json, re, sys, io
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ROOT = Path(__file__).resolve().parents[2]

# Load wiki data from the saved file
with open(ROOT / "wiki_products.json", "r", encoding="utf-8") as f:
    wiki_data = json.load(f)

# Parse current data
with open(ROOT / "index.html", "r", encoding="utf-8") as f:
    html = f.read()

d_start = html.find("var D={")
icons_start = html.find("var ICONS={")
d_str = html[d_start:icons_start]

# Parse items
items_start = d_str.find("items:[")
items_str = d_str[items_start + 7:]
items = []; depth = 0; start_idx = 0; i = 0
while i < len(items_str):
    c = items_str[i]
    if c == '{':
        if depth == 0: start_idx = i
        depth += 1
    elif c == '}':
        depth -= 1
        if depth == 0: items.append(items_str[start_idx:i+1])
    i += 1

# Build current product map: building_id -> [(item_id, nameCN, time, ingredients)]
current = {}
for item_str in items:
    id_m = re.search(r'id:"([^"]+)"', item_str)
    name_m = re.search(r'nameCN:"([^"]+)"', item_str)
    bld_m = re.search(r'bld:"([^"]*)"', item_str)
    t_m = re.search(r',t:(\d+)', item_str)
    ing_m = re.search(r'ing:\[([^\]]*)\]', item_str)
    if not id_m or not bld_m: continue
    bld = bld_m.group(1)
    if not bld: continue
    
    item_id = id_m.group(1)
    name = name_m.group(1) if name_m else "?"
    t = int(t_m.group(1)) if t_m else 0
    
    ings = []
    if ing_m:
        for im in re.finditer(r'\{i:"([^"]+)",q:(\d+)\}', ing_m.group(1)):
            ings.append((im.group(1), int(im.group(2))))
    
    current.setdefault(bld, []).append((item_id, name, t, ings))

# Wiki building name to our ID mapping
wiki_to_bld = {
    "Bakery":"bakery","Dairy":"dairy","Sugar Mill":"sugar_mill",
    "Popcorn Pot":"popcorn_pot","BBQ Grill":"bbq_grill","Pie Oven":"pie_oven",
    "Cake Oven":"cake_oven","Loom":"loom","Sewing Machine":"sewing_machine",
    "Juice Press":"juice_press","Ice Cream Maker":"ice_cream_maker",
    "Jam Maker":"jam_maker","Jeweler":"jewelry_maker","Coffee Kiosk":"coffee_kiosk",
    "Soup Kitchen":"soup_kitchen","Candle Maker":"candle_maker",
    "Candy Machine":"candy_maker","Sauce Maker":"sauce_maker",
    "Flower Shop":"flower_shop","Sushi Bar":"sushi_bar",
    "Smoothie Mixer":"smoothie_mixer","Waffle Maker":"waffle_maker",
    "Salad Bar":"salad_bar","Sandwich Bar":"sandwich_bar",
    "Tea Stand":"tea_stand","Taco Kitchen":"taco_kitchen",
    "Hot Dog Stand":"hotdog_stand","Deep Fryer":"deep_fryer",
    "Essential Oils Lab":"essential_oils","Preservation Station":"preservation",
    "Donut Maker":"donut_maker","Pasta Maker":"pasta_maker",
    "Pasta Kitchen":"pasta_kitchen","Fudge Shop":"fudge_shop",
    "Porridge Bar":"porridge_bar","Milkshake Bar":"milkshake_bar",
    "Wok Kitchen":"wok_kitchen","Stew Pot":"stew_pot",
    "Omelet Station":"omelet_station","Fondue Pot":"fondue_pot",
    "Yogurt Maker":"yogurt_maker","Cupcake Maker":"cupcake_maker",
    "Doner Kebab Stand":"kebab_stand","Bath Kiosk":"bath_kiosk",
    "Hat Maker":"hat_maker","Pottery Studio":"pottery_studio",
    "Perfumerie":"perfumerie","Honey Extractor":"honey_extractor",
    "Smelter":"smelter","Feed Mill":"feed_mill",
}

# Compare product counts for each building
print("=== Building Product Count Comparison ===\n")
print(f"{'Building':<25} {'Wiki':>5} {'Current':>8} {'Status':>8}")
print("-" * 50)

issues = []
for wiki_name, bld_id in sorted(wiki_to_bld.items()):
    wdata = wiki_data.get(wiki_name, {})
    if wdata.get("error"):
        continue
    
    wiki_count = len(wdata.get("products", []))
    current_count = len(current.get(bld_id, []))
    
    diff = wiki_count - current_count
    if diff == 0:
        status = "✅"
    elif diff > 0:
        status = f"缺{diff}"
        issues.append((bld_id, wiki_name, f"Missing {diff} products"))
    else:
        status = f"多{-diff}"
        issues.append((bld_id, wiki_name, f"Extra {-diff} products"))
    
    print(f"{wiki_name:<25} {wiki_count:>5} {current_count:>8} {status:>8}")

print(f"\n=== Buildings with issues: {len(issues)} ===")
for bld_id, name, desc in issues:
    # Show current products
    cur = current.get(bld_id, [])
    wiki_prods = wiki_data.get(name, {}).get("products", [])
    print(f"\n[{bld_id}] {name}: {desc}")
    print(f"  Current: {', '.join(p[1] for p in cur)}")
    # Extract wiki names (they're in the 'level' field due to offset)
    wnames = [p.get('level', p.get('name', '?')) for p in wiki_prods]
    print(f"  Wiki:    {', '.join(wnames)}")
