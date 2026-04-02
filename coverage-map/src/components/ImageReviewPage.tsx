import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { formatConfidence, formatDate, formatDegrees, formatProviderLabel } from '../lib/coverage'
import { formatSignCode, formatSignFamily } from '../lib/signs'
import type { CoveragePreparedData, FacePreviewIndex, SignObservationProperties, SignPreparedData } from '../types'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

type ReviewPageProps = {
  sampleCoverage: CoveragePreparedData
  signData: SignPreparedData | null
  faceIndex: FacePreviewIndex
  onShowMap: () => void
  onShowReview: () => void
}

type ReviewEntry = {
  sourceId: string
  thumbnailUrl: string | null
  assetUrl: string | null
  sourceItemUrl: string | null
  originalName: string | null
  provider: string
  providerColor: string
  datetime: string
  collectionId: string
  lon: number
  lat: number
  azimuth: number | null
  horizontalAccuracy: number | null
  faceUrls: Partial<Record<'front' | 'right' | 'back' | 'left', string>>
  predictions: Array<{
    observationId: string
    cropUrl: string
    faceName: string
    worldAzimuth: number
    detectorScore: number
    classificationLabel: string | null
    classificationConfidence: number | null
    family: string
    bboxXyxy: number[]
    topClasses: Array<{ label: string; confidence: number }>
  }>
}

function topSummary(predictions: ReviewEntry['predictions']) {
  const counts = new Map<string, number>()
  for (const prediction of predictions) {
    const key = prediction.classificationLabel ?? prediction.family
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([label, count]) => `${formatSignCode(label)}${count > 1 ? ` ×${count}` : ''}`)
}

function buildEntries(sampleCoverage: CoveragePreparedData, signData: SignPreparedData | null, faceIndex: FacePreviewIndex) {
  const predictionsBySource = new Map<string, ReviewEntry['predictions']>()
  for (const feature of signData?.points.features ?? []) {
    const properties = feature.properties as SignObservationProperties | undefined
    if (!properties) {
      continue
    }

    const predictions = predictionsBySource.get(properties.sourceId) ?? []
    predictions.push({
      observationId: properties.observationId,
      cropUrl: properties.cropUrl,
      faceName: properties.faceName,
      worldAzimuth: properties.worldAzimuth,
      detectorScore: properties.detectorScore,
      classificationLabel: properties.classificationLabel,
      classificationConfidence: properties.classificationConfidence,
      family: properties.classificationFamily,
      bboxXyxy: properties.bboxXyxy,
      topClasses: properties.topClasses,
    })
    predictionsBySource.set(properties.sourceId, predictions)
  }

  return sampleCoverage.points.features.map((feature) => {
    const properties = feature.properties
    const predictions = (predictionsBySource.get(properties.id) ?? []).sort((left, right) => {
      const scoreDelta = (right.classificationConfidence ?? right.detectorScore) - (left.classificationConfidence ?? left.detectorScore)
      return scoreDelta !== 0 ? scoreDelta : left.faceName.localeCompare(right.faceName)
    })

    return {
      sourceId: properties.id,
      thumbnailUrl: properties.thumbUrl,
      assetUrl: properties.assetUrl,
      sourceItemUrl: properties.sourceItemUrl,
      originalName: properties.originalName,
      provider: properties.provider,
      providerColor: properties.providerColor,
      datetime: properties.datetime,
      collectionId: properties.collectionId,
      lon: properties.lon,
      lat: properties.lat,
      azimuth: properties.azimuth,
      horizontalAccuracy: properties.horizontalAccuracy,
      faceUrls: faceIndex[properties.id] ?? {},
      predictions,
    } satisfies ReviewEntry
  })
}

export function ImageReviewPage({ sampleCoverage, signData, faceIndex, onShowMap, onShowReview }: ReviewPageProps) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'detections' | 'date' | 'provider'>('detections')
  const [detectionsOnly, setDetectionsOnly] = useState(true)

  const entries = useMemo(() => buildEntries(sampleCoverage, signData, faceIndex), [faceIndex, sampleCoverage, signData])

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase()
    const next = entries.filter((entry) => {
      if (detectionsOnly && entry.predictions.length === 0) {
        return false
      }

      if (!query) {
        return true
      }

      const haystack = [
        entry.sourceId,
        entry.originalName,
        entry.collectionId,
        entry.provider,
        ...entry.predictions.flatMap((prediction) => [
          prediction.classificationLabel,
          formatSignCode(prediction.classificationLabel),
          formatSignFamily(prediction.family),
        ]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(query)
    })

    next.sort((left, right) => {
      if (sortBy === 'detections') {
        return right.predictions.length - left.predictions.length || right.datetime.localeCompare(left.datetime)
      }
      if (sortBy === 'provider') {
        return left.provider.localeCompare(right.provider) || right.datetime.localeCompare(left.datetime)
      }
      return right.datetime.localeCompare(left.datetime)
    })

    return next
  }, [detectionsOnly, entries, search, sortBy])

  return (
    <main className="app-shell review-shell">
      <aside className="sidebar review-sidebar">
        <div className="sidebar-inner">
          <div className="hero-panel">
            <p className="eyebrow">Panoramax Review</p>
            <div className="view-switch">
              <Button variant="ghost" size="sm" onClick={onShowMap}>
                Map
              </Button>
              <Button variant="default" size="sm" onClick={onShowReview}>
                Image Review
              </Button>
            </div>
            <h1>Image Review</h1>
            <p className="hero-copy">
              Scan source panoramas, expand one image at a time, and inspect grouped detection crops with their predicted French sign classes.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>Keep the page focused on the images that need review.</CardDescription>
            </CardHeader>
            <CardContent className="review-filter-stack">
              <label className="review-search-field">
                <Search aria-hidden="true" />
                <Input
                  placeholder="Search by sign code, source id, provider..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label className="review-inline-field">
                <span>Sort</span>
                <select className="review-select" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
                  <option value="detections">Most detections</option>
                  <option value="date">Most recent</option>
                  <option value="provider">Provider</option>
                </select>
              </label>
              <label className="toggle-card">
                <input type="checkbox" checked={detectionsOnly} onChange={(event) => setDetectionsOnly(event.target.checked)} />
                <span>Show only images with detections</span>
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Review Stats</CardTitle>
            </CardHeader>
            <CardContent className="review-stats-grid">
              <article className="stat-card">
                <span className="stat-label">Images</span>
                <strong>{filteredEntries.length.toLocaleString()}</strong>
              </article>
              <article className="stat-card">
                <span className="stat-label">Detections</span>
                <strong>{filteredEntries.reduce((sum, entry) => sum + entry.predictions.length, 0).toLocaleString()}</strong>
              </article>
            </CardContent>
          </Card>
        </div>
      </aside>

      <section className="review-stage">
        <div className="review-stage-inner">
          <div className="review-toolbar">
            <div>
              <p className="eyebrow">Sample Dataset</p>
              <h2>Panorama Review Queue</h2>
            </div>
            <Badge variant="muted">{filteredEntries.length} images</Badge>
          </div>

          <Accordion type="multiple" className="review-accordion">
            {filteredEntries.map((entry) => {
              const summary = topSummary(entry.predictions)

              return (
                <AccordionItem key={entry.sourceId} value={entry.sourceId}>
                  <AccordionTrigger>
                    <div className="review-row">
                      {entry.thumbnailUrl ? (
                        <img className="review-row-thumb" src={entry.thumbnailUrl} alt={entry.originalName ?? entry.sourceId} />
                      ) : (
                        <div className="review-row-thumb review-row-thumb-empty" />
                      )}
                      <div className="review-row-copy">
                        <div className="review-row-topline">
                          <strong>{entry.originalName ?? entry.sourceId}</strong>
                          <Badge variant={entry.predictions.length > 0 ? 'strong' : 'muted'}>
                            {entry.predictions.length} detection{entry.predictions.length === 1 ? '' : 's'}
                          </Badge>
                        </div>
                        <div className="review-row-meta">
                          <span>{formatProviderLabel(entry.provider)}</span>
                          <span>{formatDate(entry.datetime)}</span>
                          <span>{entry.collectionId}</span>
                        </div>
                        <div className="review-row-summary">
                          {summary.length > 0 ? summary.map((item) => <Badge key={`${entry.sourceId}-${item}`}>{item}</Badge>) : <Badge variant="muted">No sign prediction</Badge>}
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="review-detail-grid">
                      <Card>
                        <CardHeader>
                          <CardTitle>Source image</CardTitle>
                        </CardHeader>
                        <CardContent className="review-source-card">
                          {entry.thumbnailUrl && (
                            <img className="review-source-thumb" src={entry.thumbnailUrl} alt={entry.originalName ?? entry.sourceId} />
                          )}
                          <dl className="detail-grid">
                            <div>
                              <dt>Source id</dt>
                              <dd>{entry.sourceId}</dd>
                            </div>
                            <div>
                              <dt>Date</dt>
                              <dd>{formatDate(entry.datetime)}</dd>
                            </div>
                            <div>
                              <dt>Coordinates</dt>
                              <dd>
                                {entry.lon.toFixed(5)}, {entry.lat.toFixed(5)}
                              </dd>
                            </div>
                            <div>
                              <dt>Azimuth</dt>
                              <dd>{formatDegrees(entry.azimuth)}</dd>
                            </div>
                          </dl>
                          <div className="review-faces-grid">
                            {(['front', 'right', 'back', 'left'] as const).map((faceName) => {
                              const faceUrl = entry.faceUrls[faceName]
                              return faceUrl ? (
                                <figure key={`${entry.sourceId}-${faceName}`} className="review-face-card">
                                  <img src={faceUrl} alt={`${entry.sourceId} ${faceName} face`} />
                                  <figcaption>{faceName}</figcaption>
                                </figure>
                              ) : null
                            })}
                          </div>
                          <div className="detail-links">
                            {entry.assetUrl && (
                              <a href={entry.assetUrl} target="_blank" rel="noreferrer">
                                Open source image
                              </a>
                            )}
                            {entry.sourceItemUrl && (
                              <a href={entry.sourceItemUrl} target="_blank" rel="noreferrer">
                                Open STAC item
                              </a>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader>
                          <CardTitle>Predictions</CardTitle>
                          <CardDescription>Grouped by source panorama. Expand only when you need the crop details.</CardDescription>
                        </CardHeader>
                        <CardContent>
                          {entry.predictions.length === 0 ? (
                            <p className="subtle-note">No sign detections on this panorama with the current detector settings.</p>
                          ) : (
                            <div className="prediction-grid">
                              {entry.predictions.map((prediction) => (
                                <article key={prediction.observationId} className="prediction-card">
                                  <img className="prediction-crop" src={prediction.cropUrl} alt={prediction.classificationLabel ?? prediction.family} />
                                  <div className="prediction-copy">
                                    <div className="prediction-heading">
                                      <strong>{formatSignCode(prediction.classificationLabel ?? prediction.family)}</strong>
                                      <Badge>{formatConfidence(prediction.classificationConfidence ?? prediction.detectorScore)}</Badge>
                                    </div>
                                    <div className="prediction-meta">
                                      <span>{prediction.faceName}</span>
                                      <span>{formatDegrees(prediction.worldAzimuth)}</span>
                                      <span>{formatSignFamily(prediction.family)}</span>
                                    </div>
                                    {prediction.topClasses.length > 0 && (
                                      <div className="prediction-toplist">
                                        {prediction.topClasses.slice(0, 3).map((candidate) => (
                                          <div key={`${prediction.observationId}-${candidate.label}`} className="top-class-row">
                                            <span>{formatSignCode(candidate.label)}</span>
                                            <strong>{formatConfidence(candidate.confidence)}</strong>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </article>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        </div>
      </section>
    </main>
  )
}
