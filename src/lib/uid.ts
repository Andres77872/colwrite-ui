export function uid(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof (globalThis.crypto as any).randomUUID === 'function') {
    return (globalThis.crypto as any).randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
