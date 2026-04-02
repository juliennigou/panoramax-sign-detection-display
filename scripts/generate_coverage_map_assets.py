#!/usr/bin/env python3
"""Precompute lightweight map assets for the coverage viewer."""

from __future__ import annotations

import json
import pathlib
from collections import Counter, defaultdict


PALETTE = [
    "#e85d04",
    "#0f4c5c",
    "#2a9d8f",
    "#9a031e",
    "#ffb703",
    "#3a86ff",
    "#6a994e",
    "#8338ec",
]


def read_items(path: pathlib.Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["items"]


def normalize_provider(value: str | None) -> str:
    return value.strip() if value and value.strip() else "unknown"


def provider_palette(items: list[dict]) -> tuple[dict[str, str], list[dict]]:
    counts = Counter(normalize_provider(item.get("provider_name")) for item in items)
    ordered = counts.most_common()
    colors = {provider: PALETTE[index % len(PALETTE)] for index, (provider, _) in enumerate(ordered)}
    stats = [{"provider": provider, "count": count, "color": colors[provider]} for provider, count in ordered]
    return colors, stats


def bounds(items: list[dict]) -> list[list[float]]:
    lons = [item["lon"] for item in items]
    lats = [item["lat"] for item in items]
    return [[min(lons), min(lats)], [max(lons), max(lats)]]


def build_dataset(items: list[dict]) -> tuple[dict, dict, dict]:
    colors, provider_stats = provider_palette(items)

    point_features = []
    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        provider = normalize_provider(item.get("provider_name"))
        grouped[item["collection_id"]].append(item)
        point_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [item["lon"], item["lat"]]},
                "properties": {
                    "id": item["id"],
                    "collectionId": item["collection_id"],
                    "provider": provider,
                    "providerColor": colors[provider],
                    "datetime": item["datetime"],
                    "azimuth": item.get("view_azimuth"),
                    "cameraModel": item.get("camera_model"),
                    "horizontalAccuracy": item.get("horizontal_accuracy"),
                    "lon": item["lon"],
                    "lat": item["lat"],
                    "license": item.get("license"),
                    "thumbUrl": item.get("thumb_url"),
                    "assetUrl": item.get("asset_url"),
                    "sourceItemUrl": item.get("source_item_url"),
                    "originalName": item.get("original_name"),
                    "annotationsCount": item.get("annotations_count", 0),
                    "semanticsCount": item.get("semantics_count", 0),
                    "downloadedPath": item.get("downloaded_path"),
                },
            }
        )

    line_features = []
    for collection_id, collection_items in grouped.items():
        collection_items.sort(key=lambda row: row["datetime"])
        if len(collection_items) < 2:
            continue
        provider = normalize_provider(collection_items[0].get("provider_name"))
        line_features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[item["lon"], item["lat"]] for item in collection_items],
                },
                "properties": {
                    "collectionId": collection_id,
                    "provider": provider,
                    "providerColor": colors[provider],
                    "startDatetime": collection_items[0]["datetime"],
                    "endDatetime": collection_items[-1]["datetime"],
                    "pointCount": len(collection_items),
                },
            }
        )

    datetimes = sorted(item["datetime"] for item in items)
    stats = {
        "pointCount": len(items),
        "collectionCount": len(grouped),
        "providerCount": len(provider_stats),
        "dateMin": datetimes[0],
        "dateMax": datetimes[-1],
        "providerStats": provider_stats,
        "mapBounds": bounds(items),
    }

    return (
        {"type": "FeatureCollection", "features": point_features},
        {"type": "FeatureCollection", "features": line_features},
        stats,
    )


def write_json(path: pathlib.Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")


def main() -> int:
    root = pathlib.Path("/Users/juliennigou/panoramax")
    output_dir = root / "output" / "l-ge-cap-ferret-gironde-france-fov-360"
    app_data_dir = root / "coverage-map" / "public" / "data"

    sample_items = read_items(output_dir / "downloaded_items.json")
    full_items = read_items(output_dir / "all_items.json")

    sample_points, sample_lines, sample_stats = build_dataset(sample_items)
    full_points, full_lines, full_stats = build_dataset(full_items)

    write_json(app_data_dir / "sample_points.geojson", sample_points)
    write_json(app_data_dir / "sample_lines.geojson", sample_lines)
    write_json(app_data_dir / "sample_stats.json", sample_stats)
    write_json(app_data_dir / "full_points.geojson", full_points)
    write_json(app_data_dir / "full_lines.geojson", full_lines)
    write_json(app_data_dir / "full_stats.json", full_stats)

    # Preserve the existing small metadata payloads for the UI shell.
    for name in ("query.json", "summary.json"):
        src = output_dir / name
        dst = app_data_dir / name
        dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")

    print("Generated:")
    for name in (
        "sample_points.geojson",
        "sample_lines.geojson",
        "sample_stats.json",
        "full_points.geojson",
        "full_lines.geojson",
        "full_stats.json",
    ):
        path = app_data_dir / name
        print(f"  {name}: {path.stat().st_size} bytes")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
