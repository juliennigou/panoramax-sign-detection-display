#!/usr/bin/env python3
"""Extract six cube-map faces from equirectangular panoramas."""

from __future__ import annotations

import argparse
import json
import math
import pathlib
from typing import Dict, Iterable, List

import cv2
import numpy as np


FACE_SPECS = [
    {"name": "front", "yaw": 0.0, "pitch": 0.0},
    {"name": "right", "yaw": 90.0, "pitch": 0.0},
    {"name": "back", "yaw": 180.0, "pitch": 0.0},
    {"name": "left", "yaw": -90.0, "pitch": 0.0},
    {"name": "up", "yaw": 0.0, "pitch": 90.0},
    {"name": "down", "yaw": 0.0, "pitch": -90.0},
]


def rotation_matrix(yaw_deg: float, pitch_deg: float) -> np.ndarray:
    yaw = math.radians(yaw_deg)
    pitch = math.radians(-pitch_deg)

    rot_y = np.array(
        [
            [math.cos(yaw), 0.0, math.sin(yaw)],
            [0.0, 1.0, 0.0],
            [-math.sin(yaw), 0.0, math.cos(yaw)],
        ],
        dtype=np.float32,
    )
    rot_x = np.array(
        [
            [1.0, 0.0, 0.0],
            [0.0, math.cos(pitch), -math.sin(pitch)],
            [0.0, math.sin(pitch), math.cos(pitch)],
        ],
        dtype=np.float32,
    )
    return rot_y @ rot_x


def build_remap(face_size: int, width: int, height: int, yaw_deg: float, pitch_deg: float) -> tuple[np.ndarray, np.ndarray]:
    coords = np.linspace(-1.0, 1.0, face_size, dtype=np.float32)
    xx, yy = np.meshgrid(coords, coords)

    rays = np.stack([xx, -yy, np.ones_like(xx)], axis=-1)
    rays /= np.linalg.norm(rays, axis=-1, keepdims=True)

    rotated = rays @ rotation_matrix(yaw_deg, pitch_deg).T
    rotated /= np.linalg.norm(rotated, axis=-1, keepdims=True)

    lon = np.arctan2(rotated[..., 0], rotated[..., 2])
    lat = np.arcsin(np.clip(rotated[..., 1], -1.0, 1.0))

    map_x = ((lon / (2.0 * math.pi)) + 0.5) * width
    map_y = (0.5 - lat / math.pi) * height

    map_x = np.mod(map_x, width).astype(np.float32)
    map_y = np.clip(map_y, 0, height - 1).astype(np.float32)
    return map_x, map_y


def load_manifest(path: pathlib.Path) -> List[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["items"]


def extract_faces(image_path: pathlib.Path, output_dir: pathlib.Path, face_size: int) -> List[dict]:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Could not read image: {image_path}")

    height, width = image.shape[:2]
    per_image_dir = output_dir / image_path.stem
    per_image_dir.mkdir(parents=True, exist_ok=True)

    written: List[dict] = []
    for spec in FACE_SPECS:
        map_x, map_y = build_remap(face_size, width, height, spec["yaw"], spec["pitch"])
        face = cv2.remap(image, map_x, map_y, interpolation=cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)

        face_path = per_image_dir / f"{spec['name']}.jpg"
        if not cv2.imwrite(str(face_path), face, [int(cv2.IMWRITE_JPEG_QUALITY), 95]):
            raise RuntimeError(f"Could not write face: {face_path}")

        written.append(
            {
                "face_name": spec["name"],
                "yaw": spec["yaw"],
                "pitch": spec["pitch"],
                "path": str(face_path),
                "size": face_size,
            }
        )
    return written


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=pathlib.Path,
        default=pathlib.Path("output/l-ge-cap-ferret-gironde-france-fov-360"),
        help="Run directory containing downloaded_items.json and images/",
    )
    parser.add_argument(
        "--output-subdir",
        default="cubemap_faces",
        help="Folder created under --input-dir for the extracted faces",
    )
    parser.add_argument(
        "--face-size",
        type=int,
        default=0,
        help="Cube face size in pixels. Default 0 means infer from the panorama height / 2.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest = load_manifest(args.input_dir / "downloaded_items.json")
    images_dir = args.input_dir / "images"
    output_dir = args.input_dir / args.output_subdir
    output_dir.mkdir(parents=True, exist_ok=True)

    results: List[dict] = []
    inferred_face_size = args.face_size

    for index, item in enumerate(manifest, start=1):
        image_path = images_dir / f"{item['id']}.jpg"
        if not image_path.exists():
            raise RuntimeError(f"Missing source image for manifest item: {item['id']}")

        if inferred_face_size <= 0:
            probe = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
            if probe is None:
                raise RuntimeError(f"Could not read image: {image_path}")
            inferred_face_size = probe.shape[0] // 2

        faces = extract_faces(image_path, output_dir=output_dir, face_size=inferred_face_size)
        results.append(
            {
                "source_id": item["id"],
                "source_path": str(image_path),
                "source_datetime": item.get("datetime"),
                "source_collection_id": item.get("collection_id"),
                "source_provider_name": item.get("provider_name"),
                "source_license": item.get("license"),
                "faces": faces,
            }
        )
        print(f"[cubemap] {index}/{len(manifest)} {item['id']}")

    payload = {
        "input_dir": str(args.input_dir),
        "output_dir": str(output_dir),
        "source_images": len(results),
        "faces_per_image": len(FACE_SPECS),
        "total_faces": len(results) * len(FACE_SPECS),
        "face_size": inferred_face_size,
        "faces": FACE_SPECS,
        "items": results,
    }
    (output_dir / "cubemap_manifest.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
