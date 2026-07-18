#!/usr/bin/env python3
"""Download the user-confirmed catalog images into a validated staging folder."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
WEBP_SIGNATURE = b"RIFF"
USER_AGENT = "HayDayPlannerCatalogMigration/1.0"


def load_rows(mapping_path: Path) -> list[dict]:
    data = json.loads(mapping_path.read_text(encoding="utf-8-sig"))
    if data.get("version") != 2 or data.get("type") != "hayday-catalog-id-image-mapping":
        raise ValueError("unexpected mapping format")
    rows = list(data.get("items", [])) + list(data.get("buildings", []))
    selected = [row for row in rows if row.get("decision") in {"matched", "new"}]
    if len(selected) != 475:
        raise ValueError(f"expected 475 confirmed rows, found {len(selected)}")
    ids = [row.get("canonicalId", "") for row in selected]
    if any(not value for value in ids) or len(ids) != len(set(ids)):
        raise ValueError("canonical image IDs are missing or duplicated")
    if any(not row.get("imageUrl") for row in selected):
        raise ValueError("one or more confirmed rows have no image URL")
    return selected


def download_one(row: dict, destination: Path, attempts: int = 4) -> dict:
    image_id = row["canonicalId"]
    target = destination / f"{image_id}.png"
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                row["imageUrl"],
                headers={"User-Agent": USER_AGENT, "Accept": "image/png,image/*;q=0.8"},
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read()
                content_type = response.headers.get_content_type()
            source_format = "png"
            if body.startswith(PNG_SIGNATURE):
                target.write_bytes(body)
            elif body.startswith(WEBP_SIGNATURE) and body[8:12] == b"WEBP":
                source_format = "webp"
                temporary = destination / f".{image_id}.download.webp"
                temporary.write_bytes(body)
                try:
                    subprocess.run(
                        ["/usr/bin/sips", "-s", "format", "png", str(temporary), "--out", str(target)],
                        check=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.PIPE,
                    )
                finally:
                    temporary.unlink(missing_ok=True)
            else:
                raise ValueError(
                    f"{image_id}: unsupported image bytes {content_type} ({body[:12].hex()})"
                )
            subprocess.run(
                ["/usr/bin/sips", "-Z", "256", str(target)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            converted = target.read_bytes()
            if not converted.startswith(PNG_SIGNATURE):
                raise ValueError(f"{image_id}: PNG conversion did not produce PNG bytes")
            if len(converted) < 256:
                raise ValueError(f"{image_id}: implausibly small PNG ({len(converted)} bytes)")
            width = int.from_bytes(converted[16:20], "big")
            height = int.from_bytes(converted[20:24], "big")
            if width > 256 or height > 256 or width < 1 or height < 1:
                raise ValueError(f"{image_id}: invalid optimized dimensions {width}x{height}")
            return {
                "id": image_id,
                "kind": "item" if row.get("sourceUrl", "").find("/goodsList/") >= 0 else "building",
                "nameCN": row.get("nameCN", ""),
                "nameEN": row.get("nameEN", ""),
                "sourceUrl": row["imageUrl"],
                "file": target.name,
                "sourceFormat": source_format,
                "sourceBytes": len(body),
                "width": width,
                "height": height,
                "bytes": len(converted),
                "sha256": hashlib.sha256(converted).hexdigest(),
            }
        except (OSError, urllib.error.URLError, ValueError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(0.6 * (attempt + 1))
    raise RuntimeError(str(last_error))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mapping", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    rows = load_rows(args.mapping)
    args.destination.mkdir(parents=True, exist_ok=True)
    expected_names = {f"{row['canonicalId']}.png" for row in rows}
    for old_file in args.destination.glob("*.png"):
        if old_file.name not in expected_names:
            old_file.unlink()

    results: list[dict] = []
    errors: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        future_rows = {
            pool.submit(download_one, row, args.destination): row for row in rows
        }
        for future in concurrent.futures.as_completed(future_rows):
            row = future_rows[future]
            try:
                results.append(future.result())
            except Exception as error:  # noqa: BLE001 - report every failed asset together
                errors.append(f"{row['canonicalId']}: {error}")

    if errors:
        raise RuntimeError("download failures:\n" + "\n".join(sorted(errors)))
    results.sort(key=lambda record: record["id"])
    if len(results) != 475 or len({record["sha256"] for record in results}) != 475:
        raise RuntimeError("downloaded image count or content uniqueness check failed")
    manifest = {
        "version": 1,
        "mappingSha256": hashlib.sha256(args.mapping.read_bytes()).hexdigest(),
        "count": len(results),
        "totalBytes": sum(record["bytes"] for record in results),
        "images": results,
    }
    (args.destination / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "status": "PASS",
                "count": manifest["count"],
                "totalBytes": manifest["totalBytes"],
                "destination": str(args.destination),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
