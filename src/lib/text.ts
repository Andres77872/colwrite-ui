/**
 * Truncate at the last sentence boundary inside `maxChars`, falling back to a
 * hard cut. Keeps abstract previews from ending mid-clause.
 */
export function truncateAtSentence(text: string | null | undefined, maxChars = 280): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const slice = trimmed.slice(0, maxChars);
  const lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  const cut = lastStop > maxChars / 2.5 ? slice.slice(0, lastStop + 1) : slice;
  return `${cut.trim()}…`;
}

/** Human-readable file size, e.g. `1.4 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/**
 * Stat-tile figure: exact below 10,000, compacted above (12.9K, 4.2M).
 *
 * The cutoff is where a thousands-separated number stops being read as a
 * quantity and starts being counted digit by digit.
 */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const magnitude = Math.abs(value);
  if (magnitude < 10_000) return value.toLocaleString();
  for (const [threshold, suffix] of [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ] as const) {
    if (magnitude >= threshold) {
      const scaled = value / threshold;
      // 12.9K but 129K — a decimal on a three-digit mantissa is noise — and
      // 34K rather than 34.0K, matching the chart axis formatter.
      const rounded = Number(scaled.toFixed(Math.abs(scaled) >= 100 ? 0 : 1));
      return `${rounded}${suffix}`;
    }
  }
  return value.toLocaleString();
}

/** Locale date for a possibly-missing/invalid timestamp; empty string if unusable. */
export function formatDate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

/** Locale date + time, used for "last updated" style metadata. */
export function formatDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

/** Plain-text word count for HTML block content. */
export function countWords(html: string): number {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, '')
    .trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}
