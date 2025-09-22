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

