#!/usr/bin/env python3
"""Create a horizontal-face subset from an existing cube-map folder."""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil


KEEP_FACES = ["front", "right", "back", "left"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=pathlib.Path,
        default=pathlib.Path("output/l-ge-cap-ferret-gironde-france-fov-360/cubemap_faces"),
    )
    parser.add_argument(
        "--output-dir",
        type=pathlib.Path,
        default=pathlib.Path("output/l-ge-cap-ferret-gironde-france-fov-360/cubemap_faces_horizontal"),
    )
    args = parser.parse_args()

    manifest_path = args.input_dir / "cubemap_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    items_out = []

    for index, item in enumerate(manifest["items"], start=1):
        dest_dir = args.output_dir / item["source_id"]
        dest_dir.mkdir(parents=True, exist_ok=True)

        kept_faces = []
        for face in item["faces"]:
            if face["face_name"] not in KEEP_FACES:
                continue
            src = pathlib.Path(face["path"])
            dst = dest_dir / src.name
            shutil.copy2(src, dst)

            face_copy = dict(face)
            face_copy["path"] = str(dst)
            kept_faces.append(face_copy)

        item_copy = dict(item)
        item_copy["faces"] = kept_faces
        items_out.append(item_copy)
        print(f"[horizontal] {index}/{len(manifest['items'])} {item['source_id']}")

    output_manifest = {
        "input_dir": str(args.input_dir),
        "output_dir": str(args.output_dir),
        "source_images": len(items_out),
        "faces_per_image": len(KEEP_FACES),
        "total_faces": len(items_out) * len(KEEP_FACES),
        "face_size": manifest["face_size"],
        "faces": [face for face in manifest["faces"] if face["name"] in KEEP_FACES],
        "items": items_out,
    }
    (args.output_dir / "cubemap_horizontal_manifest.json").write_text(
        json.dumps(output_manifest, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
