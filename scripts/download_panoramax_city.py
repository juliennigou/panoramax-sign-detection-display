#!/usr/bin/env python3
"""Download a sample of Panoramax images for a city-sized area.

This script:
1. Geocodes a place name with Nominatim.
2. Expands the returned bounding box by a configurable padding.
3. Lists Panoramax collections intersecting that bbox.
4. Downloads all collection items metadata, filters them locally in the bbox,
   and keeps only items matching the requested field of view.
5. Builds a collection-aware sample and downloads the requested asset quality.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from typing import Dict, Iterable, Iterator, List, Optional, Sequence, Tuple


PANORAMAX_API_BASE = "https://api.panoramax.xyz/api"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "panoramax-city-downloader/1.0 (+local script)"


def slugify(value: str) -> str:
    slug = value.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "panoramax-download"


def http_get_json(url: str, params: Optional[Dict[str, object]] = None, timeout: float = 60.0) -> dict:
    if params:
        query_items: List[Tuple[str, str]] = []
        for key, value in params.items():
            if value is None:
                continue
            if isinstance(value, (list, tuple)):
                query_items.append((key, ",".join(str(v) for v in value)))
            else:
                query_items.append((key, str(value)))
        query = urllib.parse.urlencode(query_items)
        url = f"{url}?{query}"

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def http_download(url: str, destination: pathlib.Path, timeout: float = 120.0) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response, destination.open("wb") as fh:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            fh.write(chunk)


def geocode_place(query: str, timeout: float = 30.0) -> dict:
    payload = http_get_json(
        NOMINATIM_URL,
        params={"q": query, "format": "jsonv2", "limit": 1},
        timeout=timeout,
    )
    if not payload:
        raise RuntimeError(f"Could not geocode place: {query}")
    return payload[0]


def expand_bbox(bbox: Sequence[float], padding: float) -> List[float]:
    south, north, west, east = bbox
    return [west - padding, south - padding, east + padding, north + padding]


def point_in_bbox(coordinates: Sequence[float], bbox: Sequence[float]) -> bool:
    lon, lat = coordinates[:2]
    min_lon, min_lat, max_lon, max_lat = bbox
    return min_lon <= lon <= max_lon and min_lat <= lat <= max_lat


def follow_next_link(payload: dict) -> Optional[str]:
    for link in payload.get("links", []):
        if link.get("rel") == "next":
            return link.get("href")
    return None


def iter_collection_items(api_base: str, collection_id: str, page_limit: int, timeout: float) -> Iterator[dict]:
    next_url = f"{api_base}/collections/{collection_id}/items?limit={page_limit}"
    while next_url:
        payload = http_get_json(next_url, timeout=timeout)
        for feature in payload.get("features", []):
            yield feature
        next_url = follow_next_link(payload)


def fetch_collections(api_base: str, bbox: Sequence[float], timeout: float) -> List[dict]:
    payload = http_get_json(
        f"{api_base}/collections",
        params={"bbox": ",".join(str(v) for v in bbox), "limit": 1000},
        timeout=timeout,
    )
    return payload.get("collections", [])


def normalize_item(item: dict, bbox: Sequence[float], quality: str) -> Optional[dict]:
    geometry = item.get("geometry") or {}
    coordinates = geometry.get("coordinates")
    if not coordinates or not point_in_bbox(coordinates, bbox):
        return None

    properties = item.get("properties") or {}
    interior = properties.get("pers:interior_orientation") or {}
    field_of_view = interior.get("field_of_view")
    assets = item.get("assets") or {}
    asset = assets.get(quality)
    if not asset:
        return None

    providers = item.get("providers") or []
    provider_name = None
    if providers:
        provider_name = providers[0].get("name")
    if not provider_name:
        provider_name = properties.get("geovisio:producer")

    return {
        "id": item.get("id"),
        "collection_id": item.get("collection"),
        "lon": coordinates[0],
        "lat": coordinates[1],
        "datetime": properties.get("datetime"),
        "license": properties.get("license"),
        "provider_name": provider_name,
        "field_of_view": field_of_view,
        "camera_model": interior.get("camera_model"),
        "camera_manufacturer": interior.get("camera_manufacturer"),
        "sensor_array_dimensions": interior.get("sensor_array_dimensions"),
        "focal_length": interior.get("focal_length"),
        "view_azimuth": properties.get("view:azimuth"),
        "horizontal_pixel_density": properties.get("panoramax:horizontal_pixel_density"),
        "horizontal_accuracy": properties.get("quality:horizontal_accuracy"),
        "annotations_count": len(properties.get("annotations") or []),
        "semantics_count": len(properties.get("semantics") or []),
        "original_name": properties.get("original_file:name"),
        "original_size": properties.get("original_file:size"),
        "asset_quality": quality,
        "asset_url": asset.get("href"),
        "asset_type": asset.get("type"),
        "thumb_url": (assets.get("thumb") or {}).get("href"),
        "sd_url": (assets.get("sd") or {}).get("href"),
        "hd_url": (assets.get("hd") or {}).get("href"),
        "source_item_url": next(
            (link.get("href") for link in item.get("links", []) if link.get("rel") == "self"),
            None,
        ),
    }


def fetch_collection_matches(
    api_base: str,
    collection: dict,
    bbox: Sequence[float],
    quality: str,
    field_of_view: int,
    page_limit: int,
    timeout: float,
) -> List[dict]:
    matched: List[dict] = []
    for item in iter_collection_items(api_base, collection["id"], page_limit=page_limit, timeout=timeout):
        normalized = normalize_item(item, bbox=bbox, quality=quality)
        if not normalized:
            continue
        if normalized["field_of_view"] != field_of_view:
            continue
        matched.append(normalized)
    return matched


def spaced_indices(length: int) -> List[int]:
    if length <= 0:
        return []
    if length == 1:
        return [0]

    result: List[int] = []
    seen = set()

    def visit(start: int, end: int) -> None:
        if start > end:
            return
        mid = (start + end) // 2
        if mid not in seen:
            result.append(mid)
            seen.add(mid)
        visit(start, mid - 1)
        visit(mid + 1, end)

    visit(0, length - 1)
    return result


def sample_items(items: Sequence[dict], target_count: int) -> List[dict]:
    if target_count <= 0 or not items:
        return []

    grouped: Dict[str, List[dict]] = defaultdict(list)
    for item in items:
        grouped[item["collection_id"]].append(item)

    for group in grouped.values():
        group.sort(key=lambda row: row["datetime"] or "")

    collection_order = sorted(
        grouped.keys(),
        key=lambda collection_id: grouped[collection_id][-1]["datetime"] or "",
        reverse=True,
    )

    per_collection_queues: Dict[str, List[dict]] = {}
    for collection_id in collection_order:
        group = grouped[collection_id]
        per_collection_queues[collection_id] = [group[index] for index in spaced_indices(len(group))]

    selected: List[dict] = []
    seen_ids = set()

    while len(selected) < target_count:
        made_progress = False
        for collection_id in collection_order:
            queue = per_collection_queues[collection_id]
            while queue:
                candidate = queue.pop(0)
                if candidate["id"] in seen_ids:
                    continue
                selected.append(candidate)
                seen_ids.add(candidate["id"])
                made_progress = True
                break
            if len(selected) >= target_count:
                break
        if not made_progress:
            break

    return selected


def write_json(path: pathlib.Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def candidate_assets(item: dict) -> List[Tuple[str, Optional[str]]]:
    preferred = item.get("asset_quality")
    ordered = [preferred]
    for fallback in ("hd", "sd", "thumb"):
        if fallback not in ordered:
            ordered.append(fallback)

    candidates: List[Tuple[str, Optional[str]]] = []
    for quality in ordered:
        if not quality:
            continue
        url = item.get(f"{quality}_url")
        if url:
            candidates.append((quality, url))
    return candidates


def download_one_item(
    item: dict,
    destination_dir: pathlib.Path,
    timeout: float,
    retries: int,
) -> dict:
    images_dir = destination_dir / "images"
    file_name = f"{item['id']}.jpg"
    file_path = images_dir / file_name

    if file_path.exists():
        enriched = dict(item)
        enriched["downloaded_path"] = str(file_path)
        enriched["downloaded_size"] = file_path.stat().st_size
        enriched["downloaded_asset_quality"] = item.get("asset_quality")
        enriched["downloaded_asset_url"] = item.get("asset_url")
        return enriched

    errors: List[str] = []
    for asset_quality, asset_url in candidate_assets(item):
        for attempt in range(1, retries + 1):
            try:
                http_download(asset_url, file_path, timeout=timeout)
            except urllib.error.HTTPError as exc:
                errors.append(f"{asset_quality} attempt {attempt}: HTTP {exc.code}")
                if file_path.exists():
                    file_path.unlink()
                if exc.code not in {403, 408, 429, 500, 502, 503, 504}:
                    break
                time.sleep(min(2 ** attempt, 10))
                continue
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{asset_quality} attempt {attempt}: {exc}")
                if file_path.exists():
                    file_path.unlink()
                time.sleep(min(2 ** attempt, 10))
                continue

            enriched = dict(item)
            enriched["downloaded_path"] = str(file_path)
            enriched["downloaded_size"] = file_path.stat().st_size
            enriched["downloaded_asset_quality"] = asset_quality
            enriched["downloaded_asset_url"] = asset_url
            return enriched

    raise RuntimeError("; ".join(errors) if errors else "No downloadable asset candidate")


def download_selected_items(
    items: Sequence[dict],
    destination_dir: pathlib.Path,
    timeout: float,
    max_workers: int,
    retries: int = 3,
) -> List[dict]:
    downloaded: List[dict] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(download_one_item, item, destination_dir, timeout, retries): item for item in items
        }
        for index, future in enumerate(concurrent.futures.as_completed(future_map), start=1):
            item = future_map[future]
            try:
                enriched = future.result()
            except Exception as exc:  # noqa: BLE001
                print(f"[download] failed for {item['id']}: {exc}", file=sys.stderr)
                continue
            downloaded.append(enriched)
            print(f"[download] {index}/{len(items)} {enriched['id']}", file=sys.stderr)

    downloaded.sort(key=lambda row: row["datetime"] or "", reverse=True)
    return downloaded


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--place", required=True, help="Place to geocode with Nominatim")
    parser.add_argument("--padding", type=float, default=0.02, help="Extra bbox padding in degrees")
    parser.add_argument("--api-base", default=PANORAMAX_API_BASE, help="Panoramax API base URL")
    parser.add_argument("--quality", default="hd", choices=["thumb", "sd", "hd"], help="Asset quality to download")
    parser.add_argument("--field-of-view", type=int, default=360, help="Requested field of view")
    parser.add_argument("--download-count", type=int, default=100, help="How many images to download")
    parser.add_argument("--collection-workers", type=int, default=8, help="Concurrent collection fetches")
    parser.add_argument("--download-workers", type=int, default=4, help="Concurrent image downloads")
    parser.add_argument("--download-retries", type=int, default=3, help="Retries per asset candidate")
    parser.add_argument("--page-limit", type=int, default=1000, help="Panoramax page size for collection items")
    parser.add_argument("--timeout", type=float, default=60.0, help="HTTP timeout in seconds")
    parser.add_argument(
        "--output-dir",
        type=pathlib.Path,
        default=None,
        help="Base output directory. Defaults to ./output/<slug>",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    place = geocode_place(args.place, timeout=args.timeout)
    raw_bbox = [float(value) for value in place["boundingbox"]]
    search_bbox = expand_bbox(raw_bbox, args.padding)

    output_dir = args.output_dir or pathlib.Path("output") / f"{slugify(args.place)}-fov-{args.field_of_view}"
    output_dir.mkdir(parents=True, exist_ok=True)

    write_json(
        output_dir / "query.json",
        {
            "place_query": args.place,
            "resolved_place": place["display_name"],
            "center": {"lat": float(place["lat"]), "lon": float(place["lon"])},
            "raw_boundingbox_nominatim": {
                "south": raw_bbox[0],
                "north": raw_bbox[1],
                "west": raw_bbox[2],
                "east": raw_bbox[3],
            },
            "search_bbox": {
                "min_lon": search_bbox[0],
                "min_lat": search_bbox[1],
                "max_lon": search_bbox[2],
                "max_lat": search_bbox[3],
            },
            "panoramax_api_base": args.api_base,
            "quality": args.quality,
            "field_of_view": args.field_of_view,
            "download_count": args.download_count,
        },
    )

    collections = fetch_collections(args.api_base, bbox=search_bbox, timeout=args.timeout)
    print(f"[collections] {len(collections)} collections intersect the bbox", file=sys.stderr)

    all_items: List[dict] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.collection_workers) as executor:
        futures = {
            executor.submit(
                fetch_collection_matches,
                args.api_base,
                collection,
                search_bbox,
                args.quality,
                args.field_of_view,
                args.page_limit,
                args.timeout,
            ): collection
            for collection in collections
        }
        for index, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            collection = futures[future]
            try:
                matches = future.result()
            except Exception as exc:  # noqa: BLE001
                print(f"[items] failed for collection {collection['id']}: {exc}", file=sys.stderr)
                continue
            if matches:
                all_items.extend(matches)
            if index % 25 == 0 or index == len(futures):
                print(
                    f"[items] processed {index}/{len(futures)} collections, matched {len(all_items)} items so far",
                    file=sys.stderr,
                )

    all_items.sort(key=lambda row: row["datetime"] or "", reverse=True)
    selected = sample_items(all_items, target_count=args.download_count)
    downloaded = download_selected_items(
        selected,
        destination_dir=output_dir,
        timeout=max(args.timeout, 120.0),
        max_workers=args.download_workers,
        retries=args.download_retries,
    )

    write_json(
        output_dir / "all_items.json",
        {
            "count": len(all_items),
            "items": all_items,
        },
    )
    write_json(
        output_dir / "selected_items.json",
        {
            "count": len(selected),
            "items": selected,
        },
    )
    write_json(
        output_dir / "downloaded_items.json",
        {
            "count": len(downloaded),
            "items": downloaded,
        },
    )

    collections_with_matches = len({item["collection_id"] for item in all_items})
    providers_with_matches = len({item["provider_name"] for item in all_items if item["provider_name"]})
    total_download_bytes = sum(item.get("downloaded_size", 0) for item in downloaded)
    summary = {
        "place_query": args.place,
        "resolved_place": place["display_name"],
        "collections_intersecting_bbox": len(collections),
        "collections_with_matching_items": collections_with_matches,
        "matching_items": len(all_items),
        "providers_with_matching_items": providers_with_matches,
        "selected_items": len(selected),
        "downloaded_items": len(downloaded),
        "downloaded_total_bytes": total_download_bytes,
        "downloaded_total_gb": round(total_download_bytes / (1024 ** 3), 3),
        "output_dir": str(output_dir),
    }
    write_json(output_dir / "summary.json", summary)
    print(json.dumps(summary, indent=2), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
