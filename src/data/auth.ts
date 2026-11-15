import { authApi, sessionCheckApi, unwrap } from '@/api/client';
import type {
  AuthSessionResponse,
  LoginRequest as WireLoginRequest,
  UserMeResponse,
} from '@/api/schema';

export type LoginRequest = Pick<WireLoginRequest, 'username' | 'password'>;

/**
 * The access/refresh pair is delivered as HttpOnly cookies and deliberately
 * stripped from this body by the API, so there is no token field here and one
 * must not be added back. HTTP 200 is the success signal: the API only reaches
 * a 200 after both cookies were written. `authenticated` is the API's own
 * assertion of that and is the single field worth checking.
 */
export type LoginResponse = AuthSessionResponse;

/**
 * Sign in. A 401 here is a wrong password, not an expired session, so it
 * neither refreshes nor signs anyone out: the caller reports it.
 */
export async function login(req: LoginRequest): Promise<LoginResponse> {
  return unwrap(authApi.POST('/auth/login', { body: { ...req, remember_me: false } }));
}

export async function logout(): Promise<void> {
  await unwrap(authApi.POST('/auth/logout'));
}

/** The signed-in person: `identity` (name, email, type) and the profile ColWrite keeps. */
export type MeResponse = UserMeResponse;

/** Verify the session cookie is still good, and get the canonical identity. */
export async function getMe(): Promise<MeResponse> {
  return unwrap(sessionCheckApi.GET('/users/me'));
}
