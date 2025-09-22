import { API_BASE } from './api';
import { emitRequireLogin } from './session';

function buildUrl(path: string): string {
  const base = API_BASE.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export async function streamAiBeat(
  req: { message: string; prompt?: string; documentId?: string },
  opts?: { signal?: AbortSignal; onChunk?: (delta: string) => void }
): Promise<void> {
  const body: any = { message: req.message, extras: { document_id: req.documentId ?? '' } };
  if (req.prompt) body.prompt = req.prompt;
  const res = await fetch(buildUrl('/aibeat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal: opts?.signal,
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      emitRequireLogin();
    }
    throw new Error(text || res.statusText);
  }
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      processLines(chunk.split(/\n/), opts?.onChunk);
    }
    const lastNl = buffer.lastIndexOf('\n');
    if (lastNl !== -1) {
      const lines = buffer.slice(0, lastNl).split(/\n/);
      buffer = buffer.slice(lastNl + 1);
      processLines(lines, opts?.onChunk);
    }
  }
  if (buffer.trim()) processLines(buffer.split(/\n/), opts?.onChunk);
}

function processLines(lines: string[], onChunk?: (delta: string) => void) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('data:')) {
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;
      try {
        const obj = JSON.parse(dataStr) as { content?: string };
        const delta = typeof obj.content === 'string' ? obj.content : '';
        if (delta && onChunk) onChunk(delta);
      } catch {
        // ignore
      }
      continue;
    }
    // fallback: raw text
    if (onChunk) onChunk(trimmed);
  }
}


