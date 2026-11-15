import { ApiError } from './errors';

/**
 * Public search services that are not ColWrite-api: the arXiv text search
 * (`VITE_ARZ_API`) and the ColPali page search (`VITE_COLPALI_BASE`). They take
 * a form and answer JSON. No ColWrite credentials go to them, so nothing here
 * refreshes a session or signs anyone out.
 */
export async function postExternalForm(url: string, form: FormData | URLSearchParams): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json' },
    body: form,
    credentials: 'omit',
    mode: 'cors',
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string' && data.message
      ? data.message
      : response.statusText || 'Search failed';
    throw new ApiError(message, response.status, data);
  }
  return data;
}
