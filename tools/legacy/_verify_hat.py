import json, urllib.request, urllib.parse, re, sys
sys.stdout.reconfigure(encoding='utf-8')

base = "https://hayday.fandom.com/api.php"

# Query Hat Maker products for ingredient data
products = [
    "Cloche Hat", "Top Hat", "Sun Hat", "Flower Crown"
]

titles = "|".join(products)
params = urllib.parse.urlencode({
    "action": "query",
    "titles": titles,
    "prop": "revisions",
    "rvprop": "content",
    "rvslots": "main",
    "format": "json"
})
try:
    req = urllib.request.Request(base + "?" + params, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    
    pages = data.get("query",{}).get("pages",{})
    for pid, pinfo in pages.items():
        title = pinfo.get("title","")
        revisions = pinfo.get("revisions",[])
        if revisions:
            content = revisions[0].get("slots",{}).get("main",{}).get("*","")
            # Extract time and ingredients from infobox
            # Pattern: |time = X min or X h Y min
            time_match = re.search(r'time\s*=\s*(\d+)\s*(?:h\s*)?(\d+)?\s*min', content)
            if time_match:
                h = int(time_match.group(1)) if time_match.group(1) else 0
                m = int(time_match.group(2)) if time_match.group(2) else 0
                if 'h' in content[time_match.start():time_match.end()+5] and not time_match.group(2):
                    # Format: X h
                    total_sec = int(time_match.group(1)) * 3600
                elif time_match.group(2):
                    total_sec = h * 3600 + m * 60
                else:
                    total_sec = h * 60 if h else m * 60
                print(f"{title}: {total_sec}s")
            else:
                print(f"{title}: no time found")
            
            # Extract ingredients
            # Pattern: |ing1 = Name, X
            ings = re.findall(r'ing(\d+)\s*=\s*([^,|]+),\s*(\d+)', content)
            for num, name, qty in ings:
                name = name.strip()
                print(f"  Ingredient {num}: {name} x{qty}")
            
            # Also check level
            level = re.search(r'level\s*=\s*(\d+)', content)
            if level:
                print(f"  Level: {level.group(1)}")
        else:
            print(f"{title}: no content")
except Exception as e:
    print(f"Error: {e}")
