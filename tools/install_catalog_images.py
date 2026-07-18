#!/usr/bin/env python3
"""Validate staged catalog PNGs and atomically install them into icons/."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("staging", type=Path)
    parser.add_argument("icons", type=Path)
    parser.add_argument("--mapping-sha256", required=True)
    args = parser.parse_args()
    manifest = json.loads((args.staging / "manifest.json").read_text(encoding="utf-8"))
    records = manifest.get("images", [])
    if (
        manifest.get("count") != 475
        or len(records) != 475
        or manifest.get("mappingSha256") != args.mapping_sha256
    ):
        raise ValueError("staged image manifest does not match the audited mapping")
    if len({record.get("id") for record in records}) != 475:
        raise ValueError("staged image IDs are missing or duplicated")
    args.icons.mkdir(parents=True, exist_ok=True)
    overwritten = 0
    added = 0
    total_bytes = 0
    for record in records:
        source = args.staging / record["file"]
        body = source.read_bytes()
        width = int.from_bytes(body[16:20], "big") if body.startswith(PNG_SIGNATURE) else 0
        height = int.from_bytes(body[20:24], "big") if body.startswith(PNG_SIGNATURE) else 0
        if (
            not body.startswith(PNG_SIGNATURE)
            or hashlib.sha256(body).hexdigest() != record["sha256"]
            or len(body) != record["bytes"]
            or width != record["width"]
            or height != record["height"]
            or width > 256
            or height > 256
        ):
            raise ValueError(f"staged image validation failed: {record['id']}")
        target = args.icons / f"{record['id']}.png"
        if target.exists():
            overwritten += 1
        else:
            added += 1
        temporary = args.icons / f".{record['id']}.catalog-migration.tmp"
        shutil.copyfile(source, temporary)
        os.replace(temporary, target)
        total_bytes += len(body)
    print(
        json.dumps(
            {
                "status": "PASS",
                "installed": len(records),
                "overwritten": overwritten,
                "added": added,
                "totalBytes": total_bytes,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
