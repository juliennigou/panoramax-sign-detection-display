# Sign Detection POC Plan

## Goal

Build a proof of concept that:

1. ingests Panoramax street-level imagery for a target area
2. derives horizontal cube faces from 360 panoramas
3. detects French road signs
4. classifies detected signs
5. links results back to source panorama metadata
6. displays results on a 2D map
7. prepares for later object localization on the map

## Current Status

Already implemented:

- area ingestion from Panoramax
- metadata manifests for source panoramas
- cube-map extraction
- horizontal face subset
- sample/full coverage map UI

Missing layers:

- sign detection inference
- sign classification inference
- result storage for detections and classifications
- localization logic for map display
- detection overlays in the app

## Model Strategy

For the POC, use a 2-stage pipeline:

1. detection
   - model: `Panoramax/detect_fr_road_signs_subsigns`
   - output: bounding boxes for `sign` and `sub-sign`

2. classification
   - model: `Panoramax/classify_fr_road_signs`
   - input: crops from `sign` detections
   - output: French road sign class and confidence

Reasoning:

- it is immediately usable with published Panoramax models
- it is easier to debug than a single all-in-one model
- it fits the current face-based preprocessing pipeline
- it is sufficient for a first end-to-end demonstration

## End-to-End Pipeline

### 1. Source Panorama

One Panoramax source image with metadata such as:

- `id`
- `lon`
- `lat`
- `datetime`
- `collection_id`
- `provider_name`
- `view_azimuth`

### 2. Derived Face

One horizontal face derived from a panorama:

- `front`
- `right`
- `back`
- `left`

Each face stays linked to the source panorama and has a known yaw offset:

- `front = 0`
- `right = 90`
- `back = 180`
- `left = -90`

### 3. Detection

One detector output on one face:

- detection id
- source panorama id
- face name
- bounding box
- detector score
- detector class (`sign` or `sub-sign`)

### 4. Classification

One classifier output for a cropped detection:

- detection id
- predicted sign class
- confidence
- optional top-k classes

### 5. Map Feature

One app-ready representation for visualization:

- camera point
- later: directional ray
- later: triangulated point

## Recommended Stored Artifacts

### `faces_manifest`

Stores:

- source panorama id
- face name
- face yaw offset
- face file path

### `detections`

Stores:

- detection id
- source panorama id
- face name
- bbox
- detector score
- detector class
- crop path

### `classifications`

Stores:

- detection id
- predicted sign class
- classification score
- optional top-k

### `map_features`

Stores app-ready layers:

- camera points
- detection rays
- later triangulated sign points

For the POC, JSONL is acceptable. If the pipeline grows, parquet is a better long-term format.

## POC Inference Workflow

### Detection

Run detection on:

- `front`
- `right`
- `back`
- `left`

### Classification

Classify:

- only detections labeled `sign`

For `sub-sign`:

- keep them in metadata
- do not fully solve them in version 1

### Merge

Produce one enriched observation record per detected sign candidate by joining:

- source panorama metadata
- face metadata
- detection result
- classification result

## Localization Strategy

### Level 1: Camera Point

Attach detections to the source panorama location only.

Usefulness:

- good for debugging
- not a real object location

### Level 2: Directional Ray

For each detection:

- start from source panorama `lon/lat`
- combine source panorama azimuth
- add face yaw offset
- add horizontal offset from bbox center in the face

Result:

- a world bearing
- a ray or sector on the map

This is the recommended localization target for the POC.

### Level 3: Triangulated Sign Point

Later:

- match same sign across multiple nearby panoramas
- intersect rays
- estimate a true map point

This is not required for the first POC.

## What The App Should Show

### Existing Base Layers

- coverage points
- route lines

### Detection Review Layers

Next additions:

- sign observation markers linked to source panoramas
- directional rays from source panoramas

### Click / Review Panel

For a selected detection, show:

- source panorama metadata
- face used
- detection crop
- predicted sign class
- detector/classifier confidence

## Operational Batch Stages

Organize implementation as separate jobs:

1. `ingest_area`
2. `derive_faces`
3. `detect_signs`
4. `classify_signs`
5. `prepare_map_assets`
6. `review_in_app`

Reason:

- some stages will be rerun much more often than others
- this keeps the pipeline inspectable and easy to debug

## What Not To Do Yet

Do not prioritize yet:

- one-model end-to-end detector/classifier
- exact triangulated sign positioning
- multi-view sign deduplication
- sub-sign semantic parsing
- final GIS inventory generation

These are later steps after the core POC is validated.

## Main Risks

- detector false positives
- classifier confusion on similar French sign classes
- duplicate detections across adjacent faces
- duplicate detections across nearby panoramas
- imperfect localization if heading metadata is noisy

This is why a strong review UI is part of the plan, not an optional extra.

## Recommended Milestones

1. Run detection + classification on the 100-image sample.
2. Store enriched sign observations linked to source panoramas.
3. Add sign observation review to the map app.
4. Add directional ray display.
5. Then consider full-area inference.
