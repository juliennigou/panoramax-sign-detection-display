#!/usr/bin/env python3
"""Generate static frontend assets from sign observations."""

from __future__ import annotations

import json
import pathlib
import shutil
from collections import Counter
from typing import Any

from PIL import Image


ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_DATASET_DIR = ROOT / "output" / "l-ge-cap-ferret-gironde-france-fov-360"
FAMILY_PALETTE = [
    "#ef476f",
    "#118ab2",
    "#ffd166",
    "#06d6a0",
    "#f78c6b",
    "#8338ec",
    "#ff006e",
    "#3a86ff",
    "#fb5607",
    "#6a994e",
]


def parse_args() -> Any:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=pathlib.Path, default=DEFAULT_DATASET_DIR)
    parser.add_argument("--observations-path", type=pathlib.Path)
    parser.add_argument("--summary-path", type=pathlib.Path)
    parser.add_argument("--app-data-dir", type=pathlib.Path, default=ROOT / "coverage-map" / "public" / "data")
    parser.add_argument("--preview-max-size", type=int, default=320)
    return parser.parse_args()


def resolve_path(path: pathlib.Path) -> pathlib.Path:
    return path if path.is_absolute() else ROOT / path


def read_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: pathlib.Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")


def family_colors(observations: list[dict[str, Any]]) -> dict[str, str]:
    counts = Counter(observation["classification_family"] for observation in observations)
    ordered = [family for family, _count in counts.most_common()]
    return {family: FAMILY_PALETTE[index % len(FAMILY_PALETTE)] for index, family in enumerate(ordered)}


def make_preview(source_path: pathlib.Path, target_path: pathlib.Path, max_size: int) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source_path) as image:
        image = image.convert("RGB")
        image.thumbnail((max_size, max_size))
        image.save(target_path, quality=90)


def main() -> int:
    args = parse_args()
    dataset_dir = resolve_path(args.dataset_dir)
    observations_path = resolve_path(args.observations_path or dataset_dir / "sign_inference" / "observations.json")
    summary_path = resolve_path(args.summary_path or dataset_dir / "sign_inference" / "summary.json")
    app_data_dir = resolve_path(args.app_data_dir)

    observations = read_json(observations_path)["items"]
    summary = read_json(summary_path)
    colors = family_colors(observations)

    preview_dir = app_data_dir / "sign_previews"
    if preview_dir.exists():
        shutil.rmtree(preview_dir)
    preview_dir.mkdir(parents=True, exist_ok=True)

    point_features = []
    ray_features = []
    for observation in observations:
        preview_name = f"{observation['observation_id']}.jpg"
        preview_abs_path = preview_dir / preview_name
        crop_abs_path = dataset_dir / observation["crop_path"]
        make_preview(crop_abs_path, preview_abs_path, args.preview_max_size)
        preview_url = f"/data/sign_previews/{preview_name}"

        properties = {
            "observationId": observation["observation_id"],
            "sourceId": observation["source_id"],
            "collectionId": observation["source_collection_id"],
            "provider": observation["source_provider_name"] or "unknown",
            "datetime": observation["source_datetime"],
            "sourceLon": observation["source_lon"],
            "sourceLat": observation["source_lat"],
            "sourceAzimuth": observation["source_view_azimuth"],
            "horizontalAccuracy": observation["source_horizontal_accuracy"],
            "faceName": observation["face_name"],
            "faceYaw": observation["face_yaw"],
            "detectorClass": observation["detector_class"],
            "detectorScore": observation["detector_score"],
            "classificationLabel": observation["classification"]["label"] if observation["classification"] else None,
            "classificationConfidence": observation["classification"]["confidence"] if observation["classification"] else None,
            "classificationFamily": observation["classification_family"],
            "displayLabel": observation["display_label"],
            "familyColor": colors[observation["classification_family"]],
            "worldAzimuth": observation["world_azimuth"],
            "rayLengthM": observation["ray_length_m"],
            "cropUrl": preview_url,
            "sourceThumbUrl": observation.get("source_thumb_url"),
            "sourceAssetUrl": observation.get("source_asset_url"),
            "sourceItemUrl": observation.get("source_item_url"),
            "sourceOriginalName": observation.get("source_original_name"),
            "bboxXyxy": observation["bbox_xyxy"],
            "bboxXywhNorm": observation["bbox_xywh_norm"],
            "topClasses": observation["classification"]["top5"] if observation["classification"] else [],
        }

        point_features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [observation["ray_end_lon"], observation["ray_end_lat"]],
                },
                "properties": properties,
            }
        )
        ray_features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [observation["source_lon"], observation["source_lat"]],
                        [observation["ray_end_lon"], observation["ray_end_lat"]],
                    ],
                },
                "properties": properties,
            }
        )

    family_stats = [
        {
            "family": family,
            "count": count,
            "color": colors[family],
        }
        for family, count in Counter(observation["classification_family"] for observation in observations).most_common()
    ]

    sign_summary = {
        "observationsCount": summary["observations_count"],
        "signCount": summary["sign_count"],
        "subsignCount": summary["subsign_count"],
        "classifiedCount": summary["classified_count"],
        "sourcesWithDetections": summary["sources_with_detections"],
        "rayLengthM": summary["ray_length_m"],
        "familyStats": family_stats,
    }

    write_json(app_data_dir / "sample_sign_points.geojson", {"type": "FeatureCollection", "features": point_features})
    write_json(app_data_dir / "sample_sign_rays.geojson", {"type": "FeatureCollection", "features": ray_features})
    write_json(app_data_dir / "sample_sign_summary.json", sign_summary)

    print("Generated sign assets:")
    for name in ("sample_sign_points.geojson", "sample_sign_rays.geojson", "sample_sign_summary.json"):
        path = app_data_dir / name
        print(f"  {name}: {path.stat().st_size} bytes")
    print(f"  previews: {len(point_features)} files in {preview_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
