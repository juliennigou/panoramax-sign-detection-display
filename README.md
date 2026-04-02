# Panoramax Sign Detection Display

Prototype workspace for building an end-to-end street-sign detection workflow on top of Panoramax imagery.

Current scope:

- download Panoramax 360 street-level imagery for a target area
- derive cube-map and horizontal-face datasets from panoramas
- run Panoramax road-sign detection and classification on horizontal faces
- build a 2D coverage map UI for inspecting coverage, detections, and directional rays

## Structure

- `scripts/`: Python utilities for download, cube extraction, horizontal-face subsets, and precomputed map assets
- `coverage-map/`: React + MapLibre app for visualizing route coverage
- `PANORAMAX_LEGE_CAP_FERRET_360.md`: notes about the initial Lège-Cap-Ferret dataset acquisition

## Sign Inference

The current POC uses the published Panoramax Hugging Face models:

- detector: `Panoramax/detect_fr_road_signs_subsigns`
- classifier: `Panoramax/classify_fr_road_signs`

Run the sample inference on the horizontal cube faces with:

```bash
python3 -m pip install ultralytics==8.3.224 torchvision==0.22.1
python3 scripts/run_sign_poc_inference.py
python3 scripts/generate_sign_map_assets.py
```

That writes:

- enriched observation records under `output/.../sign_inference/`
- crop previews and map-ready sign layers under `coverage-map/public/data/`

## Coverage Map

The map app lives in `coverage-map/`.

Run it with:

```bash
cd coverage-map
pnpm install
pnpm dev
```

If you regenerate the Panoramax dataset and want to refresh the frontend map layers:

```bash
python3 scripts/generate_coverage_map_assets.py
python3 scripts/generate_sign_map_assets.py
```

## Notes

Large downloaded imagery and intermediate outputs are intentionally ignored from Git. The repository keeps the code, docs, and lightweight prepared map assets needed to reproduce the workflow and run the UI.
