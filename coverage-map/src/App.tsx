import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { FilterSpecification, LngLatBoundsLike, MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './App.css'

import { formatConfidence, formatDate, formatDegrees, formatProviderLabel } from './lib/coverage'
import type {
  CoverageLineProperties,
  CoveragePointProperties,
  CoveragePreparedData,
  CoverageStats,
  QueryPayload,
  SignObservationProperties,
  SignPreparedData,
  SignSummary,
  SummaryPayload,
} from './types'

const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const EMPTY_FEATURE_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] }

type CoverageMode = 'sample' | 'full'

type InitialLoadState =
  | { status: 'loading' }
  | {
      status: 'ready'
      sampleCoverage: CoveragePreparedData
      query: QueryPayload
      summary: SummaryPayload
      signData: SignPreparedData | null
    }
  | { status: 'error'; message: string }

type FullLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; coverage: CoveragePreparedData }
  | { status: 'error'; message: string }

function fitPadding() {
  if (window.innerWidth < 1080) {
    return 48
  }

  return { top: 72, right: 72, bottom: 72, left: 420 }
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function popupMarkup(properties: CoveragePointProperties, detectionCount: number) {
  const thumb = properties.thumbUrl
    ? `<img class="popup-thumb" src="${escapeHtml(properties.thumbUrl)}" alt="${escapeHtml(properties.originalName ?? properties.id)}" />`
    : ''

  const links = [
    properties.assetUrl
      ? `<a href="${escapeHtml(properties.assetUrl)}" target="_blank" rel="noreferrer">image</a>`
      : '',
    properties.sourceItemUrl
      ? `<a href="${escapeHtml(properties.sourceItemUrl)}" target="_blank" rel="noreferrer">stac item</a>`
      : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const detectionLine =
    detectionCount > 0
      ? `<div class="popup-meta-row"><span>${escapeHtml(`${detectionCount} sign observation${detectionCount === 1 ? '' : 's'}`)}</span></div>`
      : ''

  return `<div class="popup-card popup-rich">
    ${thumb}
    <div class="popup-copy">
      <strong>${escapeHtml(formatProviderLabel(properties.provider))}</strong>
      <span>${escapeHtml(formatDate(properties.datetime))}</span>
      <code>${escapeHtml(properties.id)}</code>
      <div class="popup-meta-row">
        <span>${escapeHtml(properties.collectionId)}</span>
        <span>${escapeHtml(`${properties.lon.toFixed(5)}, ${properties.lat.toFixed(5)}`)}</span>
      </div>
      ${detectionLine}
      <div class="popup-links">${links}</div>
    </div>
  </div>`
}

function observationPopupMarkup(properties: SignObservationProperties) {
  const links = [
    properties.sourceAssetUrl
      ? `<a href="${escapeHtml(properties.sourceAssetUrl)}" target="_blank" rel="noreferrer">source image</a>`
      : '',
    properties.sourceItemUrl
      ? `<a href="${escapeHtml(properties.sourceItemUrl)}" target="_blank" rel="noreferrer">stac item</a>`
      : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const classifierLine = properties.classificationLabel
    ? `<div class="popup-meta-row">
        <span>${escapeHtml(properties.classificationLabel)}</span>
        <span>${escapeHtml(formatConfidence(properties.classificationConfidence))}</span>
      </div>`
    : ''

  return `<div class="popup-card popup-rich">
    <img class="popup-thumb popup-thumb-square" src="${escapeHtml(properties.cropUrl)}" alt="${escapeHtml(properties.displayLabel)}" />
    <div class="popup-copy">
      <strong>${escapeHtml(properties.displayLabel)}</strong>
      <span>${escapeHtml(`${properties.faceName} face · ${formatDegrees(properties.worldAzimuth)}`)}</span>
      <code>${escapeHtml(properties.observationId)}</code>
      <div class="popup-meta-row">
        <span>${escapeHtml(properties.detectorClass)}</span>
        <span>${escapeHtml(formatConfidence(properties.detectorScore))}</span>
      </div>
      ${classifierLine}
      <div class="popup-links">${links}</div>
    </div>
  </div>`
}

async function loadCoverageFiles(prefix: 'sample' | 'full'): Promise<CoveragePreparedData> {
  const [pointsResponse, linesResponse, statsResponse] = await Promise.all([
    fetch(`/data/${prefix}_points.geojson`),
    fetch(`/data/${prefix}_lines.geojson`),
    fetch(`/data/${prefix}_stats.json`),
  ])

  if (!pointsResponse.ok || !linesResponse.ok || !statsResponse.ok) {
    throw new Error(`${prefix} coverage assets could not be loaded.`)
  }

  const [points, lines, stats] = await Promise.all([
    pointsResponse.json(),
    linesResponse.json(),
    statsResponse.json() as Promise<CoverageStats>,
  ])

  return { points, lines, stats }
}

async function loadSignFiles(): Promise<SignPreparedData | null> {
  const [pointsResponse, raysResponse, summaryResponse] = await Promise.all([
    fetch('/data/sample_sign_points.geojson'),
    fetch('/data/sample_sign_rays.geojson'),
    fetch('/data/sample_sign_summary.json'),
  ])

  if (pointsResponse.status === 404 || raysResponse.status === 404 || summaryResponse.status === 404) {
    return null
  }

  if (!pointsResponse.ok || !raysResponse.ok || !summaryResponse.ok) {
    throw new Error('Sign inference assets could not be loaded.')
  }

  const [points, rays, summary] = await Promise.all([
    pointsResponse.json(),
    raysResponse.json(),
    summaryResponse.json() as Promise<SignSummary>,
  ])

  return { points, rays, summary }
}

function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)

  const [loadState, setLoadState] = useState<InitialLoadState>({ status: 'loading' })
  const [fullLoadState, setFullLoadState] = useState<FullLoadState>({ status: 'idle' })
  const [coverageMode, setCoverageMode] = useState<CoverageMode>('sample')
  const [selectedProvider, setSelectedProvider] = useState<string>('all')
  const [showPoints, setShowPoints] = useState(true)
  const [showRoutes, setShowRoutes] = useState(true)
  const [showSignMarkers, setShowSignMarkers] = useState(true)
  const [showSignRays, setShowSignRays] = useState(true)
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null)
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [sampleCoverage, queryResponse, summaryResponse, signData] = await Promise.all([
          loadCoverageFiles('sample'),
          fetch('/data/query.json'),
          fetch('/data/summary.json'),
          loadSignFiles(),
        ])

        if (!queryResponse.ok || !summaryResponse.ok) {
          throw new Error('Coverage metadata could not be loaded.')
        }

        const [query, summary] = await Promise.all([
          queryResponse.json() as Promise<QueryPayload>,
          summaryResponse.json() as Promise<SummaryPayload>,
        ])

        if (!cancelled) {
          setLoadState({ status: 'ready', sampleCoverage, query, summary, signData })
        }
      } catch (error) {
        if (!cancelled) {
          setLoadState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown loading error',
          })
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (coverageMode !== 'full' || fullLoadState.status !== 'idle') {
      return
    }

    let cancelled = false
    setFullLoadState({ status: 'loading' })

    async function loadFull() {
      try {
        const coverage = await loadCoverageFiles('full')
        if (!cancelled) {
          setFullLoadState({ status: 'ready', coverage })
        }
      } catch (error) {
        if (!cancelled) {
          setFullLoadState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown full coverage loading error',
          })
        }
      }
    }

    void loadFull()

    return () => {
      cancelled = true
    }
  }, [coverageMode, fullLoadState.status])

  const coverage = useMemo(() => {
    if (loadState.status !== 'ready') {
      return null
    }

    if (coverageMode === 'sample') {
      return loadState.sampleCoverage
    }

    if (fullLoadState.status === 'ready') {
      return fullLoadState.coverage
    }

    return null
  }, [coverageMode, fullLoadState, loadState])

  const signData = loadState.status === 'ready' ? loadState.signData : null

  const observationsBySourceId = useMemo(() => {
    const map = new globalThis.Map<string, NonNullable<SignPreparedData>['points']['features']>()
    if (!signData) {
      return map
    }

    for (const feature of signData.points.features) {
      const sourceId = feature.properties?.sourceId
      if (!sourceId) {
        continue
      }
      const items = map.get(sourceId)
      if (items) {
        items.push(feature)
      } else {
        map.set(sourceId, [feature])
      }
    }

    for (const features of map.values()) {
      features.sort((left, right) => (left.properties?.displayLabel ?? '').localeCompare(right.properties?.displayLabel ?? ''))
    }

    return map
  }, [signData])

  const observationCountBySourceId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const [sourceId, features] of observationsBySourceId.entries()) {
      counts.set(sourceId, features.length)
    }
    return counts
  }, [observationsBySourceId])

  const selectedPoint = useMemo(() => {
    if (!coverage || !selectedPointId) {
      return null
    }
    return coverage.points.features.find((feature) => feature.properties?.id === selectedPointId) ?? null
  }, [coverage, selectedPointId])

  const selectedCollection = useMemo(() => {
    if (!coverage || !selectedCollectionId) {
      return null
    }
    return coverage.lines.features.find((feature) => feature.properties?.collectionId === selectedCollectionId) ?? null
  }, [coverage, selectedCollectionId])

  const selectedObservation = useMemo(() => {
    if (!signData || !selectedObservationId) {
      return null
    }
    return signData.points.features.find((feature) => feature.properties?.observationId === selectedObservationId) ?? null
  }, [selectedObservationId, signData])

  const selectedSourceObservations = useMemo(() => {
    const sourceId = selectedObservation?.properties?.sourceId ?? selectedPointId
    if (!sourceId) {
      return []
    }
    return observationsBySourceId.get(sourceId) ?? []
  }, [observationsBySourceId, selectedObservation, selectedPointId])

  useEffect(() => {
    popupRef.current?.remove()
    setSelectedCollectionId(null)
    setSelectedPointId(null)
    setSelectedObservationId(null)
  }, [coverageMode])

  useEffect(() => {
    if (!mapContainerRef.current || !coverage || loadState.status !== 'ready' || mapRef.current) {
      return
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: BASEMAP_STYLE,
      center: [loadState.query.center.lon, loadState.query.center.lat],
      zoom: 11.7,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }))

    map.on('load', () => {
      map.addSource('coverage-routes', { type: 'geojson', data: coverage.lines })
      map.addSource('coverage-points', { type: 'geojson', data: coverage.points })
      map.addSource('selected-route', { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addSource('selected-point', { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addSource('sign-rays', { type: 'geojson', data: signData?.rays ?? EMPTY_FEATURE_COLLECTION })
      map.addSource('sign-points', { type: 'geojson', data: signData?.points ?? EMPTY_FEATURE_COLLECTION })
      map.addSource('selected-sign-ray', { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })
      map.addSource('selected-sign-point', { type: 'geojson', data: EMPTY_FEATURE_COLLECTION })

      map.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'coverage-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: showRoutes ? 'visible' : 'none' },
        paint: { 'line-color': ['get', 'providerColor'], 'line-opacity': 0.18, 'line-width': 10, 'line-blur': 5 },
      })

      map.addLayer({
        id: 'route-lines',
        type: 'line',
        source: 'coverage-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: showRoutes ? 'visible' : 'none' },
        paint: { 'line-color': ['get', 'providerColor'], 'line-opacity': 0.82, 'line-width': 3.25 },
      })

      map.addLayer({
        id: 'sign-ray-glow',
        type: 'line',
        source: 'sign-rays',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: { 'line-color': ['get', 'familyColor'], 'line-opacity': 0.14, 'line-width': 8, 'line-blur': 4 },
      })

      map.addLayer({
        id: 'sign-rays',
        type: 'line',
        source: 'sign-rays',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: {
          'line-color': ['get', 'familyColor'],
          'line-opacity': 0.72,
          'line-width': 2.4,
          'line-dasharray': [1.4, 1.15],
        },
      })

      map.addLayer({
        id: 'selected-route-line',
        type: 'line',
        source: 'selected-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fff7d6', 'line-width': 7, 'line-opacity': 0.98 },
      })

      map.addLayer({
        id: 'point-halo',
        type: 'circle',
        source: 'coverage-points',
        layout: { visibility: showPoints ? 'visible' : 'none' },
        paint: { 'circle-radius': 7, 'circle-color': '#fdfbf6', 'circle-opacity': 0.95 },
      })

      map.addLayer({
        id: 'point-dots',
        type: 'circle',
        source: 'coverage-points',
        layout: { visibility: showPoints ? 'visible' : 'none' },
        paint: {
          'circle-radius': 4.2,
          'circle-color': ['get', 'providerColor'],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#11233b',
        },
      })

      map.addLayer({
        id: 'selected-point-dot',
        type: 'circle',
        source: 'selected-point',
        paint: {
          'circle-radius': 8.5,
          'circle-color': '#fff7d6',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#11233b',
        },
      })

      map.addLayer({
        id: 'sign-point-halo',
        type: 'circle',
        source: 'sign-points',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 7,
          'circle-color': '#fff9ef',
          'circle-opacity': 0.9,
        },
      })

      map.addLayer({
        id: 'sign-points',
        type: 'circle',
        source: 'sign-points',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 4.5,
          'circle-color': ['get', 'familyColor'],
          'circle-stroke-width': 1.25,
          'circle-stroke-color': '#11233b',
        },
      })

      map.addLayer({
        id: 'selected-sign-ray',
        type: 'line',
        source: 'selected-sign-ray',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fff7d6', 'line-width': 5, 'line-opacity': 0.96 },
      })

      map.addLayer({
        id: 'selected-sign-point',
        type: 'circle',
        source: 'selected-sign-point',
        paint: {
          'circle-radius': 8.5,
          'circle-color': '#fff7d6',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#11233b',
        },
      })

      map.fitBounds(coverage.stats.mapBounds as LngLatBoundsLike, { padding: fitPadding(), duration: 0 })

      map.on('click', 'point-dots', (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0]
        if (!feature?.properties || feature.geometry.type !== 'Point') {
          return
        }

        const properties = feature.properties as unknown as CoveragePointProperties
        const coordinates = [...feature.geometry.coordinates] as [number, number]

        setSelectedPointId(properties.id)
        setSelectedCollectionId(properties.collectionId)
        setSelectedObservationId(null)

        popupRef.current?.remove()
        popupRef.current = new maplibregl.Popup({
          closeButton: false,
          closeOnMove: false,
          className: 'sample-popup',
          offset: 18,
          maxWidth: '320px',
        })
          .setLngLat(coordinates)
          .setHTML(popupMarkup(properties, observationCountBySourceId.get(properties.id) ?? 0))
          .addTo(map)
      })

      map.on('click', 'route-lines', (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0]
        if (!feature?.properties) {
          return
        }

        const properties = feature.properties as unknown as CoverageLineProperties
        setSelectedCollectionId(properties.collectionId)
        setSelectedPointId(null)
        setSelectedObservationId(null)
        popupRef.current?.remove()
      })

      const selectObservation = (properties: SignObservationProperties, coordinates: [number, number]) => {
        setSelectedObservationId(properties.observationId)
        setSelectedPointId(properties.sourceId)
        setSelectedCollectionId(properties.collectionId)

        popupRef.current?.remove()
        popupRef.current = new maplibregl.Popup({
          closeButton: false,
          closeOnMove: false,
          className: 'sample-popup',
          offset: 18,
          maxWidth: '320px',
        })
          .setLngLat(coordinates)
          .setHTML(observationPopupMarkup(properties))
          .addTo(map)
      }

      map.on('click', 'sign-points', (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0]
        if (!feature?.properties || feature.geometry.type !== 'Point') {
          return
        }

        const properties = feature.properties as unknown as SignObservationProperties
        const coordinates = [...feature.geometry.coordinates] as [number, number]
        selectObservation(properties, coordinates)
      })

      map.on('click', 'sign-rays', (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0]
        if (!feature?.properties || feature.geometry.type !== 'LineString') {
          return
        }

        const properties = feature.properties as unknown as SignObservationProperties
        const lastCoordinate = feature.geometry.coordinates[feature.geometry.coordinates.length - 1] as [number, number]
        selectObservation(properties, lastCoordinate)
      })

      for (const layerId of ['point-dots', 'route-lines', 'sign-points', 'sign-rays']) {
        map.on('mouseenter', layerId, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = ''
        })
      }
    })

    mapRef.current = map

    return () => {
      popupRef.current?.remove()
      popupRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [coverage, loadState, observationCountBySourceId, showPoints, showRoutes, signData])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !coverage) {
      return
    }

    ;(map.getSource('coverage-routes') as GeoJSONSource | undefined)?.setData(coverage.lines)
    ;(map.getSource('coverage-points') as GeoJSONSource | undefined)?.setData(coverage.points)
    ;(map.getSource('sign-rays') as GeoJSONSource | undefined)?.setData(signData?.rays ?? EMPTY_FEATURE_COLLECTION)
    ;(map.getSource('sign-points') as GeoJSONSource | undefined)?.setData(signData?.points ?? EMPTY_FEATURE_COLLECTION)

    const providerFilter: FilterSpecification | null =
      selectedProvider === 'all' ? null : (['==', ['get', 'provider'], selectedProvider] as FilterSpecification)

    const lineVisibility = showRoutes ? 'visible' : 'none'
    const pointVisibility = showPoints ? 'visible' : 'none'
    const signVisible = coverageMode === 'sample' && signData !== null
    const signPointVisibility = signVisible && showSignMarkers ? 'visible' : 'none'
    const signRayVisibility = signVisible && showSignRays ? 'visible' : 'none'

    if (map.getLayer('route-glow')) {
      map.setLayoutProperty('route-glow', 'visibility', lineVisibility)
      map.setFilter('route-glow', providerFilter)
    }
    if (map.getLayer('route-lines')) {
      map.setLayoutProperty('route-lines', 'visibility', lineVisibility)
      map.setFilter('route-lines', providerFilter)
    }
    if (map.getLayer('point-halo')) {
      map.setLayoutProperty('point-halo', 'visibility', pointVisibility)
      map.setFilter('point-halo', providerFilter)
    }
    if (map.getLayer('point-dots')) {
      map.setLayoutProperty('point-dots', 'visibility', pointVisibility)
      map.setFilter('point-dots', providerFilter)
    }
    if (map.getLayer('sign-ray-glow')) {
      map.setLayoutProperty('sign-ray-glow', 'visibility', signRayVisibility)
      map.setFilter('sign-ray-glow', providerFilter)
    }
    if (map.getLayer('sign-rays')) {
      map.setLayoutProperty('sign-rays', 'visibility', signRayVisibility)
      map.setFilter('sign-rays', providerFilter)
    }
    if (map.getLayer('sign-point-halo')) {
      map.setLayoutProperty('sign-point-halo', 'visibility', signPointVisibility)
      map.setFilter('sign-point-halo', providerFilter)
    }
    if (map.getLayer('sign-points')) {
      map.setLayoutProperty('sign-points', 'visibility', signPointVisibility)
      map.setFilter('sign-points', providerFilter)
    }

    ;(map.getSource('selected-route') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features:
        selectedCollectionId === null
          ? []
          : coverage.lines.features.filter((feature) => feature.properties?.collectionId === selectedCollectionId),
    })
    ;(map.getSource('selected-point') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features:
        selectedPointId === null
          ? []
          : coverage.points.features.filter((feature) => feature.properties?.id === selectedPointId),
    })
    ;(map.getSource('selected-sign-ray') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features:
        selectedObservationId === null || !signData
          ? []
          : signData.rays.features.filter((feature) => feature.properties?.observationId === selectedObservationId),
    })
    ;(map.getSource('selected-sign-point') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features:
        selectedObservationId === null || !signData
          ? []
          : signData.points.features.filter((feature) => feature.properties?.observationId === selectedObservationId),
    })
  }, [
    coverage,
    coverageMode,
    selectedCollectionId,
    selectedObservationId,
    selectedPointId,
    selectedProvider,
    showPoints,
    showRoutes,
    showSignMarkers,
    showSignRays,
    signData,
  ])

  const fitToCoverage = () => {
    if (!mapRef.current || !coverage) {
      return
    }
    mapRef.current.fitBounds(coverage.stats.mapBounds as LngLatBoundsLike, {
      padding: fitPadding(),
      duration: 900,
    })
  }

  if (loadState.status === 'loading') {
    return (
      <main className="app-shell loading-state">
        <div className="loading-card">
          <p className="eyebrow">Panoramax Coverage</p>
          <h1>Loading sample coverage</h1>
          <p>Preparing points, route segments, and inference overlays for the downloaded Lège-Cap-Ferret sample.</p>
        </div>
      </main>
    )
  }

  if (loadState.status === 'error') {
    return (
      <main className="app-shell loading-state">
        <div className="loading-card error-card">
          <p className="eyebrow">Panoramax Coverage</p>
          <h1>Map data failed to load</h1>
          <p>{loadState.message}</p>
        </div>
      </main>
    )
  }

  const fullModeBlocked = coverageMode === 'full' && fullLoadState.status === 'error'
  const coverageUnavailable = coverageMode === 'full' && fullLoadState.status !== 'ready'

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-inner">
          <div className="hero-panel">
            <p className="eyebrow">Panoramax Coverage</p>
            <h1>Route Footprint & Sign Review</h1>
            <p className="hero-copy">
              A 2D view of the sampled Lège-Cap-Ferret panoramas, with collection routes, inferred sign observations,
              and directional rays linked back to their source panoramas.
            </p>
            <div className="badge-row">
              <span className="pill pill-strong">{loadState.query.place_query}</span>
              <span className="pill">{coverageMode === 'sample' ? 'Sample mode' : 'Full mode'}</span>
              <span className="pill">{coverage?.stats.pointCount.toLocaleString() ?? '...'} visible images</span>
              {signData && <span className="pill">{signData.summary.observationsCount.toLocaleString()} sign observations</span>}
            </div>
          </div>

          <section className="panel">
            <div className="section-header">
              <h2>Coverage Mode</h2>
            </div>
            <div className="mode-switch">
              <button
                className={coverageMode === 'sample' ? 'mode-button active' : 'mode-button'}
                onClick={() => setCoverageMode('sample')}
              >
                Sample coverage
                <strong>{loadState.summary.downloaded_items.toLocaleString()}</strong>
              </button>
              <button
                className={coverageMode === 'full' ? 'mode-button active' : 'mode-button'}
                onClick={() => setCoverageMode('full')}
              >
                Full coverage
                <strong>{loadState.summary.matching_items.toLocaleString()}</strong>
              </button>
            </div>
            {coverageMode === 'full' && fullLoadState.status === 'loading' && (
              <p className="subtle-note">Loading precomputed full coverage layers and stats for the whole matched pool.</p>
            )}
            {fullModeBlocked && <p className="subtle-note subtle-note-error">{fullLoadState.message}</p>}
          </section>

          <section className="panel">
            <div className="section-header">
              <h2>Current Stats</h2>
              <button className="ghost-button" onClick={fitToCoverage} disabled={!coverage}>
                Fit Map
              </button>
            </div>
            <div className="stats-grid">
              <article className="stat-card">
                <span className="stat-label">Visible Images</span>
                <strong>{coverage?.stats.pointCount.toLocaleString() ?? '...'}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Collections</span>
                <strong>{coverage?.stats.collectionCount.toLocaleString() ?? '...'}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Providers</span>
                <strong>{coverage?.stats.providerCount.toLocaleString() ?? '...'}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Area Pool</span>
                <strong>{loadState.summary.matching_items.toLocaleString()}</strong>
              </article>
            </div>
            {coverage && (
              <p className="meta-line">
                Date span: <strong>{formatDate(coverage.stats.dateMin)}</strong> to{' '}
                <strong>{formatDate(coverage.stats.dateMax)}</strong>
              </p>
            )}
          </section>

          <section className="panel">
            <div className="section-header">
              <h2>Display</h2>
            </div>
            <div className="toggle-grid">
              <label className="toggle-card">
                <input type="checkbox" checked={showRoutes} onChange={(event) => setShowRoutes(event.target.checked)} />
                <span>Route lines</span>
              </label>
              <label className="toggle-card">
                <input type="checkbox" checked={showPoints} onChange={(event) => setShowPoints(event.target.checked)} />
                <span>Camera points</span>
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="section-header">
              <h2>Sign Inference</h2>
            </div>
            {signData ? (
              <>
                <div className="stats-grid">
                  <article className="stat-card">
                    <span className="stat-label">Observations</span>
                    <strong>{signData.summary.observationsCount.toLocaleString()}</strong>
                  </article>
                  <article className="stat-card">
                    <span className="stat-label">Main Signs</span>
                    <strong>{signData.summary.signCount.toLocaleString()}</strong>
                  </article>
                  <article className="stat-card">
                    <span className="stat-label">Sub-signs</span>
                    <strong>{signData.summary.subsignCount.toLocaleString()}</strong>
                  </article>
                  <article className="stat-card">
                    <span className="stat-label">Source Panos</span>
                    <strong>{signData.summary.sourcesWithDetections.toLocaleString()}</strong>
                  </article>
                </div>
                <p className="meta-line">
                  Sample-only inference currently uses {Math.round(signData.summary.rayLengthM)} m directional rays.
                </p>
                <div className="toggle-grid top-gap">
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={showSignMarkers}
                      onChange={(event) => setShowSignMarkers(event.target.checked)}
                      disabled={coverageMode !== 'sample'}
                    />
                    <span>Sign markers</span>
                  </label>
                  <label className="toggle-card">
                    <input
                      type="checkbox"
                      checked={showSignRays}
                      onChange={(event) => setShowSignRays(event.target.checked)}
                      disabled={coverageMode !== 'sample'}
                    />
                    <span>Direction rays</span>
                  </label>
                </div>
                <div className="family-chip-grid">
                  {signData.summary.familyStats.slice(0, 8).map((family) => (
                    <span key={family.family} className="family-chip" style={{ ['--chip-color' as string]: family.color }}>
                      <span className="color-swatch" />
                      <span>{family.family}</span>
                      <strong>{family.count}</strong>
                    </span>
                  ))}
                </div>
                {coverageMode !== 'sample' && (
                  <p className="subtle-note">Sign overlays are only rendered in sample mode until the full area is inferred.</p>
                )}
              </>
            ) : (
              <p className="subtle-note">No sign inference assets are present yet. Run the Python inference scripts to populate them.</p>
            )}
          </section>

          <section className="panel">
            <div className="section-header">
              <h2>Providers</h2>
            </div>
            <div className="provider-filter-grid">
              <button
                className={selectedProvider === 'all' ? 'provider-chip active all' : 'provider-chip all'}
                onClick={() => setSelectedProvider('all')}
                disabled={!coverage}
              >
                All providers
              </button>
              {coverage?.stats.providerStats.map((provider) => (
                <button
                  key={provider.provider}
                  className={selectedProvider === provider.provider ? 'provider-chip active' : 'provider-chip'}
                  onClick={() => setSelectedProvider(provider.provider)}
                  style={{ ['--chip-color' as string]: provider.color }}
                >
                  <span className="color-swatch" />
                  <span>{formatProviderLabel(provider.provider)}</span>
                  <strong>{provider.count.toLocaleString()}</strong>
                </button>
              ))}
            </div>
          </section>

          <section className="panel detail-panel">
            <div className="section-header">
              <h2>Selection</h2>
              {(selectedCollectionId || selectedPointId || selectedObservationId) && (
                <button
                  className="ghost-button"
                  onClick={() => {
                    setSelectedCollectionId(null)
                    setSelectedPointId(null)
                    setSelectedObservationId(null)
                    popupRef.current?.remove()
                  }}
                >
                  Clear
                </button>
              )}
            </div>
            {selectedObservation?.properties ? (
              <div className="detail-card detail-card-rich">
                <img
                  className="detail-thumb detail-thumb-square"
                  src={selectedObservation.properties.cropUrl}
                  alt={selectedObservation.properties.displayLabel}
                />
                <div className="detail-title-row">
                  <span className="detail-kicker">Sign observation</span>
                  <span
                    className="legend-dot"
                    style={{ background: selectedObservation.properties.familyColor ?? '#ef476f' }}
                  />
                </div>
                <strong>{selectedObservation.properties.displayLabel}</strong>
                <code>{selectedObservation.properties.observationId}</code>
                <dl className="detail-grid">
                  <div>
                    <dt>Detector</dt>
                    <dd>
                      {selectedObservation.properties.detectorClass} ·{' '}
                      {formatConfidence(selectedObservation.properties.detectorScore)}
                    </dd>
                  </div>
                  <div>
                    <dt>Face</dt>
                    <dd>{selectedObservation.properties.faceName}</dd>
                  </div>
                  <div>
                    <dt>World azimuth</dt>
                    <dd>{formatDegrees(selectedObservation.properties.worldAzimuth)}</dd>
                  </div>
                  <div>
                    <dt>Classifier</dt>
                    <dd>
                      {selectedObservation.properties.classificationLabel
                        ? `${selectedObservation.properties.classificationLabel} · ${formatConfidence(selectedObservation.properties.classificationConfidence)}`
                        : 'not classified'}
                    </dd>
                  </div>
                  <div>
                    <dt>Source panorama</dt>
                    <dd>{selectedObservation.properties.sourceId}</dd>
                  </div>
                  <div>
                    <dt>Coordinates</dt>
                    <dd>
                      {selectedObservation.properties.sourceLon.toFixed(5)},{' '}
                      {selectedObservation.properties.sourceLat.toFixed(5)}
                    </dd>
                  </div>
                </dl>
                {selectedObservation.properties.topClasses.length > 0 && (
                  <div className="top-classes">
                    {selectedObservation.properties.topClasses.map((candidate) => (
                      <div key={`${selectedObservation.properties.observationId}-${candidate.label}`} className="top-class-row">
                        <span>{candidate.label}</span>
                        <strong>{formatConfidence(candidate.confidence)}</strong>
                      </div>
                    ))}
                  </div>
                )}
                <div className="detail-links">
                  {selectedObservation.properties.sourceAssetUrl && (
                    <a href={selectedObservation.properties.sourceAssetUrl} target="_blank" rel="noreferrer">
                      Open source image
                    </a>
                  )}
                  {selectedObservation.properties.sourceItemUrl && (
                    <a href={selectedObservation.properties.sourceItemUrl} target="_blank" rel="noreferrer">
                      Open STAC item
                    </a>
                  )}
                </div>
              </div>
            ) : selectedPoint?.properties ? (
              <div className="detail-card detail-card-rich">
                {selectedPoint.properties.thumbUrl && (
                  <img
                    className="detail-thumb"
                    src={selectedPoint.properties.thumbUrl}
                    alt={selectedPoint.properties.originalName ?? selectedPoint.properties.id}
                  />
                )}
                <div className="detail-title-row">
                  <span className="detail-kicker">Panorama point</span>
                  <span
                    className="legend-dot"
                    style={{ background: selectedPoint.properties.providerColor ?? '#0f4c5c' }}
                  />
                </div>
                <strong>{formatProviderLabel(selectedPoint.properties.provider)}</strong>
                <code>{selectedPoint.properties.id}</code>
                <dl className="detail-grid">
                  <div>
                    <dt>Date</dt>
                    <dd>{formatDate(selectedPoint.properties.datetime)}</dd>
                  </div>
                  <div>
                    <dt>Collection</dt>
                    <dd>{selectedPoint.properties.collectionId}</dd>
                  </div>
                  <div>
                    <dt>Coordinates</dt>
                    <dd>
                      {selectedPoint.properties.lon.toFixed(5)}, {selectedPoint.properties.lat.toFixed(5)}
                    </dd>
                  </div>
                  <div>
                    <dt>Azimuth</dt>
                    <dd>{formatDegrees(selectedPoint.properties.azimuth)}</dd>
                  </div>
                  <div>
                    <dt>Accuracy</dt>
                    <dd>
                      {selectedPoint.properties.horizontalAccuracy ? `${selectedPoint.properties.horizontalAccuracy} m` : 'n/a'}
                    </dd>
                  </div>
                  <div>
                    <dt>Sign observations</dt>
                    <dd>{selectedSourceObservations.length}</dd>
                  </div>
                </dl>
                {selectedSourceObservations.length > 0 && (
                  <div className="observation-list">
                    {selectedSourceObservations.map((feature) => (
                      <button
                        key={feature.properties?.observationId}
                        className="observation-card"
                        onClick={() => setSelectedObservationId(feature.properties?.observationId ?? null)}
                      >
                        <img src={feature.properties?.cropUrl} alt={feature.properties?.displayLabel} />
                        <div>
                          <strong>{feature.properties?.displayLabel}</strong>
                          <span>
                            {feature.properties?.faceName} · {formatDegrees(feature.properties?.worldAzimuth)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="detail-links">
                  {selectedPoint.properties.assetUrl && (
                    <a href={selectedPoint.properties.assetUrl} target="_blank" rel="noreferrer">
                      Open image
                    </a>
                  )}
                  {selectedPoint.properties.sourceItemUrl && (
                    <a href={selectedPoint.properties.sourceItemUrl} target="_blank" rel="noreferrer">
                      Open STAC item
                    </a>
                  )}
                </div>
              </div>
            ) : selectedCollection?.properties ? (
              <div className="detail-card">
                <div className="detail-title-row">
                  <span className="detail-kicker">Route collection</span>
                  <span
                    className="legend-dot"
                    style={{ background: selectedCollection.properties.providerColor ?? '#0f4c5c' }}
                  />
                </div>
                <strong>{formatProviderLabel(selectedCollection.properties.provider)}</strong>
                <code>{selectedCollection.properties.collectionId}</code>
                <dl className="detail-grid">
                  <div>
                    <dt>Images</dt>
                    <dd>{selectedCollection.properties.pointCount}</dd>
                  </div>
                  <div>
                    <dt>Span</dt>
                    <dd>
                      {formatDate(selectedCollection.properties.startDatetime)} to{' '}
                      {formatDate(selectedCollection.properties.endDatetime)}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="detail-empty">
                <p>Click a route, panorama point, or sign marker to inspect linked metadata and inference results.</p>
              </div>
            )}
          </section>
        </div>
      </aside>

      <section className="map-stage">
        <div ref={mapContainerRef} className="map-canvas" />
        <div className="map-chrome">
          <div className="mini-panel">
            <span className="mini-label">Search bbox</span>
            <strong>
              {loadState.query.search_bbox.min_lon.toFixed(3)}, {loadState.query.search_bbox.min_lat.toFixed(3)} to{' '}
              {loadState.query.search_bbox.max_lon.toFixed(3)}, {loadState.query.search_bbox.max_lat.toFixed(3)}
            </strong>
          </div>
        </div>
        {coverageUnavailable && !fullModeBlocked && (
          <div className="map-overlay">
            <div className="overlay-card">
              <p className="eyebrow">Full Coverage</p>
              <h2>Loading the full area view</h2>
              <p>The browser is only fetching precomputed points, lines, and stats now, not rebuilding the full dataset client-side.</p>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
