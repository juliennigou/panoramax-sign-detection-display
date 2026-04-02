# Panoramax Sign Detection Display

Prototype workspace for building an end-to-end street-sign detection workflow on top of Panoramax imagery.

Current scope:

- download Panoramax 360 street-level imagery for a target area
- derive cube-map and horizontal-face datasets from panoramas
- build a 2D coverage map UI for inspecting sampled and full route coverage
- prepare the project for future sign detection and map display workflows

## Structure

- `scripts/`: Python utilities for download, cube extraction, horizontal-face subsets, and precomputed map assets
- `coverage-map/`: React + MapLibre app for visualizing route coverage
- `PANORAMAX_LEGE_CAP_FERRET_360.md`: notes about the initial Lège-Cap-Ferret dataset acquisition

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
```

## Notes

Large downloaded imagery and intermediate outputs are intentionally ignored from Git. The repository keeps the code, docs, and lightweight prepared map assets needed to reproduce the workflow and run the UI.
