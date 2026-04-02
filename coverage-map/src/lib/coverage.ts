export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function formatProviderLabel(value: string) {
  return value === 'unknown' ? 'Unknown Provider' : value
}
