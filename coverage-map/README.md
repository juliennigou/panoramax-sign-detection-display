# Coverage Map

Small React + MapLibre app to visualize the coverage of the downloaded Panoramax panoramas.

## What It Shows

- panorama camera positions as map points
- route segments reconstructed from `collection_id` and `datetime`
- provider filtering
- selection details for a point or a route collection
- sample stats and the extraction bbox

The app currently uses precomputed frontend-friendly assets:

- `public/data/sample_points.geojson`
- `public/data/sample_lines.geojson`
- `public/data/sample_stats.json`
- `public/data/full_points.geojson`
- `public/data/full_lines.geojson`
- `public/data/full_stats.json`
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
```

That script reads the Panoramax output manifests and writes the precomputed map files into `coverage-map/public/data/`.

## Main Files

- `src/App.tsx`: map UI and interactions
- `src/lib/coverage.ts`: formatting helpers
- `src/types.ts`: map asset types
- `../scripts/generate_coverage_map_assets.py`: offline asset generator
