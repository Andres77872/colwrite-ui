import { get, put } from './api';
import type { CollectionItem, ResourceItem } from './resources';

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
  resources_active: number;
  resources_bytes: number;
  last_resource_at: string | null;
  resources_extracted: number;
  collections_active: number;
};

/** One day of activity. Days with none are absent from the series. */
export type ActivityDay = {
  day: string;
  document_events: number;
  agent_run_events: number;
  resource_events: number;
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
  resource_count: number;
};

export type UserOverview = {
  identity: UserIdentity;
  profile: UserProfile;
  summary: UsageSummary;
  activity: ActivityDay[];
  tools: ToolUsage[];
  documents: UserDocument[];
  resources: ResourceItem[];
  collections: CollectionItem[];
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

/*
 * There is deliberately no upload API here.
 *
 * `listUploads` / `uploadPdf` / `deleteUpload` / `uploadContentUrl` / the
 * `UploadItem` alias all used to live in this file as one-line wrappers over
 * `resources.ts`. They gave the app two words — "upload" and "resource" — for
 * one row, which then leaked into the UI copy: the dashboard said "Uploaded
 * PDFs" while the tiles beside it said "Resources". Call `resources.ts`
 * directly.
 */
