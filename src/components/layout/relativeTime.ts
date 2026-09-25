const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/**
 * "Edited 3 hours ago"-style wording for chrome that only needs a sense of
 * recency: the palette's recent documents, the page menu footer. Absolute
 * times stay in tooltips, where they are asked for.
 */
export function relativeTime(value: string | number | null | undefined, now = Date.now()): string {
  if (value === null || value === undefined || value === '') return '';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const seconds = Math.round((time - now) / 1000);
  if (Math.abs(seconds) < 60) return 'just now';
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}
