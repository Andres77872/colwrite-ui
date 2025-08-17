import { post } from './api';

export type LoginRequest = { username: string; password: string };

export type LoginResponse = {
  success: boolean;
  message: string;
  session_token: string;
  user: { username: string; email: string | null; user_type?: string | null };
  project?: Record<string, unknown> | null;
  accessible_projects?: unknown[];
  expires_at?: string | null;
};

export async function login(req: LoginRequest): Promise<LoginResponse> {
  // Do not send cookies on login requests
  return post<LoginResponse>('/auth/login', req, { credentials: 'omit' });
}

export function setSessionTokenCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 7): void {
  try {
    const secure = window.location.protocol === 'https:';
    const cookie = [
      `session_token=${encodeURIComponent(token)}`,
      `Path=/`,
      `Max-Age=${maxAgeSeconds}`,
      `SameSite=Lax`,
      secure ? 'Secure' : '',
    ].filter(Boolean).join('; ');
    document.cookie = cookie;
  } catch { /* no-op */ }
}

export function clearSessionTokenCookie(): void {
  try {
    document.cookie = 'session_token=; Path=/; Max-Age=0; SameSite=Lax';
  } catch { /* no-op */ }
}


