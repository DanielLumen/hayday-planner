import urllib.request, urllib.parse, json, re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def wiki_raw(title):
    base = "https://hayday.fandom.com/api.php"
    params = {
        "action": "query",
        "titles": title,
        "prop": "revisions",
        "rvprop": "content",
        "rvslots": "main",
        "format": "json",
        "formatversion": "2"
    }
    url = base + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())
    pages = data.get("query", {}).get("pages", [])
    if pages and "revisions" in pages[0]:
        return pages[0]["revisions"][0]["slots"]["main"]["content"]
    return ""

# Try to find a master product list
print("=== Products page ===")
content = wiki_raw("Products")
if content:
    # Find all product links
    prods = re.findall(r'\{\{Building Products\n(.*?)\}\}', content, re.DOTALL)
    print(f"Found {len(prods)} building product tables")
    for p in prods[:3]:
        print(f"  Table: {p[:200]}...")
else:
    print("Page not found")

# Instead query individual building pages for product tables
# Let's batch query several buildings at once
buildings_to_check = [
    "Bakery", "Dairy", "Sugar Mill", "Popcorn Pot", "BBQ Grill",
    "Pie Oven", "Cake Oven", "Loom", "Sewing Machine", "Juice Press",
]

print("\n=== Building product tables ===")
for bld in buildings_to_check:
    content = wiki_raw(bld)
    if content:
        # Extract the product table
        prod_match = re.search(r'\{\{Building Products\n(.*?)\}\}', content, re.DOTALL)
        if prod_match:
            table = prod_match.group(1)
            # Parse each line: Product|Level|Time|Price
            products = []
            for line in table.strip().split('\n'):
                parts = line.strip().split('|')
                if len(parts) >= 3:
                    products.append(f"{parts[0].strip()} (Lv{parts[1].strip()}, {parts[2].strip()})")
            print(f"\n{bld}: {len(products)} products")
            for p in products:
                print(f"  {p}")
        else:
            print(f"\n{bld}: No product table found")
