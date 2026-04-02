export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function formatProviderLabel(value: string) {
  return value === 'unknown' ? 'Unknown Provider' : value
}

export function formatDegrees(value: number | null | undefined) {
  return value === null || value === undefined ? 'n/a' : `${Math.round(value)}°`
}

export function formatConfidence(value: number | null | undefined) {
  return value === null || value === undefined ? 'n/a' : `${Math.round(value * 100)}%`
}
