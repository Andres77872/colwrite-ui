import { buildUrl, del, get, post, put } from './api';

/**
 * The application-owned user surface (`/users/me`).
 *
 * Distinct from `./auth`, which proxies the auth service. Nothing here is a
 * credential: the identity block echoes the session the API already
 * validated, and every other field is data ColWrite stores itself. Username,
 * email, and password are owned by the auth service and are rejected by
 * `updateProfile` on the server, so they are absent from these types.
 */

export type UserIdentity = {
  user_id: string;
  username: string;
  user_type: string;
};

export type UserProfile = {
  user_id: string;
  username: string;
  display_name: string | null;
  headline: string | null;
  affiliation: string | null;
  bio: string | null;
  locale: string;
  timezone: string;
  avatar_url: string | null;
  preferences: Record<string, unknown> | null;
  last_seen_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type UsageSummary = {
  documents_active: number;
  documents_deleted: number;
  first_document_at: string | null;
  last_document_at: string | null;
  document_saves: number;
  chats_total: number;
  chat_messages_total: number;
  agent_runs_total: number;
  agent_runs_completed: number;
  agent_runs_failed: number;
  last_agent_run_at: string | null;
  tokens_input: number;
  tokens_output: number;
  llm_calls_total: number;
  tool_calls_total: number;
  tool_calls_failed: number;
  uploads_active: number;
  uploads_bytes: number;
  last_upload_at: string | null;
};

/** One day of activity. Days with none are absent from the series. */
export type ActivityDay = {
  day: string;
  document_events: number;
  agent_run_events: number;
  upload_events: number;
};

export type ToolUsage = {
  tool_name: string;
  call_count: number;
  error_count: number;
  avg_duration_ms: number;
  last_used_at: string | null;
};

export type UserDocument = {
  /** The MongoDB id, i.e. what `/document/load` and `switchTo` accept. */
  document_id: string;
  name: string;
  version: number;
  created_at: string | null;
  updated_at: string | null;
  chat_count: number;
  agent_run_count: number;
  save_count: number;
  upload_count: number;
};

export type UploadItem = {
  id: number;
  filename: string;
  content_type: string;
  byte_size: number;
  checksum_sha256: string;
  document_id: string | null;
  document_name: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type UserOverview = {
  identity: UserIdentity;
  profile: UserProfile;
  summary: UsageSummary;
  activity: ActivityDay[];
  tools: ToolUsage[];
  documents: UserDocument[];
  uploads: UploadItem[];
};

export type ProfileUpdate = Partial<{
  display_name: string;
  headline: string;
  affiliation: string;
  bio: string;
  locale: string;
  timezone: string;
  avatar_url: string;
  preferences: Record<string, unknown>;
}>;

/**
 * The whole dashboard in one request.
 *
 * Each endpoint revalidates the session with the auth service, so assembling
 * this page from five calls would cost five round trips to render it once.
 */
export async function getOverview(days = 30): Promise<UserOverview> {
  return get<UserOverview>(`/users/me/overview?days=${encodeURIComponent(days)}`);
}

/** Update the application-owned profile. Absent fields are left alone. */
export async function updateProfile(
  changes: ProfileUpdate,
): Promise<{ identity: UserIdentity; profile: UserProfile }> {
  return put<{ identity: UserIdentity; profile: UserProfile }>('/users/me', changes);
}

export async function listUserDocuments(
  limit = 20,
  offset = 0,
): Promise<{ documents: UserDocument[]; count: number }> {
  return get<{ documents: UserDocument[]; count: number }>(
    `/users/me/documents?limit=${limit}&offset=${offset}`,
  );
}

export async function listUploads(
  limit = 20,
  offset = 0,
): Promise<{ uploads: UploadItem[]; count: number }> {
  return get<{ uploads: UploadItem[]; count: number }>(
    `/users/me/uploads?limit=${limit}&offset=${offset}`,
  );
}

/** Store a PDF, optionally attaching it to one of the user's documents. */
export async function uploadPdf(
  file: File,
  documentId?: string,
): Promise<{ upload: UploadItem }> {
  const form = new FormData();
  form.append('file', file);
  if (documentId) form.append('document_id', documentId);
  return post<{ upload: UploadItem }>('/users/me/uploads', form);
}

export async function deleteUpload(uploadId: number): Promise<void> {
  await del<{ status: string; message: string }>(`/users/me/uploads/${uploadId}`);
}

/**
 * Same-origin URL for an upload's bytes.
 *
 * The session cookie rides along on a normal navigation, so this can be used
 * directly as an `href` — no blob download dance needed.
 */
export function uploadContentUrl(uploadId: number): string {
  return buildUrl(`/users/me/uploads/${uploadId}/content`);
}
