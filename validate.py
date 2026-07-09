import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HTML = ROOT / "index.html"
WIKI = ROOT / "wiki_products.json"

def parse_items(html):
    items = []
    m = re.search(r'items:\[(.*?)\]\s*,\s*searchMode', html, re.DOTALL)
    if not m:
        m = re.search(r'items:\s*\[(.*?)\];', html, re.DOTALL)
    if not m:
        print("ERROR: Cannot find items array")
        return []
    text = m.group(1)
    pat = r'\{id:"([^"]+)",nameCN:"([^"]+)",emoji:"[^"]*",((?:bld:"([^"]+)",)?)ing:\[(.*?)\],t:(\d+),tg:(\d+),st:"([^"]+)"\}'
    for m in re.finditer(pat, text):
        it = {"id": m.group(1), "nameCN": m.group(2), "bld": m.group(4) or "", "t": int(m.group(6)), "tg": int(m.group(7)), "st": m.group(8)}
        ings = []
        for mi in re.finditer(r'i:"([^"]+)",q:(\d+)', m.group(5)):
            ings.append({"i": mi.group(1), "q": int(mi.group(2))})
        it["ing"] = ings
        items.append(it)
    return items

def parse_buildings(html):
    bm = re.search(r'buildings:\[(.*?)\]', html, re.DOTALL)
    if not bm: return {}
    blds = {}
    for m in re.finditer(r'\{id:"([^"]+)",nameCN:"([^"]+)",slots:(\d+)\}', bm.group(1)):
        blds[m.group(1)] = {"nameCN": m.group(2), "slots": int(m.group(3))}
    return blds

def fmt_time(s):
    if s < 60: return f'{s}s'
    if s < 3600: return f'{s//60}m{s%60}s' if s % 60 else f'{s//60}m'
    h = s // 3600; m = (s % 3600) // 60
    if m: return f'{h}h{m}m'
    return f'{h}h'

def fmt_ing(ings):
    if not ings: return "none"
    return " + ".join([f'{i["q"]}x{i["i"]}' for i in ings])

def main():
    html = HTML.read_text(encoding="utf-8")
    items = parse_items(html)
    buildings = parse_buildings(html)
    if not items: sys.exit(1)
    groups = {}
    for it in items:
        bld = it.get("bld", "")
        if not bld: bld = "silo" if it["st"] == "silo" else "barn"
        groups.setdefault(bld, []).append(it)
    total = 0
    for bld_id in sorted(groups.keys()):
        its = groups[bld_id]
        total += len(its)
        label = buildings.get(bld_id, {}).get("nameCN", bld_id)
        print(f'\n=== {label} ({bld_id}) ===')
        for it in sorted(its, key=lambda x: x["t"]):
            print(f'  {it["nameCN"]:8s}  id={it["id"]:30s}  t={it["t"]:5d}s  {fmt_time(it["t"]):10s}  tg={it["tg"]:2d}  ing: {fmt_ing(it["ing"])}')
    print(f'\n{"="*60}')
    print(f'Total: {total} items ({len(groups)} groups)')
    
    if WIKI.exists():
        print(f'\n{"="*60}')
        print("wiki check:")
        wiki = json.loads(WIKI.read_text(encoding="utf-8"))
        wiki_map = {}
        for cat_id, prods in wiki.items():
            if isinstance(prods, list):
                for p in prods:
                    if isinstance(p, dict) and "id" in p:
                        wiki_map[p["id"]] = p
        issues = []
        for it in items:
            w = wiki_map.get(it["id"])
            if not w: continue
            wt = w.get("time", 0)
            if wt > 0 and it["t"] != wt:
                if wt > 100 and it["t"] < wt:
                    pass
                elif wt < 3600 and it["t"] != wt:
                    issues.append((it, wt))
        if issues:
            print(f'{len(issues)} time mismatches (<1h):')
            for it, wt in issues:
                print(f'  {it["nameCN"]} ({it["id"]}): HTML={fmt_time(it["t"])}, wiki={fmt_time(wt)}')
        else:
            print('No time mismatches found.')
    
    print(f'\n{"="*60}')
    print("Anomaly check:")
    warnings = 0
    exempt = {"silo","smelter","jewelry_maker","honey_extractor","lure_workbench","net_maker"}
    exempt_items = {"silver_bar","gold_bar","platinum_bar","iron_bar"}
    for it in items:
        if it["t"] <= 0:
            print(f'  WARN {it["nameCN"]} ({it["id"]}): t={it["t"]}s')
            warnings += 1
        if len(it["ing"]) == 0 and it.get("bld") and it.get("bld") not in exempt and it["id"] not in exempt_items:
            print(f'  WARN {it["nameCN"]} ({it["id"]}): bld={it["bld"]} but no ingredients')
            warnings += 1
    if warnings == 0:
        print("  No anomalies found.")
    else:
        print(f'  {warnings} warnings.')

if __name__ == "__main__":
    main()
