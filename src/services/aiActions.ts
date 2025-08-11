import { API_BASE } from './api';

export type AiAction = 'search-for-references' | 'add-details' | 'more-concise';

export type AiActionRequest = {
  message: string;
  action: AiAction;
};

export type AiActionChunk = {
  content?: string;
  extras?: unknown | null;
};

function buildUrl(path: string): string {
  const base = API_BASE.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

// Stream AI action response. Calls onChunk with incremental content pieces.
export async function streamAiAction(
  req: AiActionRequest,
  opts?: { signal?: AbortSignal; onChunk?: (delta: string, chunk: AiActionChunk) => void }
): Promise<void> {
  const res = await fetch(buildUrl('/ai_actions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(req),
    signal: opts?.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
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

    // Handle Server-Sent Events style or newline-delimited payloads
    // Expect lines like: "data: {\"content\": \"...\", \"extras\": null}"
    let idx: number;
    // Process complete event blocks separated by double newlines if present
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      processLines(chunk.split(/\n/), opts?.onChunk);
    }

    // If no double newline, still try to process single lines safely
    const lastNl = buffer.lastIndexOf('\n');
    if (lastNl !== -1) {
      const lines = buffer.slice(0, lastNl).split(/\n/);
      buffer = buffer.slice(lastNl + 1);
      processLines(lines, opts?.onChunk);
    }
  }

  // Flush any remaining line
  if (buffer.trim()) {
    processLines(buffer.split(/\n/), opts?.onChunk);
  }
}

function processLines(lines: string[], onChunk?: (delta: string, chunk: AiActionChunk) => void) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('data:')) {
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;
      try {
        const obj = JSON.parse(dataStr) as AiActionChunk;
        const delta = typeof obj.content === 'string' ? obj.content : '';
        if (delta && onChunk) onChunk(delta, obj);
      } catch {
        // Ignore lines we cannot parse
      }
      continue;
    }

    // Fallback: try parse whole line as JSON
    try {
      const obj = JSON.parse(trimmed) as AiActionChunk;
      const delta = typeof obj.content === 'string' ? obj.content : '';
      if (delta && onChunk) onChunk(delta, obj);
    } catch {
      // Ignore
    }
  }
}
