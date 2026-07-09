import sys, io, re
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ROOT = Path(__file__).resolve().parents[2]

with open(ROOT / "index.html", "r", encoding="utf-8") as f:
    content = f.read()

errors = []

# 1. Check HTML structure
if content.count('<script>') != content.count('</script>'):
    errors.append("Script tag mismatch")
if content.count('<style>') != content.count('</style>'):
    errors.append("Style tag mismatch")
if not content.strip().endswith('</html>'):
    errors.append("Missing </html>")

# 2. Extract JS and check brace balance
js_start = content.find('<script>') + len('<script>')
js_end = content.find('</script>', js_start)
js = content[js_start:js_end]

brace_depth = 0
for i, c in enumerate(js):
    if c == '{': brace_depth += 1
    elif c == '}': brace_depth -= 1
    if brace_depth < 0:
        line = js[:i].count('\n') + 1
        errors.append(f"Extra }} at JS line ~{line}")
        brace_depth = 0

if brace_depth != 0:
    errors.append(f"Unbalanced braces in JS: {brace_depth} extra {'{' if brace_depth>0 else '}'}")

# 3. Check data object braces
d_start = content.find("var D={")
icons_start = content.find("var ICONS={")
d_str = content[d_start:icons_start]

d_depth = 0
for c in d_str:
    if c == '{': d_depth += 1
    elif c == '}': d_depth -= 1
if d_depth != 0:
    errors.append(f"D object braces off by {d_depth}")

# 4. Check for common issues
if 'function save()' in js:
    errors.append("save() defined but should be sv()")
if 'save();' in js and 'function sv()' in js:
    errors.append("save() called but function is sv()")

# Check all function calls exist
func_defs = set(re.findall(r'function\s+(\w+)\(', js))
func_calls = set(re.findall(r'(?<!function\s)(\w+)\(', js))
# Built-ins to ignore
builtins = {'if','for','while','switch','catch','forEach','push','test','log',
            'getItem','setItem','parseInt','parse','JSON','Math','Array','Object',
            'document','querySelector','querySelectorAll','getElementById','addEventListener',
            'classList','closest','preventDefault','stopPropagation','focus','select',
            'localStorage','console','alert','String','Number','from','indexOf',
            'nextElementSibling','contains','toLowerCase','replace','match','split',
            'join','push','pop','shift','unshift','slice','splice','map','filter',
            'reduce','sort','reverse','charAt','substr','substring','trim','round',
            'floor','ceil','abs','max','min','random','keys','values','entries',
            'has','get','set','clear','toggle','add','remove','find','some','every',
            'includes','startsWith','endsWith','toFixed','toString','parseFloat',
            'isNaN','isFinite','now','open','close','write','writeln','exec','compile',
            'apply','call','bind','then','catch','finally','resolve','reject',
            'setTimeout','setInterval','clearTimeout','clearInterval','encodeURI',
            'decodeURI','encodeURIComponent','decodeURIComponent','parseInt',
            'isArray','assign','create','defineProperty','freeze','seal'}
missing_calls = func_calls - func_defs - builtins
if missing_calls:
    errors.append(f"Undefined function calls: {missing_calls}")

# 5. Check data integrity
d_data = content[d_start:icons_start]
items_count = len(re.findall(r'\{id:"', d_data))
blds_match = re.search(r'buildings:\[([\s\S]*?)\],\s*items:', d_data)
blds_count = len(re.findall(r'\{id:"', blds_match.group(1))) if blds_match else 0

print(f"Buildings: {blds_count}")
print(f"Items: {items_count}")
print(f"Errors found: {len(errors)}")
for e in errors:
    print(f"  ❌ {e}")
if not errors:
    print("  ✅ No structural errors found")
