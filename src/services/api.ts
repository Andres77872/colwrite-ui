// Prefer relative base during development to avoid browser CORS via Vite proxy
export const API_BASE: string = (import.meta as any)?.env?.VITE_API_BASE ?? '/api';

function buildUrl(path: string): string {
  const base = API_BASE.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

async function handleJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    let msg = res.statusText;
    if (data) {
      if (typeof data.message === 'string') msg = data.message;
      else if (Array.isArray(data.detail)) {
        msg = data.detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ');
      } else if (typeof data.detail === 'string') msg = data.detail;
    }
    const err = new Error(msg);
    (err as any).status = res.status;
    (err as any).data = data;
    throw err;
  }
  return data as T;
}

export async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(buildUrl(path), { method: 'GET', credentials: 'include', ...init });
  return handleJson<T>(res);
}

export async function post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: path.startsWith('/auth/') ? 'omit' : 'include',
    ...init,
  });
  return handleJson<T>(res);
}

export async function put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
    ...init,
  });
  return handleJson<T>(res);
}

export async function del<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(buildUrl(path), { method: 'DELETE', credentials: 'include', ...init });
  return handleJson<T>(res);
}
