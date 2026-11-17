/**
 * A random v4 UUID. `crypto.randomUUID` exists only in secure contexts
 * (HTTPS or localhost), so a page opened over the local network
 * (http://192.168.…) builds the same shape from `getRandomValues`.
 */
export function uid(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    // The version (4) and variant (10xx) bits.
    const hex = Array.from(bytes, (byte, index) => {
      const value = index === 6 ? (byte & 0x0f) | 0x40 : index === 8 ? (byte & 0x3f) | 0x80 : byte;
      return value.toString(16).padStart(2, '0');
    }).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return Math.random().toString(36).slice(2);
}
