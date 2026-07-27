/**
 * Accept only absolute HTTP(S) links intended for explicit user navigation.
 *
 * Research-provider payloads are external data. Keeping this check at the
 * rendering boundary prevents `javascript:`/`data:` links and makes sure a
 * provider API URL can never be turned into a browser-facing resource link.
 */
export function safeExternalHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const providerApiHost = ['api', 'semanticscholar', 'org'].join('.');
    const normalizedHost = url.hostname.toLocaleLowerCase().replace(/\.+$/, '');
    if (normalizedHost === providerApiHost) return null;
    return url.toString();
  } catch {
    return null;
  }
}
