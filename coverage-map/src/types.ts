import type { FeatureCollection, LineString, Point } from 'geojson'

export type ProviderStat = {
  provider: string
  count: number
  color: string
}

export type CoverageStats = {
  pointCount: number
  collectionCount: number
  providerCount: number
  dateMin: string
  dateMax: string
  providerStats: ProviderStat[]
  mapBounds: [[number, number], [number, number]]
}

export type CoveragePointProperties = {
  id: string
  collectionId: string
  provider: string
  providerColor: string
  datetime: string
  azimuth: number | null
  cameraModel: string | null
  horizontalAccuracy: number | null
  lon: number
  lat: number
  license: string | null
  thumbUrl: string | null
  assetUrl: string | null
  sourceItemUrl: string | null
  originalName: string | null
  annotationsCount: number
  semanticsCount: number
  downloadedPath?: string | null
}

export type CoverageLineProperties = {
  collectionId: string
  provider: string
  providerColor: string
  startDatetime: string
  endDatetime: string
  pointCount: number
}

export type CoveragePoints = FeatureCollection<Point, CoveragePointProperties>
export type CoverageLines = FeatureCollection<LineString, CoverageLineProperties>

export type CoveragePreparedData = {
  points: CoveragePoints
  lines: CoverageLines
  stats: CoverageStats
}

export type FamilyStat = {
  family: string
  count: number
  color: string
}

export type SignSummary = {
  observationsCount: number
  signCount: number
  subsignCount: number
  classifiedCount: number
  sourcesWithDetections: number
  rayLengthM: number
  familyStats: FamilyStat[]
}

export type SignTopClass = {
  label: string
  confidence: number
}

export type SignObservationProperties = {
  observationId: string
  sourceId: string
  collectionId: string
  provider: string
  datetime: string
  sourceLon: number
  sourceLat: number
  sourceAzimuth: number | null
  horizontalAccuracy: number | null
  faceName: string
  faceYaw: number
  detectorClass: string
  detectorScore: number
  classificationLabel: string | null
  classificationConfidence: number | null
  classificationFamily: string
  displayLabel: string
  familyColor: string
  worldAzimuth: number
  rayLengthM: number
  cropUrl: string
  sourceThumbUrl: string | null
  sourceAssetUrl: string | null
  sourceItemUrl: string | null
  sourceOriginalName: string | null
  bboxXyxy: number[]
  bboxXywhNorm: number[]
  topClasses: SignTopClass[]
}

export type SignObservationPoints = FeatureCollection<Point, SignObservationProperties>
export type SignObservationRays = FeatureCollection<LineString, SignObservationProperties>

export type SignPreparedData = {
  points: SignObservationPoints
  rays: SignObservationRays
  summary: SignSummary
}

export type QueryPayload = {
  place_query: string
  resolved_place: string
  center: { lat: number; lon: number }
  search_bbox: {
    min_lon: number
    min_lat: number
    max_lon: number
    max_lat: number
  }
}

export type SummaryPayload = {
  downloaded_items: number
  matching_items: number
  collections_with_matching_items: number
  collections_intersecting_bbox: number
}
