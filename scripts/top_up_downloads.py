#!/usr/bin/env python3
"""Fill an existing Panoramax output directory up to a target image count."""

from __future__ import annotations

import argparse
import json
import pathlib

from download_panoramax_city import download_selected_items, sample_items


def load_items(path: pathlib.Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["items"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=pathlib.Path, required=True)
    parser.add_argument("--target-count", type=int, default=100)
    parser.add_argument("--download-workers", type=int, default=2)
    parser.add_argument("--download-retries", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=120.0)
    args = parser.parse_args()

    all_items = load_items(args.output_dir / "all_items.json")
    selected_items = load_items(args.output_dir / "selected_items.json")
    downloaded_items = load_items(args.output_dir / "downloaded_items.json")

    downloaded_ids = {item["id"] for item in downloaded_items}
    missing_selected = [item for item in selected_items if item["id"] not in downloaded_ids]
    remaining_pool = [item for item in all_items if item["id"] not in downloaded_ids]

    needed = max(0, args.target_count - len(downloaded_items))
    if needed == 0:
        print(json.dumps({"downloaded_items": len(downloaded_items), "target_count": args.target_count}, indent=2))
        return 0

    retries_first = missing_selected
    supplemental = sample_items(
        [item for item in remaining_pool if item["id"] not in {row["id"] for row in missing_selected}],
        target_count=max(needed * 3, needed),
    )
    candidates = retries_first + supplemental

    new_downloads = download_selected_items(
        candidates,
        destination_dir=args.output_dir,
        timeout=args.timeout,
        max_workers=args.download_workers,
        retries=args.download_retries,
    )

    merged = {item["id"]: item for item in downloaded_items}
    for item in new_downloads:
        merged[item["id"]] = item

    final_items = sorted(merged.values(), key=lambda row: row["datetime"] or "", reverse=True)[: args.target_count]
    payload = {"count": len(final_items), "items": final_items}
    (args.output_dir / "downloaded_items.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )

    summary_path = args.output_dir / "summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    total_bytes = sum(item.get("downloaded_size", 0) for item in final_items)
    summary["downloaded_items"] = len(final_items)
    summary["downloaded_total_bytes"] = total_bytes
    summary["downloaded_total_gb"] = round(total_bytes / (1024 ** 3), 3)
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
