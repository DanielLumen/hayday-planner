import json, urllib.request, urllib.parse, re, sys
sys.stdout.reconfigure(encoding='utf-8')

base = "https://hayday.fandom.com/api.php"

# Get raw content of Cloche Hat to see the format
params = urllib.parse.urlencode({
    "action": "query",
    "titles": "Cloche Hat",
    "prop": "revisions",
    "rvprop": "content",
    "rvslots": "main",
    "format": "json"
})
req = urllib.request.Request(base + "?" + params, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=20) as resp:
    data = json.loads(resp.read())

pages = data.get("query",{}).get("pages",{})
for pid, pinfo in pages.items():
    content = pinfo.get("revisions",[{}])[0].get("slots",{}).get("main",{}).get("*","")
    # Print lines with "ing" or "time" or "level"
    for line in content.split("\n"):
        if any(x in line.lower() for x in ['ing', 'time', 'level', 'price', 'xp', 'source']):
            print(line.strip())
        if '{{Infobox' in line:
            print("--- INFOBOX START ---")
