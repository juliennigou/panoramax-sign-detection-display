# Coverage Map

React + MapLibre app to visualize Panoramax coverage plus sample sign detections.

## What It Shows

- panorama camera positions as map points
- route segments reconstructed from `collection_id` and `datetime`
- sample sign observation markers and directional rays
- provider filtering
- selection details for a panorama point, route, or sign observation
- sample stats and the extraction bbox

The app currently uses precomputed frontend-friendly assets:

- `public/data/sample_points.geojson`
- `public/data/sample_lines.geojson`
- `public/data/sample_stats.json`
- `public/data/full_points.geojson`
- `public/data/full_lines.geojson`
- `public/data/full_stats.json`
- `public/data/sample_sign_points.geojson`
- `public/data/sample_sign_rays.geojson`
- `public/data/sample_sign_summary.json`
- crop previews under `public/data/sign_previews/`
- query metadata from `public/data/query.json`
- summary metadata from `public/data/summary.json`
- OpenFreeMap Liberty as the basemap

## Run

```bash
cd coverage-map
pnpm install
pnpm dev
```

Then open the local Vite URL shown in the terminal.

## Build

```bash
cd coverage-map
pnpm build
pnpm preview
```

## Data Refresh

If you regenerate the Panoramax sample and want the app to use the new map assets, run:

```bash
python3 scripts/generate_coverage_map_assets.py
python3 scripts/run_sign_poc_inference.py
python3 scripts/generate_sign_map_assets.py
```

Those scripts read the Panoramax output manifests, run the Panoramax sign models on the horizontal faces, and write the precomputed frontend assets into `coverage-map/public/data/`.

## Main Files

- `src/App.tsx`: map UI and interactions
- `src/lib/coverage.ts`: formatting helpers
- `src/types.ts`: map asset types
- `../scripts/generate_coverage_map_assets.py`: offline asset generator
- `../scripts/run_sign_poc_inference.py`: detector/classifier pipeline
- `../scripts/generate_sign_map_assets.py`: sign overlay asset generator
