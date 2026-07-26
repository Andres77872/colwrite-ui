import { get, post } from './api';

export type LoginRequest = { username: string; password: string };

/**
 * Identity fields forwarded from the auth service. Every one of them is a
 * pass-through and may be absent, so none of them can be used as a success
 * signal — fall back to what the caller already knows.
 */
export type AuthUser = {
  user_hash?: string | null;
  username?: string | null;
  email?: string | null;
  user_type?: string | null;
};

/**
 * The access/refresh pair is delivered as HttpOnly cookies and deliberately
 * stripped from this body by the API, so there is no token field here and one
 * must not be added back. HTTP 200 is the success signal: the API only reaches
 * a 200 after both cookies were written. `authenticated` is the API's own
 * assertion of that and is the single field worth checking.
 */
export type LoginResponse = {
  authenticated?: boolean;
  /** Upstream pass-through, may be null — do not gate on it. */
  success?: boolean | null;
  /** Upstream free text ("Root user login successful"). Display only. */
  message?: string | null;
  user_id?: string | null;
  user?: AuthUser | null;
  project?: Record<string, unknown> | null;
  accessible_projects?: unknown[];
  /** Access-token lifetime in seconds. */
  expires_in?: number | null;
  expires_at?: string | null;
};

export async function login(req: LoginRequest): Promise<LoginResponse> {
  return post<LoginResponse>('/auth/login', req);
}

export async function logout(): Promise<void> {
  await post<{ success: boolean; message: string }>('/auth/logout');
}

/**
 * Note the shape: `/users/profile` is proxied straight through from the auth
 * service and returns the identity fields flat, not nested under `user` the
 * way the login response does.
 */
export type ProfileResponse = {
  success?: boolean | null;
  user_hash?: string | null;
  username?: string | null;
  email?: string | null;
  user_type?: string | null;
  is_active?: boolean | null;
};

/** Verify the session cookie is still good, and get the canonical identity. */
export async function getProfile(): Promise<ProfileResponse> {
  return get<ProfileResponse>('/users/profile', { suppressAuthEvent: true });
}
