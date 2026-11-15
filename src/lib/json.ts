/** A JSON object read from somewhere the type system cannot vouch for. */
export type UnknownRecord = Record<string, unknown>;

/** Whether *value* is a plain object: not `null`, not an array. */
export function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
