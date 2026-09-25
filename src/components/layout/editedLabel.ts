import { relativeTime } from './relativeTime';

const DAY_MS = 24 * 3600 * 1000;

/**
 * "Edited 5 minutes ago", "Edited yesterday", "Edited Sep 20" or "Edited Sep
 * 20, 2025": relative while recent, then a short date — never a raw locale
 * timestamp with seconds.
 */
export function editedLabel(value: string | number | null | undefined, now = Date.now()): string {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return '';
  const age = now - time;
  if (age >= 0 && age < 2 * DAY_MS) return `Edited ${relativeTime(time, now)}`;
  return `Edited ${shortDate(date, now)}`;
}

/** "Sep 20", with the year only when it is not this year. */
export function shortDate(date: Date, now = Date.now()): string {
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "Sep 20, 8:32 AM": a full but readable timestamp for tooltips. */
export function shortDateTime(value: string | number | null | undefined, now = Date.now()): string {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${shortDate(date, now)}, ${time}`;
}
