# Panoramax 360 Download Technique

## Goal

Build a reproducible way to download Panoramax street-level imagery for a city or zone, then create a first test batch for object detection work.

This run targeted:

- Place: `Lège-Cap-Ferret, Gironde, France`
- Image type: mostly 360 images, enforced here as `field_of_view = 360`
- Requested sample size: `100`
- Downloaded asset quality: `hd`

## Files

- Downloader: `scripts/download_panoramax_city.py`
- Top-up utility: `scripts/top_up_downloads.py`
- Output directory: `output/l-ge-cap-ferret-gironde-france-fov-360`

Output manifests:

- `query.json`: resolved place and bbox used for the run
- `all_items.json`: all matched Panoramax items in the search zone
- `selected_items.json`: first sampled batch before download
- `downloaded_items.json`: final downloaded set
- `summary.json`: compact run summary
- `images/`: downloaded JPEG files

## Technique

The workflow is:

1. Geocode the place with Nominatim.
2. Take the municipal bounding box and expand it slightly to include nearby imagery.
3. Query Panoramax collections intersecting that bbox.
4. Paginate each collection's items.
5. Filter items locally:
   - point must be inside the expanded bbox
   - `properties["pers:interior_orientation"]["field_of_view"] == 360`
6. Build a collection-aware sample instead of taking consecutive frames from one sequence.
7. Download the requested asset quality and keep full metadata beside the images.

Why collection-first instead of only `/api/search`:

- it gives full area coverage
- it avoids relying on global search result ordering
- it makes it easier to sample across many capture sequences

## Concrete Run

Geocoded center:

- lat: `44.7951052`
- lon: `-1.1472098`

Nominatim municipal bbox:

- south: `44.6204375`
- north: `44.8287096`
- west: `-1.2613787`
- east: `-1.0500920`

Expanded search bbox used by the script:

- min lon: `-1.2813787`
- min lat: `44.6004375`
- max lon: `-1.0300920`
- max lat: `44.8487096`

Commands used:

```bash
python3 scripts/download_panoramax_city.py \
  --place 'Lège-Cap-Ferret, Gironde, France' \
  --padding 0.02 \
  --field-of-view 360 \
  --quality hd \
  --download-count 100
```

The first pass selected 100 items but only downloaded 93 because a small number of federated assets returned `403 Forbidden`.

To finish the batch without rescanning the city, I used:

```bash
python3 scripts/top_up_downloads.py \
  --output-dir output/l-ge-cap-ferret-gironde-france-fov-360 \
  --target-count 100 \
  --download-workers 2 \
  --download-retries 4
```

Then I removed extra cached replacements so the `images/` directory contains exactly the final 100 files listed in `downloaded_items.json`.

## Results

Area-wide 360 metadata scan:

- collections intersecting bbox: `347`
- collections with matching 360 items: `66`
- matching 360 items in bbox: `21,675`
- providers with matching items: `4`
- global datetime range in matches: `2024-06-03T06:15:06+00:00` to `2025-10-23T14:11:35+00:00`

Final downloaded sample:

- downloaded images: `100`
- unique collections represented: `48`
- unique providers represented: `2`
- sample datetime range: `2025-06-23T14:56:53+00:00` to `2025-10-23T14:11:13+00:00`
- providers in final sample:
  - `sogefi sig`: `76`
  - `coban`: `24`
- licenses in final sample:
  - `etalab-2.0`: `100`
- final image directory size: about `338M`

## Operational Note

Some items exposed by the federated metadata could not be downloaded from this environment and consistently returned `403` on `hd`, `sd`, and `thumb`.

Because of that, the practical approach is:

- scan metadata first
- attempt download
- retry blocked items
- replace permanently blocked items from the same area manifest until the target count is reached

## Reuse

To repeat this for another city:

1. Change `--place`
2. Keep or adjust `--padding`
3. Keep `--field-of-view 360` for 360-only imagery, or change it
4. Set `--download-count` to the batch size you want
5. Run the top-up utility if the first pass ends with fewer successful downloads than requested

## Final Output

The completed 100-image test set is here:

- `output/l-ge-cap-ferret-gironde-france-fov-360/images`

The final manifest for those 100 files is here:

- `output/l-ge-cap-ferret-gironde-france-fov-360/downloaded_items.json`
