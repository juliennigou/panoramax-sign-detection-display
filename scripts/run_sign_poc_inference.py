#!/usr/bin/env python3
"""Run the Panoramax sign-detection POC on horizontal cube faces."""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import re
import shutil
from collections import Counter
from typing import Any

import torch
from huggingface_hub import hf_hub_download
from PIL import Image
from ultralytics import YOLO


ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_DATASET_DIR = ROOT / "output" / "l-ge-cap-ferret-gironde-france-fov-360"
CUBE_FACE_FOV_DEGREES = 90.0
EARTH_RADIUS_METERS = 6_378_137.0
MAIN_SIGN_CLASSES = {"panneau", "sign"}
SECONDARY_SIGN_CLASSES = {"panonceau", "plate"}
IGNORED_CLASSES = {"face"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=pathlib.Path, default=DEFAULT_DATASET_DIR)
    parser.add_argument("--manifest-path", type=pathlib.Path)
    parser.add_argument("--items-path", type=pathlib.Path)
    parser.add_argument("--output-dir", type=pathlib.Path)
    parser.add_argument("--detector-repo", default="Panoramax/detect_face_plate_sign")
    parser.add_argument("--classifier-repo", default="Panoramax/classify_fr_road_signs")
    parser.add_argument("--detector-filename", default="yolo11l_panoramax.pt")
    parser.add_argument("--classifier-filename", default="best.pt")
    parser.add_argument("--detector-conf", type=float, default=0.5)
    parser.add_argument("--detector-imgsz", type=int, default=2048)
    parser.add_argument("--detector-batch", type=int, default=8)
    parser.add_argument("--classifier-imgsz", type=int, default=224)
    parser.add_argument("--classifier-batch", type=int, default=24)
    parser.add_argument("--crop-padding", type=float, default=0.1)
    parser.add_argument("--ray-length-m", type=float, default=18.0)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--max-faces", type=int)
    return parser.parse_args()


def resolve_path(value: pathlib.Path | None, default: pathlib.Path) -> pathlib.Path:
    path = value or default
    if path.is_absolute():
        return path
    return ROOT / path


def read_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_item_index(path: pathlib.Path) -> dict[str, dict[str, Any]]:
    payload = read_json(path)
    return {item["id"]: item for item in payload["items"]}


def load_face_records(manifest_path: pathlib.Path, item_index: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    payload = read_json(manifest_path)
    records = []
    for entry in payload["items"]:
        source = item_index.get(entry["source_id"])
        if source is None:
            continue
        for face in entry["faces"]:
            records.append(
                {
                    "source_id": entry["source_id"],
                    "source": source,
                    "source_path": entry["source_path"],
                    "face_name": face["face_name"],
                    "face_yaw": float(face["yaw"]),
                    "face_pitch": float(face["pitch"]),
                    "face_path": resolve_path(pathlib.Path(face["path"]), ROOT / face["path"]),
                    "face_rel_path": face["path"],
                    "face_size": int(face["size"]),
                }
            )
    return records


def batched(sequence: list[Any], size: int) -> list[list[Any]]:
    return [sequence[index : index + size] for index in range(0, len(sequence), size)]


def auto_device(requested: str) -> str:
    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda:0"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))


def wrap_degrees(value: float) -> float:
    wrapped = value % 360.0
    if wrapped < 0:
        wrapped += 360.0
    return wrapped


def face_horizontal_offset_degrees(center_x: float, image_width: int) -> float:
    normalized = ((center_x / image_width) * 2.0) - 1.0
    tangent = math.tan(math.radians(CUBE_FACE_FOV_DEGREES / 2.0))
    return math.degrees(math.atan(normalized * tangent))


def face_vertical_offset_degrees(center_y: float, image_height: int) -> float:
    normalized = ((center_y / image_height) * 2.0) - 1.0
    tangent = math.tan(math.radians(CUBE_FACE_FOV_DEGREES / 2.0))
    return -math.degrees(math.atan(normalized * tangent))


def destination_point(lon: float, lat: float, bearing_deg: float, distance_m: float) -> tuple[float, float]:
    angular_distance = distance_m / EARTH_RADIUS_METERS
    bearing = math.radians(bearing_deg)
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)

    lat2 = math.asin(
        math.sin(lat1) * math.cos(angular_distance)
        + math.cos(lat1) * math.sin(angular_distance) * math.cos(bearing)
    )
    lon2 = lon1 + math.atan2(
        math.sin(bearing) * math.sin(angular_distance) * math.cos(lat1),
        math.cos(angular_distance) - math.sin(lat1) * math.sin(lat2),
    )

    return math.degrees(lon2), math.degrees(lat2)


def sign_family(value: str | None) -> str:
    if not value:
        return "unknown"
    match = re.match(r"[A-Za-z]+", value)
    return match.group(0).upper() if match else value.upper()


def write_json(path: pathlib.Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def crop_bounds(
    box: tuple[float, float, float, float], image_width: int, image_height: int, padding_ratio: float
) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = box
    width = x2 - x1
    height = y2 - y1
    padding_x = width * padding_ratio
    padding_y = height * padding_ratio
    left = int(clamp(math.floor(x1 - padding_x), 0, image_width - 1))
    top = int(clamp(math.floor(y1 - padding_y), 0, image_height - 1))
    right = int(clamp(math.ceil(x2 + padding_x), left + 1, image_width))
    bottom = int(clamp(math.ceil(y2 + padding_y), top + 1, image_height))
    return left, top, right, bottom


def main() -> int:
    args = parse_args()

    dataset_dir = resolve_path(args.dataset_dir, DEFAULT_DATASET_DIR)
    manifest_path = resolve_path(
        args.manifest_path, dataset_dir / "cubemap_faces_horizontal" / "cubemap_horizontal_manifest.json"
    )
    items_path = resolve_path(args.items_path, dataset_dir / "downloaded_items.json")
    output_dir = resolve_path(args.output_dir, dataset_dir / "sign_inference")
    crops_dir = output_dir / "crops"
    if crops_dir.exists():
        shutil.rmtree(crops_dir)

    item_index = load_item_index(items_path)
    face_records = load_face_records(manifest_path, item_index)
    if args.max_faces:
        face_records = face_records[: args.max_faces]

    device = auto_device(args.device)
    detector_path = hf_hub_download(repo_id=args.detector_repo, filename=args.detector_filename)
    classifier_path = hf_hub_download(repo_id=args.classifier_repo, filename=args.classifier_filename)

    detector = YOLO(detector_path)
    classifier = YOLO(classifier_path)

    observations: list[dict[str, Any]] = []
    crops_to_classify: list[dict[str, Any]] = []

    print(f"Loaded {len(face_records)} faces from {manifest_path}")
    print(f"Using device: {device}")
    print("Running detection...")

    face_batches = batched(face_records, max(args.detector_batch, 1))
    processed_faces = 0
    for batch in face_batches:
        face_paths = [str(record["face_path"]) for record in batch]
        results = detector.predict(
            source=face_paths,
            conf=args.detector_conf,
            imgsz=args.detector_imgsz,
            batch=max(args.detector_batch, 1),
            device=device,
            verbose=False,
        )
        for record, result in zip(batch, results):
            processed_faces += 1
            if processed_faces == 1 or processed_faces % 25 == 0 or processed_faces == len(face_records):
                print(f"  processed faces: {processed_faces}/{len(face_records)}")

            image_width = int(result.orig_shape[1])
            image_height = int(result.orig_shape[0])
            if not result.boxes:
                continue

            face_image = Image.open(record["face_path"]).convert("RGB")
            for index, box in enumerate(result.boxes):
                cls_index = int(box.cls.item())
                detector_label = detector.names[cls_index]
                if detector_label in IGNORED_CLASSES:
                    continue

                detector_score = float(box.conf.item())
                x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
                crop_left, crop_top, crop_right, crop_bottom = crop_bounds(
                    (x1, y1, x2, y2), image_width, image_height, args.crop_padding
                )
                observation_id = f"{record['source_id']}__{record['face_name']}__{index:03d}"
                crop_rel_path = pathlib.Path("sign_inference") / "crops" / record["source_id"] / f"{observation_id}.jpg"
                crop_abs_path = dataset_dir / crop_rel_path
                crop_abs_path.parent.mkdir(parents=True, exist_ok=True)
                crop_image = face_image.crop((crop_left, crop_top, crop_right, crop_bottom))
                crop_image.save(crop_abs_path, quality=95)

                bbox_center_x = (x1 + x2) / 2.0
                bbox_center_y = (y1 + y2) / 2.0
                horizontal_offset = face_horizontal_offset_degrees(bbox_center_x, image_width)
                vertical_offset = face_vertical_offset_degrees(bbox_center_y, image_height)
                source_azimuth = float(record["source"].get("view_azimuth") or 0.0)
                world_azimuth = wrap_degrees(source_azimuth + record["face_yaw"] + horizontal_offset)
                ray_end_lon, ray_end_lat = destination_point(
                    float(record["source"]["lon"]),
                    float(record["source"]["lat"]),
                    world_azimuth,
                    args.ray_length_m,
                )

                observation = {
                    "observation_id": observation_id,
                    "source_id": record["source_id"],
                    "source_collection_id": record["source"]["collection_id"],
                    "source_provider_name": record["source"].get("provider_name"),
                    "source_datetime": record["source"]["datetime"],
                    "source_lon": float(record["source"]["lon"]),
                    "source_lat": float(record["source"]["lat"]),
                    "source_view_azimuth": record["source"].get("view_azimuth"),
                    "source_horizontal_accuracy": record["source"].get("horizontal_accuracy"),
                    "source_thumb_url": record["source"].get("thumb_url"),
                    "source_asset_url": record["source"].get("asset_url"),
                    "source_item_url": record["source"].get("source_item_url"),
                    "source_original_name": record["source"].get("original_name"),
                    "face_name": record["face_name"],
                    "face_yaw": record["face_yaw"],
                    "face_pitch": record["face_pitch"],
                    "face_path": record["face_rel_path"],
                    "face_size": record["face_size"],
                    "detector_class": detector_label,
                    "detector_score": detector_score,
                    "bbox_xyxy": [x1, y1, x2, y2],
                    "bbox_xywh_norm": [
                        (bbox_center_x / image_width),
                        (bbox_center_y / image_height),
                        ((x2 - x1) / image_width),
                        ((y2 - y1) / image_height),
                    ],
                    "bbox_center_offset_degrees": {
                        "horizontal": horizontal_offset,
                        "vertical": vertical_offset,
                    },
                    "world_azimuth": world_azimuth,
                    "ray_length_m": args.ray_length_m,
                    "ray_end_lon": ray_end_lon,
                    "ray_end_lat": ray_end_lat,
                    "crop_path": str(crop_rel_path),
                    "crop_size": [crop_right - crop_left, crop_bottom - crop_top],
                    "classification": None,
                }
                observations.append(observation)

                if detector_label in MAIN_SIGN_CLASSES:
                    crops_to_classify.append(
                        {
                            "observation_id": observation_id,
                            "crop_path": crop_abs_path,
                        }
                    )

    print(f"Detections found: {len(observations)}")
    print(f"Classifiable sign crops: {len(crops_to_classify)}")

    if crops_to_classify:
        crop_batches = batched(crops_to_classify, max(args.classifier_batch, 1))
        obs_index = {observation["observation_id"]: observation for observation in observations}
        processed_crops = 0
        print("Running classification...")
        for batch in crop_batches:
            results = classifier.predict(
                source=[str(entry["crop_path"]) for entry in batch],
                imgsz=args.classifier_imgsz,
                batch=max(args.classifier_batch, 1),
                device=device,
                verbose=False,
            )
            for entry, result in zip(batch, results):
                processed_crops += 1
                if processed_crops == 1 or processed_crops % 25 == 0 or processed_crops == len(crops_to_classify):
                    print(f"  processed crops: {processed_crops}/{len(crops_to_classify)}")

                top1_index = int(result.probs.top1)
                top1_label = classifier.names[top1_index]
                top1_conf = float(result.probs.top1conf.item())
                top5: list[dict[str, Any]] = []
                for class_index, confidence in zip(result.probs.top5, result.probs.top5conf.tolist()):
                    top5.append(
                        {
                            "label": classifier.names[int(class_index)],
                            "confidence": float(confidence),
                        }
                    )
                obs_index[entry["observation_id"]]["classification"] = {
                    "label": top1_label,
                    "confidence": top1_conf,
                    "family": sign_family(top1_label),
                    "top5": top5,
                }

    for observation in observations:
        if observation["classification"] is None:
            observation["classification_family"] = (
                "SUBSIGN" if observation["detector_class"] in SECONDARY_SIGN_CLASSES else "UNKNOWN"
            )
            observation["display_label"] = observation["detector_class"]
        else:
            observation["classification_family"] = observation["classification"]["family"]
            observation["display_label"] = observation["classification"]["label"]

    summary = {
        "dataset_dir": str(dataset_dir.relative_to(ROOT)),
        "device": device,
        "faces_processed": len(face_records),
        "observations_count": len(observations),
        "sign_count": sum(1 for observation in observations if observation["detector_class"] in MAIN_SIGN_CLASSES),
        "subsign_count": sum(
            1 for observation in observations if observation["detector_class"] in SECONDARY_SIGN_CLASSES
        ),
        "classified_count": sum(1 for observation in observations if observation["classification"] is not None),
        "sources_with_detections": len({observation["source_id"] for observation in observations}),
        "family_counts": dict(Counter(observation["classification_family"] for observation in observations).most_common()),
        "detector_repo": args.detector_repo,
        "classifier_repo": args.classifier_repo,
        "detector_conf": args.detector_conf,
        "detector_imgsz": args.detector_imgsz,
        "classifier_imgsz": args.classifier_imgsz,
        "ray_length_m": args.ray_length_m,
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "observations.json", {"items": observations})
    write_json(output_dir / "summary.json", summary)

    print(f"Wrote observations to {output_dir / 'observations.json'}")
    print(f"Wrote summary to {output_dir / 'summary.json'}")
    print(f"Saved crops under {crops_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
