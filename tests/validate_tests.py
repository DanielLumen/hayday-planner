import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import validate  # noqa: E402


def main():
    base = [{"id": "wheat", "nameCN": "小麦", "bld": "", "ing": [], "t": 120, "tg": 10, "st": "silo_field"}]
    edits = {
        "add": [{"id": "custom_demo", "nameCN": "测试物品", "bld": "bakery", "ing": [], "t": 60, "tg": 2, "st": "barn"}],
        "mod": {"custom_demo": {"nameCN": "修改后的测试物品", "ing": [{"i": "wheat", "q": 2}]}},
        "del": [],
    }
    items, retained, duplicates = validate.apply_edits(base, edits)
    custom = next(item for item in items if item["id"] == "custom_demo")
    assert custom["nameCN"] == "修改后的测试物品"
    assert custom["ing"] == [{"i": "wheat", "q": 2}]
    assert retained == []
    assert duplicates == []
    print("validate tests passed")


if __name__ == "__main__":
    main()
