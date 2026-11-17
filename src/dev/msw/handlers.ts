/**
 * The mock ColWrite-api: MSW handlers typed by the contract through
 * `openapi-msw`, so a handler for a path the API does not have, a wrong
 * parameter or a response of the wrong shape does not compile.
 *
 * The same handlers serve the dev preview (`src/dev/preview.ts`, through
 * MSW's service worker) and Vitest (`src/__tests__/server.ts`, through
 * `msw/node`). A test replaces one with `server.use(http.get(…))`.
 *
 * They read and write the fixture state in `./fixtures`: two workspaces, and
 * every tenant route under `/workspaces/{w}` as the API has them. Where the
 * contract is looser than the API, the rules follow ColWrite-api's routes: a
 * workspace the account is not in, and a page, chat, PDF or collection of
 * another workspace, is not found; a save over a stale `If-Match` is 412
 * `stale_head`; a list pages by cursor, sorts and filters as the API does; a
 * decision is recorded once.
 */
import { HttpResponse, http as untypedHttp } from 'msw';
import { createOpenApiHttp } from 'openapi-msw';
import { API_BASE } from '@/api/url';
import { uid } from '@/lib/uid';
import { MockAssetError, detachChatAssets, linkPageAssets, prepareImageBlocks, readableAsset, storeAsset, validAssetId } from './assets';
import { storedZip } from '@/export/zip';
import { confirmGeneration, generationQuota, generationQuote, generationState, proposeGeneration } from './imageGenerations';
import type {
  AuthSessionResponse,
  ChangeSetDecisionsRequest,
  ChangeSetResponse,
  DocumentStateResponse,
  ErrorCode,
  paths,
  ProblemDetails,
  ReferenceRecordOutput,
  ImageGenerationInfo,
} from '@/api/schema';
import {
  GATEWAY_MODELS,
  blockChanges,
  bumpTree,
  byKey,
  byName,
  collectionEtagOf,
  keyAt,
  orderedCollections,
  pagesHomedIn,
  placeDocument,
  placementEtagOf,
  sortModeOf,
  syncSettingGrant,
  treeVersionOf,
  workspaceEtagOf,
  type Position,
  type SortMode,
  changeSetResponse,
  changeSetsOf,
  chatSummary,
  chatsOf,
  collectionChildren,
  collectionDetail,
  collectionPath,
  collectionSubtree,
  collectionSummary,
  contentOf,
  documentsIn,
  etagOf,
  fixtures,
  headOf,
  historyOf,
  isSeededRevision,
  liveDocument,
  me,
  messageChain,
  newestMessage,
  pdfItem,
  pdfRow,
  pdfsIn,
  purgeAfterOf,
  purgeRoot,
  recordRevision,
  restoreCollectionTree,
  restorePage,
  restorePdf,
  startJob,
  startReferenceAudit,
  aiUseEntries,
  jobResult,
  jobState,
  liveCollections,
  collectionTrashPreview,
  trashCollectionTree,
  trashPage,
  trashPdf,
  trashRoots,
  trashRootCounts,
  PREVIEW_USER_ID,
  resetFixtures,
  seededChanges,
  paperByKey,
  paperDetail,
  paperGraph,
  paperPassages,
  paperSearch,
  type MockPaper,
  summaryOf,
  catalogOf,
  usageOf,
  accountUsageOf,
  copyPage,
  deletedWorkspaces,
  exportWorkspace,
  liveWorkspace,
  OPEN_POLICY,
  workspaceCollection,
  workspaceDetail,
  workspaceDocument,
  workspacePolicyOf,
  workspaceSummary,
  type StoredWorkspace,
  type StoredChangeSet,
  type StoredCollection,
  type StoredDocument,
  type StoredPdf,
  type WireBlock,
  grantStateOf,
  VERIFIED_EMAILS,
  emailHint,
  membersOf,
  ownIdentity,
  ownMembership,
  pendingInvitations,
  roleOf,
  transferOf,
  type StoredInvitation,
  type WorkspaceRole,
} from './fixtures';
import { mockAnchorText } from './reviews';
import { assistantSocket, previewRuns, resetAssistantSockets } from './socket';
import { assistantSettingsOf, updateAccountSwitches, MOCK_DEPLOYMENT, REGISTRY as ASSISTANT_REGISTRY } from './assistantCatalog';
import { FEDUS, LEPIKHIN, OKAFOR, SHAZEER, VASWANI } from '../fixtureReferences';
import { MOCK_VENUES, claimCheckResult, renderStatement } from './references';
import { MockPlanRefusal, planEtag, planOf, updatePlan } from './plans';

/** The works the mock's registries resolve besides what its paper sources hold: the fixture page's. */
const KNOWN_WORKS = [VASWANI, FEDUS, LEPIKHIN, SHAZEER, OKAFOR];

type Json = Record<string, unknown>;

/* ----------------------------------------
   Typed `http`, and the API's problem bodies
   ---------------------------------------- */

type ProxiedPaths = { [P in keyof paths as P extends `/api/${string}` ? never : P]: paths[P] };
type AgentPaths = { [P in keyof paths as P extends `/api/${string}` ? P : never]: paths[P] };

/** Handlers for the API's routes, under the base the client calls (`API_BASE`). */
export const http = createOpenApiHttp<ProxiedPaths>({ baseUrl: API_BASE });

/**
 * Handlers for the routes the API serves at `/api/agent/*` itself, which the
 * `/api` dev proxy forwards unchanged (`resolveApiPath`).
 */
export const agentHttp = createOpenApiHttp<AgentPaths>({
  baseUrl: API_BASE.endsWith('/api') ? API_BASE.slice(0, -'/api'.length) : API_BASE,
});

/** Each registry code's status and whether it is retryable (`ColWrite-api/src/errors/registry.py`). */
const REGISTRY: Record<ErrorCode, readonly [status: number, retryable?: true]> = {
  bad_request: [400], unauthorized: [401], forbidden: [403], not_found: [404], method_not_allowed: [405],
  conflict: [409], payload_too_large: [413], unsupported_media_type: [415], invalid_request: [422],
  precondition_required: [428], rate_limited: [429, true], internal_error: [500], bad_gateway: [502, true],
  unavailable: [503, true], timeout: [504, true], invalid_credentials: [401], project_access_denied: [403],
  username_exists: [409], email_exists: [409], auth_unavailable: [502, true], auth_not_configured: [500],
  workspace_not_found: [404], workspace_role_required: [403], workspace_limit: [409], personal_workspace_locked: [409],
  workspace_not_deleted: [409], confirmation_mismatch: [409], sole_owner: [409], export_not_found: [404],
  member_not_found: [404], last_owner: [409], invitation_not_found: [404], invitation_expired: [410],
  invitation_email_mismatch: [403], invitation_not_pending: [409], transfer_not_found: [404],
  stale_workspace: [412], stale_placement: [412], stale_collection: [412], collection_limit: [409],
  unchanged: [409], not_custom_order: [409], invalid_position: [409],
  document_not_found: [404], revision_not_found: [404], change_set_not_found: [404], invalid_cursor: [400],
  invalid_idempotency_key: [400], stale_head: [412], schema_unsupported: [409], idempotency_key_reused: [409],
  change_set_conflict: [409], history_export_too_large: [413], document_validation_failed: [422],
  document_rate_limit_exceeded: [429, true], document_integrity_error: [500], export_failed: [422],
  export_unavailable: [503], export_timeout: [504], chat_not_found: [404], message_not_found: [404],
  asset_not_found: [404], asset_too_large: [413], asset_type_unsupported: [415], asset_storage_unavailable: [503, true],
  resource_not_found: [404], collection_not_found: [404], upload_empty: [400], cycle: [409], depth_limit: [409],
  preview_changed: [409], not_in_trash: [409], document_in_trash: [409], job_not_found: [404], resource_conflict: [409], upload_too_large: [413], upload_not_pdf: [415],
  collection_write_failed: [500], resource_write_failed: [500], retrieval_unavailable: [503, true],
  unrecognized_identifier: [400], paper_source_disabled: [403], source_not_found: [404], paper_not_found: [404],
  source_mismatch: [409], source_retracted: [409],
  provider_invalid_input: [422], provider_rate_limited: [429, true], provider_failed: [502],
  provider_unavailable: [503, true], paper_source_unavailable: [503],
  resolver_unavailable: [503, true], claim_check_failed: [502, true], web_focus_failed: [502, true],
  reference_audit_not_found: [404], comment_not_found: [404], method_not_found: [404], session_not_found: [404], run_not_found: [404],
  run_stopped: [409], run_not_resumable: [409], incomplete_stream: [502], limit_exceeded: [429, true],
  plan_not_found: [404], plan_required: [409], stale_plan: [412], repeated_call: [409], tool_cancelled: [409],
  no_workspace_context: [404], no_document_context: [404], skill_disabled: [403], skill_resource_unknown: [404],
  invalid_todos: [422], workspace_policy: [403], untrusted_content: [403], outbound_refused: [403],
  budget_exhausted: [429], worker_failed: [502],
  generation_not_pending: [409], generation_request_changed: [412], image_budget_exhausted: [402],
  image_generation_failed: [502], image_generation_not_found: [404], image_generation_unavailable: [503],
  image_generation_unknown: [409], image_quota_exceeded: [429], image_refused: [422],
};

/**
 * A failure as the API sends every one (`ColWrite-api/docs/errors.md`):
 * `application/problem+json` with the registry's status, `code` and
 * `retryable`, and a string `detail`. `extra` adds the extensions the code
 * allows, or overrides a field.
 */
export function problem(
  code: ErrorCode,
  detail: string = code,
  extra: Partial<ProblemDetails> = {},
  init: { headers?: Record<string, string> } = {},
): HttpResponse<ProblemDetails> {
  const [status, retryable = false] = REGISTRY[code];
  const body: ProblemDetails = {
    type: `https://colwrite.com/problems/${code}`, title: code, status, detail, instance: '', code, retryable,
    errors: null, expected_head: null, current_head: null, change_set_id: null, change_set_status: null, conflict_reason: null,
    dependency_change_set_id: null, operation_index: null, retry_after: null, provider: null, operation: null, source: null,
    maximum_bytes: null, actual_bytes: null, required_role: null, limit: null, trash_root: null, purge_after: null,
    workspace_ids: null, policy: null, worker_id: null, counter: null, claimed_title: null, found_title: null,
    destination: null, rule: null, field: null, scope: null, resets_at: null,
    ...extra,
  };
  return HttpResponse.json(body, {
    status: body.status,
    headers: { 'Content-Type': 'application/problem+json', ...init.headers },
  });
}

/** A request body or parameter that does not validate: `invalid_request` with its field errors. */
export const invalidRequest = (loc: string[], msg: string) =>
  problem('invalid_request', 'Request validation failed', { errors: [{ loc, msg, type: 'value_error' }] });

/** A whole-number query parameter within the route's bounds, or the reason it is not one. */
function bounded(raw: string | null, name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number | HttpResponse<ProblemDetails> {
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return invalidRequest(['query', name], `Input should be an integer between ${min} and ${max}`);
  }
  return value;
}

/** An opaque continuation over a list that is already in its order: the offset, bound to the list it continues. */
const encodeCursor = (offset: number, context: string) => btoa(JSON.stringify({ offset, context }));
function decodeCursor(cursor: string, context: string): number | null {
  try {
    const value = JSON.parse(atob(cursor)) as { offset?: unknown; context?: unknown };
    return value.context === context && Number.isInteger(value.offset) && Number(value.offset) >= 0 ? Number(value.offset) : null;
  } catch {
    return null;
  }
}

/** One page of a list, read from `cursor` (or the start), and the cursor of the next one. */
function pageOf<T>(rows: T[], limit: number, cursor: string | null, context: string): { rows: T[]; next: string | null } | null {
  const offset = cursor ? decodeCursor(cursor, context) : 0;
  if (offset === null) return null;
  const page = rows.slice(offset, offset + limit);
  return { rows: page, next: offset + limit < rows.length ? encodeCursor(offset + limit, context) : null };
}

/** The account the preview is signed in as. */
const AUTH_SESSION: AuthSessionResponse = {
  success: true,
  authenticated: true,
  message: 'Authenticated',
  user_id: 'u-preview',
  user: { user_hash: 'preview', username: 'Ada Author', email: 'ada@example.org', user_type: 'user' },
  project: { project_hash: 'colwrite', project_name: 'ColWrite' },
  accessible_projects: [{ project_hash: 'colwrite', project_name: 'ColWrite' }],
  user_groups: [],
  plan: null,
  token_type: 'Bearer',
  expires_at: null,
  expires_in: null,
  refresh_expires_at: null,
  refresh_expires_in: null,
  remember_me: false,
};

/* ----------------------------------------
   Workspaces
   ---------------------------------------- */

const isProblem = (value: unknown): value is HttpResponse<ProblemDetails> => value instanceof Response;

const workspaceNotFound = () => problem('workspace_not_found', 'Workspace not found');
const documentNotFound = () => problem('document_not_found', 'Document not found');

/** The workspace a tenant route names, or why it cannot be used: not a member, or deleted, is not found. */
function workspaceOr(id: string): string | HttpResponse<ProblemDetails> {
  return liveWorkspace(id) ? id : workspaceNotFound();
}

/** A page in the Trash: 409 with what took it there, which is what a restore takes, and when it is purged. */
const inTrash = (doc: StoredDocument) => problem('document_in_trash', 'This page is in the Trash', {
  trash_root: doc.trash_root ?? { kind: 'document', id: doc._id },
  purge_after: purgeAfterOf(doc.deleted_at),
});

/** The workspace's page, a page in the Trash, or neither. */
function storedPageOr(workspaceId: string, documentId: string): StoredDocument | HttpResponse<ProblemDetails> {
  const workspace = workspaceOr(workspaceId);
  if (typeof workspace !== 'string') return workspace;
  const doc = fixtures.documents.get(documentId);
  return doc && doc.workspace_id === workspace ? doc : documentNotFound();
}

/** The workspace's live page, or the problem the API answers: a page in the Trash is 409 `document_in_trash`. */
function pageOr(workspaceId: string, documentId: string): StoredDocument | HttpResponse<ProblemDetails> {
  const doc = storedPageOr(workspaceId, documentId);
  if (isProblem(doc)) return doc;
  return doc.deleted_at ? inTrash(doc) : doc;
}

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/** The account's role in the workspace allows `role`: owner over admin over editor over viewer. */
function roleAllows(workspaceId: string, role: WorkspaceRole): boolean {
  const held = liveWorkspace(workspaceId) ? roleOf(workspaceId) : undefined;
  return held !== undefined && ROLE_RANK[held] >= ROLE_RANK[role];
}

const roleRequired = (role: WorkspaceRole) =>
  problem('workspace_role_required', `This needs the ${role} role in this workspace`, { required_role: role });

/**
 * The least role of each write under `/workspaces/{w}` (D6,
 * `ColWrite-api/docs/workspaces.md#roles`), the way the API's routes declare
 * it: the first rule that matches the method and the path after the
 * workspace decides. Reads need membership only. Routes that decide more
 * themselves (removing oneself, a transfer's named member, restoring one's own
 * trash) are left to their handler, and so are the workspace's own
 * `PATCH`/`DELETE`, which this path does not reach.
 */
const WRITE_ROLES: ReadonlyArray<readonly [method: string, path: RegExp, role: WorkspaceRole | null]> = [
  // Chats are their author's, and every member chats.
  ['PATCH', /^\/documents\/[^/]+\/chats\/[^/]+$/, null],
  ['DELETE', /^\/documents\/[^/]+\/chats\/[^/]+$/, null],
  // Leaving, and a transfer's accept or decline: the handler checks who.
  ['DELETE', /^\/members\/[^/]+$/, null],
  ['POST', /^\/ownership-transfer\/accept$/, null],
  ['DELETE', /^\/ownership-transfer$/, null],
  ['POST', /^\/ownership-transfer$/, 'owner'],
  ['PATCH', /^\/members\/[^/]+$/, 'admin'],
  ['POST', /^\/invitations$/, 'admin'],
  ['DELETE', /^\/invitations\/[^/]+$/, 'admin'],
  ['POST', /^\/export$/, 'admin'],
  ['DELETE', /^\/trash(\/.*)?$/, 'admin'],
  // A trash root's restore: an editor restores their own, an admin anyone's.
  ['POST', /^\/(documents|resources|collections)\/[^/]+\/restore$/, 'editor'],
  ['POST', /.*/, 'editor'],
  ['PUT', /.*/, 'editor'],
  ['PATCH', /.*/, 'editor'],
  ['DELETE', /.*/, 'editor'],
];

const ADMIN_READS: readonly RegExp[] = [/^\/invitations$/, /^\/export$/];

/**
 * The role check in front of every tenant route: a viewer's write is 403
 * `workspace_role_required` with the role it needs, before the route runs. A
 * request it lets through falls to the route's own handler.
 */
const roleGuard = untypedHttp.all(`${API_BASE}/workspaces/:workspaceId/*`, ({ request, params }) => {
  const workspaceId = String(params.workspaceId);
  if (!liveWorkspace(workspaceId)) return undefined;
  const rest = new URL(request.url).pathname.split(`/workspaces/${workspaceId}`)[1] ?? '';
  const path = rest.replace(/\/$/, '');
  if (request.method === 'GET') {
    return ADMIN_READS.some((pattern) => pattern.test(path)) && !roleAllows(workspaceId, 'admin') ? roleRequired('admin') : undefined;
  }
  const rule = WRITE_ROLES.find(([method, pattern]) => method === request.method && pattern.test(path));
  const role = rule?.[2] ?? null;
  return role && !roleAllows(workspaceId, role) ? roleRequired(role) : undefined;
});

/** A workspace write's `If-Match`: 428 without one, 412 `stale_workspace` when stale. */
function workspacePrecondition(request: Request, workspace: StoredWorkspace): HttpResponse<ProblemDetails> | null {
  const ifMatch = request.headers.get('If-Match');
  if (!ifMatch) return problem('precondition_required', 'If-Match is required');
  if (ifMatch !== workspaceEtagOf(workspace)) {
    return problem('stale_workspace', 'The workspace changed since it was read', { expected_head: ifMatch, current_head: workspaceEtagOf(workspace) });
  }
  return null;
}

/** How many live workspaces the account may own, its personal one included (`COLWRITE_OWNED_WORKSPACE_LIMIT`). */
export const OWNED_WORKSPACE_LIMIT = 20;
const ownedLive = () => [...fixtures.workspaces.values()].filter((workspace) => roleOf(workspace.id) === 'owner' && !workspace.deleted_at).length;
/** Inner whitespace collapsed, as the API stores a name. */
const collapse = (value: string) => value.split(/\s+/).filter(Boolean).join(' ');

/** Editors restore what they moved to the Trash; admins restore anything. */
const mayRestore = (workspaceId: string, trashedBy: string | null | undefined) =>
  trashedBy === PREVIEW_USER_ID || roleAllows(workspaceId, 'admin');

const workspaceHandlers = [
  // The live workspaces, most recently opened first; the deleted ones the account can restore.
  http.get('/workspaces', ({ response }) => response(200).json({
    items: [...fixtures.workspaces.values()]
      .filter((workspace) => liveWorkspace(workspace.id))
      .sort((a, b) => (b.last_opened_at ?? '').localeCompare(a.last_opened_at ?? ''))
      .map(workspaceSummary),
    last_workspace_id: fixtures.lastWorkspaceId,
    capabilities: { multi_workspace: true },
    deleted: deletedWorkspaces(),
  })),

  // A shared workspace with the caller as owner; at most 20 owned, a replay answers the same one.
  http.post('/workspaces', async ({ request, response }) => {
    const key = request.headers.get('Idempotency-Key');
    if (!key) return invalidRequest(['header', 'Idempotency-Key'], 'Field required');
    const body = await request.json();
    const name = collapse(body.name ?? '');
    if (!name || name.length > 100) return invalidRequest(['body', 'name'], 'A workspace needs a name of 1 to 100 characters');
    const replay = fixtures.createdWorkspaces.get(key);
    if (replay && replay.name !== name) return problem('idempotency_key_reused', 'Idempotency-Key was already used for a different workspace');
    let workspace = replay ? fixtures.workspaces.get(replay.id) : undefined;
    if (!workspace) {
      if (ownedLive() >= OWNED_WORKSPACE_LIMIT) {
        return problem('workspace_limit', 'You own the most workspaces one account can have', { limit: OWNED_WORKSPACE_LIMIT });
      }
      const at = new Date().toISOString();
      workspace = {
        id: `wsp-${uid()}`, name, kind: 'shared', icon: body.icon?.trim() || null, last_opened_at: null,
        created_at: at, updated_at: at, root_sort_mode: 'name', row_version: 1, tree_version: 1,
        policy: { ...OPEN_POLICY }, deleted_at: null, purge_after: null, export: null,
      };
      fixtures.workspaces.set(workspace.id, workspace);
      fixtures.members.set(workspace.id, [{ ...ownIdentity(), role: 'owner', added_by: null, joined_at: at }]);
      fixtures.createdWorkspaces.set(key, { name, id: workspace.id });
    }
    return response(201).json(workspaceDetail(workspace), { headers: { ETag: workspaceEtagOf(workspace) } });
  }),

  http.get('/workspaces/{workspace_id}', ({ params, response }) => {
    const workspace = liveWorkspace(params.workspace_id);
    if (!workspace) return workspaceNotFound();
    return response(200).json(workspaceDetail(workspace), { headers: { ETag: workspaceEtagOf(workspace) } });
  }),

  // Name, icon, the order of the top level and the policy: an admin's write, locked on the workspace's ETag.
  http.patch('/workspaces/{workspace_id}', async ({ params, request, response }) => {
    const workspace = liveWorkspace(params.workspace_id);
    if (!workspace) return workspaceNotFound();
    if (!roleAllows(workspace.id, 'admin')) return roleRequired('admin');
    const stale = workspacePrecondition(request, workspace);
    if (stale) return stale;
    const body = await request.json();
    const before = JSON.stringify([workspace.name, workspace.icon, workspace.root_sort_mode, workspace.policy]);
    if (typeof body.name === 'string') {
      const name = collapse(body.name);
      if (!name || name.length > 100) return invalidRequest(['body', 'name'], 'A workspace needs a name of 1 to 100 characters');
      workspace.name = name;
    }
    if ('icon' in body) workspace.icon = body.icon?.trim() || null;
    const sortChanged = Boolean(body.root_sort_mode && body.root_sort_mode !== workspace.root_sort_mode);
    if (body.root_sort_mode) workspace.root_sort_mode = body.root_sort_mode;
    if (body.policy) {
      const next = { ...workspace.policy };
      for (const key of ['web_search', 'outside_research', 'auto'] as const) {
        const value = body.policy[key];
        if (typeof value === 'boolean') next[key] = value;
      }
      workspace.policy = next;
    }
    if (JSON.stringify([workspace.name, workspace.icon, workspace.root_sort_mode, workspace.policy]) !== before) {
      workspace.row_version += 1;
      workspace.updated_at = new Date().toISOString();
      if (sortChanged) workspace.tree_version += 1;
    }
    return response(200).json(workspaceDetail(workspace), { headers: { ETag: workspaceEtagOf(workspace) } });
  }),

  // Delete a shared workspace for 30 days: its owner, its ETag and its name typed exactly.
  http.delete('/workspaces/{workspace_id}', ({ params, query, request, response }) => {
    const workspace = liveWorkspace(params.workspace_id);
    if (!workspace) return workspaceNotFound();
    if (!roleAllows(workspace.id, 'owner')) return roleRequired('owner');
    if (workspace.kind === 'personal') return problem('personal_workspace_locked', 'A personal workspace goes with the account');
    const stale = workspacePrecondition(request, workspace);
    if (stale) return stale;
    if (query.get('confirm_name') !== workspace.name) return problem('confirmation_mismatch', 'The name typed is not the workspace’s name');
    const at = Date.now();
    workspace.deleted_at = new Date(at).toISOString();
    workspace.purge_after = new Date(at + 30 * 24 * 3600 * 1000).toISOString();
    workspace.row_version += 1;
    if (fixtures.lastWorkspaceId === workspace.id) fixtures.lastWorkspaceId = null;
    return response(200).json({ id: workspace.id, name: workspace.name, deleted_at: workspace.deleted_at, purge_after: workspace.purge_after });
  }),

  // Bring a deleted workspace back, as it was; its owner's, until it is purged.
  http.post('/workspaces/{workspace_id}/restore', ({ params, response }) => {
    const workspace = fixtures.workspaces.get(params.workspace_id);
    if (!workspace || roleOf(workspace.id) !== 'owner') return workspaceNotFound();
    if (!workspace.deleted_at) return problem('workspace_not_deleted', 'This workspace is not deleted');
    if (!workspace.purge_after || Date.parse(workspace.purge_after) <= Date.now()) return workspaceNotFound();
    if (ownedLive() >= OWNED_WORKSPACE_LIMIT) {
      return problem('workspace_limit', 'You own the most workspaces one account can have', { limit: OWNED_WORKSPACE_LIMIT });
    }
    workspace.deleted_at = null;
    workspace.purge_after = null;
    workspace.row_version += 1;
    return response(200).json(workspaceDetail(workspace), { headers: { ETag: workspaceEtagOf(workspace) } });
  }),

  // Export the workspace as a zip, as a job; an admin's.
  http.post('/workspaces/{workspace_id}/export', async ({ params, request, response }) => {
    const workspace = liveWorkspace(params.workspace_id);
    if (!workspace) return workspaceNotFound();
    if (!roleAllows(workspace.id, 'admin')) return roleRequired('admin');
    const { include_pdfs: includePdfs = false } = await request.json();
    return response(202).json({ job: jobState(exportWorkspace(workspace, includePdfs)) });
  }),

  // The newest export, until it expires; an admin's.
  http.get('/workspaces/{workspace_id}/export', ({ params, response }) => {
    const workspace = liveWorkspace(params.workspace_id);
    if (!workspace) return workspaceNotFound();
    if (!roleAllows(workspace.id, 'admin')) return roleRequired('admin');
    const made = workspace.export;
    if (!made || Date.parse(made.expires_at) <= Date.now()) return problem('export_not_found', 'There is no export to download');
    const manifest = JSON.stringify({ format: 'colwrite-workspace-export', version: 1, workspace: { id: workspace.id, name: workspace.name } });
    return response.untyped(new HttpResponse(new Blob([manifest], { type: 'application/zip' }), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="workspace.zip"; filename*=UTF-8''${encodeURIComponent(made.filename)}`,
      },
    }));
  }),

  http.put('/users/me/last-workspace', async ({ request, response }) => {
    const { workspace_id: workspaceId } = await request.json();
    if (!liveWorkspace(workspaceId)) return workspaceNotFound();
    fixtures.lastWorkspaceId = workspaceId;
    return response(200).json({ last_workspace_id: workspaceId });
  }),

  // Which workspace a bare `?doc=` link's page is in; 404 for anyone who is not a member.
  http.get('/documents/{document_id}/location', ({ params, response }) => {
    const doc = liveDocument(params.document_id);
    if (!doc || !liveWorkspace(doc.workspace_id)) return documentNotFound();
    return response(200).json({ workspace_id: doc.workspace_id, collection_id: doc.collection_id });
  }),

  http.get('/workspaces/{workspace_id}/usage', ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const days = bounded(query.get('days'), 'days', 30, 1, 365);
    if (typeof days !== 'number') return days;
    return response(200).json(usageOf(workspace, days));
  }),

  // The account's usage over every workspace it can open.
  http.get('/users/me/usage', ({ query, response }) => {
    const days = bounded(query.get('days'), 'days', 30, 1, 365);
    if (typeof days !== 'number') return days;
    return response(200).json(accountUsageOf(days));
  }),

  // Delete the account: the username typed exactly, and no live shared workspace it alone owns.
  http.delete('/users/me', ({ query, response }) => {
    if (query.get('confirm_username') !== me().identity.username) {
      return problem('confirmation_mismatch', 'The username typed is not this account’s');
    }
    // The live shared workspaces with the account as their only owner.
    const sole = [...fixtures.workspaces.values()]
      .filter((workspace) => workspace.kind === 'shared' && !workspace.deleted_at && roleOf(workspace.id) === 'owner'
        && membersOf(workspace.id).filter((row) => row.role === 'owner').length === 1)
      .map((workspace) => workspace.id);
    if (sole.length > 0) {
      return problem('sole_owner', 'Delete the shared workspaces you alone own first', { workspace_ids: sole });
    }
    // The personal workspace and the deleted shared ones it alone owns are purged now.
    const purged = [...fixtures.workspaces.values()]
      .filter((workspace) => roleOf(workspace.id) === 'owner')
      .map((workspace) => workspace.id);
    return response(202).json({ workspace_ids: purged });
  }),
];

/* ----------------------------------------
   Members, invitations and ownership (M6)
   ---------------------------------------- */

const memberNotFound = () => problem('member_not_found', 'This person is not a member of the workspace');
const lastOwner = () => problem('last_owner', 'The workspace needs an owner: transfer ownership to another member first');
const ownerCount = (workspaceId: string) => membersOf(workspaceId).filter((row) => row.role === 'owner').length;
const ASSIGNABLE = ['admin', 'editor', 'viewer'] as const;
const isAssignable = (role: unknown): role is (typeof ASSIGNABLE)[number] => ASSIGNABLE.includes(role as never);
/** How long an invitation and a transfer stay open. */
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The token's invitation, whatever its state. */
const invitationOfToken = (token: string): StoredInvitation | undefined =>
  [...fixtures.invitations.values()].find((row) => row.token === token);

const memberHandlers = [
  // Every active member, owners first; every member reads it.
  http.get('/workspaces/{workspace_id}/members', ({ params, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    return response(200).json({ items: membersOf(workspace), next_cursor: null });
  }),

  // An admin gives admin, editor or viewer; an owner's role is only an owner's to change, and the last owner keeps it.
  http.patch('/workspaces/{workspace_id}/members/{user_id}', async ({ params, request, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    if (!roleAllows(workspace, 'admin')) return roleRequired('admin');
    const { role } = await request.json();
    if (!isAssignable(role)) return invalidRequest(['body', 'role'], 'A role change gives admin, editor or viewer');
    const target = fixtures.members.get(workspace)?.find((row) => row.user_id === params.user_id);
    if (!target) return memberNotFound();
    if (target.role === 'owner') {
      if (!roleAllows(workspace, 'owner')) return roleRequired('owner');
      if (ownerCount(workspace) <= 1) return lastOwner();
    }
    target.role = role;
    return response(200).json({ ...target });
  }),

  // Leave with one's own id; removing someone else is an admin's, and an owner only an owner's. The last owner stays.
  http.delete('/workspaces/{workspace_id}/members/{user_id}', ({ params, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const leaving = params.user_id === PREVIEW_USER_ID;
    if (!leaving && !roleAllows(workspace, 'admin')) return roleRequired('admin');
    const rows = fixtures.members.get(workspace) ?? [];
    const target = rows.find((row) => row.user_id === params.user_id);
    if (!target) return memberNotFound();
    if (target.role === 'owner') {
      if (!leaving && !roleAllows(workspace, 'owner')) return roleRequired('owner');
      if (ownerCount(workspace) <= 1) return lastOwner();
    }
    fixtures.members.set(workspace, rows.filter((row) => row !== target));
    const transfer = fixtures.transfers.get(workspace);
    if (transfer && (transfer.to_user_id === target.user_id || transfer.from_user_id === target.user_id)) fixtures.transfers.delete(workspace);
    if (leaving && fixtures.lastWorkspaceId === workspace) fixtures.lastWorkspaceId = null;
    return response(204).empty();
  }),

  // The pending invitations, newest first; an admin's.
  http.get('/workspaces/{workspace_id}/invitations', ({ params, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    if (!roleAllows(workspace, 'admin')) return roleRequired('admin');
    return response(200).json({ items: pendingInvitations(workspace), next_cursor: null });
  }),

  // An invitation link for one address and a role, for seven days; a new one for the address revokes the pending one.
  http.post('/workspaces/{workspace_id}/invitations', async ({ params, request, response }) => {
    const workspaceId = workspaceOr(params.workspace_id);
    if (isProblem(workspaceId)) return workspaceId;
    if (!roleAllows(workspaceId, 'admin')) return roleRequired('admin');
    const key = request.headers.get('Idempotency-Key');
    if (!key) return problem('invalid_idempotency_key', 'Idempotency-Key is required');
    const body = await request.json();
    const email = (body.email ?? '').trim().toLowerCase();
    if (!EMAIL.test(email)) return problem('invalid_request', 'Enter an email address', { errors: [{ loc: ['body', 'email'], msg: 'Enter an email address', type: 'value_error' }] });
    if (!isAssignable(body.role)) return invalidRequest(['body', 'role'], 'An invitation gives admin, editor or viewer');
    if (liveWorkspace(workspaceId)?.kind === 'personal') return problem('personal_workspace_locked', 'A personal workspace has only its owner');
    const fingerprint = JSON.stringify([workspaceId, email, body.role]);
    const replay = fixtures.createdInvitations.get(key);
    if (replay && replay.request !== fingerprint) return problem('idempotency_key_reused', 'Idempotency-Key was already used for a different invitation');
    let invitation = replay ? fixtures.invitations.get(replay.id) : undefined;
    if (!invitation) {
      for (const row of fixtures.invitations.values()) {
        if (row.workspace_id === workspaceId && row.email === email && row.status === 'pending') row.status = 'revoked';
      }
      const at = new Date();
      invitation = {
        id: `inv-${uid()}`, workspace_id: workspaceId, email, email_hint: emailHint(email), role: body.role,
        invited_by: PREVIEW_USER_ID, created_at: at.toISOString(), expire_time: new Date(at.getTime() + SEVEN_DAYS_MS).toISOString(),
        token: `cwinv-${uid().replace(/-/g, '')}`, status: 'pending',
      };
      fixtures.invitations.set(invitation.id, invitation);
      fixtures.createdInvitations.set(key, { request: fingerprint, id: invitation.id });
    }
    const { id, role, email_hint, invited_by, expire_time, created_at, token } = invitation;
    return response(201).json({ id, role, email_hint, invited_by, expire_time, created_at, token });
  }),

  // Revoke a pending invitation; an accepted one is 409, one of another workspace 404.
  http.delete('/workspaces/{workspace_id}/invitations/{invitation_id}', ({ params, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    if (!roleAllows(workspace, 'admin')) return roleRequired('admin');
    const invitation = fixtures.invitations.get(params.invitation_id);
    if (!invitation || invitation.workspace_id !== workspace) return problem('invitation_not_found', 'Invitation not found');
    if (invitation.status === 'accepted') return problem('invitation_not_pending', 'The invitation was already accepted');
    invitation.status = 'revoked';
    return response(204).empty();
  }),

  // Join the invitation's workspace with its role, when it names one of the account's verified addresses.
  http.post('/invitations/accept', async ({ request, response }) => {
    const { token } = await request.json();
    const invitation = invitationOfToken((token ?? '').trim());
    const workspace = invitation ? fixtures.workspaces.get(invitation.workspace_id) : undefined;
    if (!invitation || !workspace || workspace.deleted_at || invitation.status === 'revoked') {
      return problem('invitation_not_found', 'This invitation is no longer valid');
    }
    const own = ownMembership(workspace.id);
    if (invitation.status === 'accepted') {
      // Accepting again as the member it added; anyone else, or a member removed since, finds it used.
      return own ? response(200).json({ status: 'already_member', workspace_id: workspace.id, role: own.role }) : problem('invitation_not_found', 'This invitation is no longer valid');
    }
    if (Date.parse(invitation.expire_time) <= Date.now()) return problem('invitation_expired', 'This invitation has expired; ask for a new one');
    if (!VERIFIED_EMAILS.includes(invitation.email)) {
      return problem('invitation_email_mismatch', 'This invitation is for another email address. Sign in with that address, or add and verify it on your account, then open the link again');
    }
    invitation.status = 'accepted';
    if (own) return response(200).json({ status: 'already_member', workspace_id: workspace.id, role: own.role });
    const at = new Date().toISOString();
    fixtures.members.set(workspace.id, [...(fixtures.members.get(workspace.id) ?? []), {
      ...ownIdentity(), role: invitation.role, added_by: invitation.invited_by, joined_at: at,
    }]);
    workspace.last_opened_at = at;
    return response(200).json({ status: 'joined', workspace_id: workspace.id, role: invitation.role });
  }),

  // The owner asks a member to become the owner; nothing changes until they accept.
  http.post('/workspaces/{workspace_id}/ownership-transfer', async ({ params, request, response }) => {
    const workspaceId = workspaceOr(params.workspace_id);
    if (isProblem(workspaceId)) return workspaceId;
    if (!roleAllows(workspaceId, 'owner')) return roleRequired('owner');
    if (liveWorkspace(workspaceId)?.kind === 'personal') return problem('personal_workspace_locked', 'A personal workspace has only its owner');
    const { user_id: userId } = await request.json();
    const target = membersOf(workspaceId).find((row) => row.user_id === userId);
    if (!target) return memberNotFound();
    if (target.role === 'owner') return problem('unchanged', 'This member is already an owner');
    const transfer = { from_user_id: PREVIEW_USER_ID, to_user_id: target.user_id, expire_time: new Date(Date.now() + SEVEN_DAYS_MS).toISOString() };
    fixtures.transfers.set(workspaceId, transfer);
    return response(200).json(transfer);
  }),

  // The member a transfer names becomes the owner; the previous owner an admin.
  http.post('/workspaces/{workspace_id}/ownership-transfer/accept', ({ params, response }) => {
    const workspace = liveWorkspace(params.workspace_id);
    if (!workspace) return workspaceNotFound();
    const transfer = transferOf(workspace.id);
    if (!transfer || transfer.to_user_id !== PREVIEW_USER_ID) return problem('transfer_not_found', 'There is no ownership transfer waiting for you here');
    if (ownedLive() >= OWNED_WORKSPACE_LIMIT) {
      return problem('workspace_limit', 'You own the most workspaces one account can have', { limit: OWNED_WORKSPACE_LIMIT });
    }
    for (const row of fixtures.members.get(workspace.id) ?? []) {
      if (row.user_id === transfer.to_user_id) row.role = 'owner';
      else if (row.user_id === transfer.from_user_id) row.role = 'admin';
    }
    fixtures.transfers.delete(workspace.id);
    workspace.row_version += 1;
    return response(200).json(workspaceDetail(workspace), { headers: { ETag: workspaceEtagOf(workspace) } });
  }),

  // The owner withdraws it, or the member it names declines it.
  http.delete('/workspaces/{workspace_id}/ownership-transfer', ({ params, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const transfer = transferOf(workspace);
    if (!transfer || (transfer.to_user_id !== PREVIEW_USER_ID && !roleAllows(workspace, 'owner'))) {
      return problem('transfer_not_found', 'There is no ownership transfer to cancel');
    }
    fixtures.transfers.delete(workspace);
    return response(204).empty();
  }),
];

/* ----------------------------------------
   Pages
   ---------------------------------------- */

/** Text the `$text` index reads: the page's name and the words of its blocks. */
function searchableText(doc: StoredDocument): string {
  const blocks = doc.blocks.map((block) => {
    const value = block as Json;
    return [value.html, value.text].filter((part): part is string => typeof part === 'string').join(' ');
  });
  return `${doc.name} ${blocks.join(' ')}`.replace(/<[^>]*>/g, ' ').toLowerCase();
}

/** Any of the words, as MongoDB's `$text` search matches them. */
function matchesQuery(doc: StoredDocument, query: string): boolean {
  const words = searchableText(doc).split(/[^\p{L}\p{N}]+/u);
  return query.toLowerCase().split(/\s+/).filter(Boolean).some((term) => words.includes(term.replace(/"/g, '')));
}

/**
 * A write's preconditions, as the API checks them: `If-Match` (428 when
 * missing, 412 `stale_head` when it is not the head) and `Idempotency-Key`.
 */
function preconditions(request: Request, doc: StoredDocument): { key: string; ifMatch: string } | HttpResponse<ProblemDetails> {
  const ifMatch = request.headers.get('If-Match');
  const key = request.headers.get('Idempotency-Key');
  if (!ifMatch) return problem('precondition_required', 'If-Match is required');
  if (!key) return invalidRequest(['header', 'Idempotency-Key'], 'Field required');
  if (ifMatch !== etagOf(doc)) {
    return problem('stale_head', 'The document changed since it was read', { expected_head: ifMatch, current_head: etagOf(doc) });
  }
  return { key, ifMatch };
}

/** A write already answered under this `Idempotency-Key`: the stored answer, or a reuse for another request. */
function replayOf(key: string, fingerprint: string): HttpResponse<DocumentStateResponse | ProblemDetails> | null {
  const replay = fixtures.idempotency.get(key);
  if (!replay) return null;
  if (replay.request !== fingerprint) return problem('idempotency_key_reused', 'Idempotency-Key was used for a different request');
  return HttpResponse.json<DocumentStateResponse>({ ...replay.head, duplicate: true }, { headers: { ETag: replay.etag } });
}

/** A placement write's `If-Match`: the placement ETag (428 without one, or with the content ETag; 412 when stale). */
function placementPrecondition(request: Request, doc: StoredDocument): HttpResponse<ProblemDetails> | null {
  const ifMatch = request.headers.get('If-Match');
  if (!ifMatch || !ifMatch.startsWith('"cwp:')) return problem('precondition_required', 'If-Match with the placement ETag is required');
  if (ifMatch !== placementEtagOf(doc)) {
    return problem('stale_placement', 'The page moved since it was read', { expected_head: ifMatch, current_head: placementEtagOf(doc) });
  }
  return null;
}

/** Where a page lives after a move or reorder. */
function placementOf(id: string) {
  const doc = liveDocument(id) as StoredDocument;
  return {
    document_id: doc._id,
    workspace_id: doc.workspace_id,
    collection_id: doc.collection_id,
    sort_key: doc.sort_key,
    placement_etag: placementEtagOf(doc),
    tree_version: treeVersionOf(doc.workspace_id),
  };
}

const pageHandlers = [
  http.get('/workspaces/{workspace_id}/documents', ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const limit = bounded(query.get('limit'), 'limit', 50, 1, 100);
    if (typeof limit !== 'number') return limit;
    const sortBy = query.get('sort_by') ?? 'updated_at';
    const sortOrder = query.get('sort_order') ?? 'desc';
    const text = query.get('query')?.trim() || null;
    const tags = query.getAll('tags');
    const activity = query.getAll('include').includes('activity');
    // `any` (the default) is the whole workspace, `root` the top level, a number one collection's pages.
    const home = query.get('collection_id') ?? 'any';
    const homeId = home === 'any' || home === 'root' ? null : Number(home);
    if (homeId !== null && (!Number.isSafeInteger(homeId) || !workspaceCollection(workspace, homeId))) return collectionNotFound();
    if (sortBy === 'custom' && home === 'any') {
      return problem('bad_request', 'sort_by=custom needs collection_id root or a collection');
    }
    const direction = sortOrder === 'asc' ? 1 : -1;
    const key = (doc: StoredDocument) => (sortBy === 'name' ? doc.name : sortBy === 'created_at' ? doc.created_at : doc.updated_at);
    const ordered = (a: StoredDocument, b: StoredDocument) => {
      if (sortBy === 'custom') return direction * byKey((doc: StoredDocument) => doc._id)(a, b);
      if (sortBy === 'name') return direction * byName((doc: StoredDocument) => doc._id)(a, b);
      return direction * (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
    };
    const rows = documentsIn(workspace)
      .filter((doc) => home === 'any' || doc.collection_id === homeId)
      .filter((doc) => !text || matchesQuery(doc, text))
      .filter((doc) => tags.every((tag) => doc.tags.includes(tag)))
      .sort(ordered);
    const page = pageOf(rows, limit, query.get('cursor'), JSON.stringify([workspace, home, text, tags, sortBy, sortOrder]));
    if (!page) return problem('invalid_cursor', 'Invalid document list cursor');
    return response(200).json({ items: page.rows.map((doc) => summaryOf(doc, activity)), next_cursor: page.next });
  }),

  http.post('/workspaces/{workspace_id}/documents', async ({ params, request, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const key = request.headers.get('Idempotency-Key');
    if (!key) return invalidRequest(['header', 'Idempotency-Key'], 'Field required');
    const { content, collection_id: collectionId = null, position } = await request.json();
    const fingerprint = `create:${workspace}:${collectionId}:${JSON.stringify(position)}:${JSON.stringify(content)}`;
    const replay = replayOf(key, fingerprint);
    if (replay) return replay;
    if (collectionId !== null && !workspaceCollection(workspace, collectionId)) return collectionNotFound();
    const sortKey = keyAt(pagesHomedIn(workspace, collectionId), position as Position, (doc) => doc._id);
    if (sortKey === null) return problem('invalid_position', 'The position names no page there');
    const id = `66f0c0ffee0000000000${String(fixtures.nextDocumentNumber++).padStart(4, '0')}`;
    let blocks: WireBlock[];
    try { blocks = prepareImageBlocks(workspace, (content.blocks ?? []) as WireBlock[]); }
    catch (error) { if (error instanceof MockAssetError) return problem(error.code, error.message); throw error; }
    const now = new Date().toISOString();
    const doc: StoredDocument = {
      _id: id,
      workspace_id: workspace,
      collection_id: collectionId,
      sort_key: sortKey,
      placement_seq: 1,
      name: content.name || 'Untitled page',
      head_seq: 1,
      tags: content.tags ?? [],
      blocks,
      sources: content.sources ?? null,
      citationStyle: content.citationStyle ?? null,
      instructions: content.instructions ?? null,
      documentType: content.documentType ?? null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    fixtures.documents.set(id, doc);
    linkPageAssets(workspace, id, blocks);
    syncSettingGrant(doc);
    bumpTree(workspace);
    const head = headOf(doc);
    fixtures.idempotency.set(key, { request: fingerprint, head, etag: etagOf(doc) });
    return response(201).json(head, { headers: { ETag: etagOf(doc) } });
  }),

  http.get('/workspaces/{workspace_id}/documents/{document_id}', ({ params, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    return response(200).json(headOf(doc), { headers: { ETag: etagOf(doc) } });
  }),

  // A whole-body save over the head `If-Match` names.
  http.put('/workspaces/{workspace_id}/documents/{document_id}', async ({ params, request, response }) => {
    const previous = pageOr(params.workspace_id, params.document_id);
    if (isProblem(previous)) return previous;
    const body = await request.json();
    const key = request.headers.get('Idempotency-Key');
    const fingerprint = `save:${previous._id}:${request.headers.get('If-Match')}:${JSON.stringify(body.content)}`;
    const replay = key ? replayOf(key, fingerprint) : null;
    if (replay) return replay;
    const checked = preconditions(request, previous);
    if (isProblem(checked)) return checked;
    // The history is seeded from what was there before this write.
    historyOf(previous);
    const { content } = body;
    let blocks: WireBlock[];
    try { blocks = prepareImageBlocks(previous.workspace_id, (content.blocks ?? previous.blocks) as WireBlock[]); }
    catch (error) { if (error instanceof MockAssetError) return problem(error.code, error.message); throw error; }
    const saved: StoredDocument = {
      ...previous,
      name: content.name || previous.name,
      tags: content.tags ?? previous.tags,
      blocks,
      sources: 'sources' in content ? (content.sources ?? null) : previous.sources,
      citationStyle: 'citationStyle' in content ? (content.citationStyle ?? null) : previous.citationStyle,
      instructions: 'instructions' in content ? (content.instructions ?? null) : previous.instructions,
      documentType: 'documentType' in content ? (content.documentType ?? null) : previous.documentType,
      head_seq: previous.head_seq + 1,
      updated_at: new Date().toISOString(),
    };
    fixtures.documents.set(saved._id, saved);
    recordRevision(saved, body.summary ?? null);
    linkPageAssets(saved.workspace_id, saved._id, blocks);
    const head = headOf(saved);
    fixtures.idempotency.set(checked.key, { request: fingerprint, head, etag: etagOf(saved) });
    return response(200).json(head, { headers: { ETag: etagOf(saved) } });
  }),

  // To the Trash, with no content precondition: a trash can be undone. The
  // content ETag does not change; a replay of the key answers the page as it is.
  http.post('/workspaces/{workspace_id}/documents/{document_id}/trash', ({ params, request, response }) => {
    const doc = storedPageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const key = request.headers.get('Idempotency-Key');
    if (!key) return invalidRequest(['header', 'Idempotency-Key'], 'Field required');
    if (!roleAllows(doc.workspace_id, 'editor')) return roleRequired('editor');
    const fingerprint = `trash:${doc._id}`;
    const replay = fixtures.idempotency.get(key);
    if (replay) {
      if (replay.request !== fingerprint) return problem('idempotency_key_reused', 'Idempotency-Key was used for a different request');
      return response(200).json({ ...headOf(doc), duplicate: true }, { headers: { ETag: etagOf(doc) } });
    }
    if (doc.deleted_at) return inTrash(doc);
    const trashed = trashPage(doc);
    const head = headOf(trashed);
    fixtures.idempotency.set(key, { request: fingerprint, head, etag: etagOf(trashed) });
    return response(200).json(head, { headers: { ETag: etagOf(trashed) } });
  }),

  // Back from the Trash, to its home or to the top level when that is gone.
  http.post('/workspaces/{workspace_id}/documents/{document_id}/restore', ({ params, request, response }) => {
    const doc = storedPageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const key = request.headers.get('Idempotency-Key');
    if (!key) return invalidRequest(['header', 'Idempotency-Key'], 'Field required');
    const fingerprint = `restore-page:${doc._id}`;
    const replay = fixtures.idempotency.get(key);
    if (replay) {
      if (replay.request !== fingerprint) return problem('idempotency_key_reused', 'Idempotency-Key was used for a different request');
      return response(200).json({ ...headOf(doc), duplicate: true }, { headers: { ETag: etagOf(doc) } });
    }
    if (!doc.deleted_at) return problem('not_in_trash', 'The page is not in the Trash');
    // A page that went with a collection comes back only with it.
    if (doc.trash_root?.kind === 'collection') {
      return problem('document_in_trash', 'This page is in the Trash with its collection; restore the collection', {
        trash_root: doc.trash_root, purge_after: purgeAfterOf(doc.deleted_at),
      });
    }
    if (!mayRestore(doc.workspace_id, doc.trashed_by)) return roleRequired('admin');
    const restored = restorePage(doc);
    const head = headOf(restored);
    fixtures.idempotency.set(key, { request: fingerprint, head, etag: etagOf(restored) });
    return response(200).json(head, { headers: { ETag: etagOf(restored) } });
  }),

  // A new home, at `position` among its pages. Locked on the placement ETag, which is not the content one.
  http.post('/workspaces/{workspace_id}/documents/{document_id}/move', async ({ params, request, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const stale = placementPrecondition(request, doc);
    if (stale) return stale;
    const { collection_id: collectionId, position } = await request.json();
    if (collectionId !== null && !workspaceCollection(doc.workspace_id, collectionId)) return collectionNotFound();
    if (collectionId === doc.collection_id) return problem('unchanged', 'The page is already there');
    if (!placeDocument(doc, collectionId, position as Position)) return problem('invalid_position', 'The position names no page there');
    return response(200).json(placementOf(doc._id));
  }),

  // A new place among the page's current siblings, in a home ordered by hand.
  http.post('/workspaces/{workspace_id}/documents/{document_id}/reorder', async ({ params, request, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const stale = placementPrecondition(request, doc);
    if (stale) return stale;
    if (sortModeOf(doc.workspace_id, doc.collection_id) !== 'custom') {
      return problem('not_custom_order', 'This home is not in custom order');
    }
    const { position } = await request.json();
    if (!placeDocument(doc, doc.collection_id, position as Position)) return problem('invalid_position', 'The position names no page there');
    return response(200).json(placementOf(doc._id));
  }),

  // A copy into another workspace, as a job there; the caller is an editor of both (D11).
  http.post('/workspaces/{workspace_id}/documents/{document_id}/copy', async ({ params, request, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const key = request.headers.get('Idempotency-Key');
    if (!key) return invalidRequest(['header', 'Idempotency-Key'], 'Field required');
    const body = await request.json();
    const fingerprint = `copy:${doc._id}:${JSON.stringify([body.target_workspace_id, body.target_collection_id ?? null, body.include_pdfs ?? 'none'])}`;
    const replay = fixtures.copies.get(key);
    if (replay) {
      if (replay.request !== fingerprint) return problem('idempotency_key_reused', 'Idempotency-Key was used for a different request');
      const job = fixtures.jobs.get(replay.jobId);
      if (job) return response(202).json({ target_workspace_id: job.workspace_id, job: jobState(job) });
    }
    if (!roleAllows(doc.workspace_id, 'editor')) return roleRequired('editor');
    const target = liveWorkspace(body.target_workspace_id);
    if (!target) return workspaceNotFound();
    if (target.id === doc.workspace_id) return problem('bad_request', 'A page is copied into another workspace');
    if (!roleAllows(target.id, 'editor')) return roleRequired('editor');
    const collectionId = body.target_collection_id ?? null;
    if (collectionId !== null && !workspaceCollection(target.id, collectionId)) return collectionNotFound();
    try { prepareImageBlocks(doc.workspace_id, doc.blocks); }
    catch (error) { if (error instanceof MockAssetError) return problem(error.code, error.message); throw error; }
    const job = copyPage(doc, target, collectionId, body.include_pdfs ?? 'none');
    fixtures.copies.set(key, { request: fingerprint, jobId: job.id });
    return response(202).json({ target_workspace_id: target.id, job: jobState(job) });
  }),

  // `?format=tex|pdf` renders the *saved* page server-side. The mock has no
  // LaTeX renderer, so it answers a minimal source in the same shape; PDF
  // reports a missing compiler, as an API without one does.
  http.get('/workspaces/{workspace_id}/documents/{document_id}/export', async ({ params, query, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const format = query.get('format');
    if (format === 'pdf') return problem('export_unavailable', 'PDF export is unavailable');
    if (format !== 'tex') return invalidRequest(['query', 'format'], "Input should be 'tex' or 'pdf'");
    const escaped = doc.name.replace(/[\\{}$&#^_%~]/g, (character) => `\\${character}`);
    const files: { name: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
    const records: object[] = [];
    const graphics: string[] = [];
    const encoder = new TextEncoder();
    const ids = new Set<string>();
    for (const block of doc.blocks) {
      if (block.type !== 'image' || ids.has(block.assetId)) continue;
      ids.add(block.assetId);
      const stored = readableAsset(doc.workspace_id, block.assetId);
      if (!stored?.file) return problem('asset_not_found', 'An image is unavailable.');
      const extension = stored.asset.media_type === 'image/png' ? 'png' : stored.asset.media_type === 'image/jpeg' ? 'jpg' : null;
      if (!extension) return problem('export_unavailable', 'The preview does not convert GIF/WebP for LaTeX. Export HTML or Markdown instead.');
      const path = `assets/${block.assetId}.${extension}`;
      files.push({ name: path, bytes: new Uint8Array(await stored.file.arrayBuffer()) });
      records.push({ ...stored.asset, file: path, latex_file: path });
      graphics.push(`\\includegraphics[width=${block.width ?? 1}\\linewidth]{${path}}`);
    }
    const source = `\\documentclass{article}\n${graphics.length ? '\\usepackage{graphicx}\n' : ''}\\title{${escaped}}\n\\begin{document}\n\\maketitle\n% Dev preview: ColWrite-api renders the full document here.\n${graphics.join('\n')}\n\\end{document}\n`;
    if (files.length) {
      const bundle = storedZip([{ name: 'document.tex', bytes: encoder.encode(source) }, { name: 'assets.json', bytes: encoder.encode(JSON.stringify(records)) }, ...files]);
      return response.untyped(new HttpResponse(bundle, { headers: {
        'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="document.zip"; filename*=UTF-8''${encodeURIComponent(`${doc.name}.zip`)}`,
        'Cache-Control': 'private, no-store',
      } }));
    }
    return response.untyped(new HttpResponse(source, {
      headers: {
        'Content-Type': 'application/x-tex',
        'Content-Disposition': `attachment; filename="document.tex"; filename*=UTF-8''${encodeURIComponent(`${doc.name}.tex`)}`,
        'Cache-Control': 'private, no-store',
      },
    }));
  }),
];

/* ----------------------------------------
   History and review
   ---------------------------------------- */

const changeSetConflict = (changeSet: StoredChangeSet, reason: string, detail: string, extra: Partial<ProblemDetails> = {}) =>
  problem('change_set_conflict', detail, {
    change_set_id: changeSet.change_set_id, change_set_status: changeSet.status, conflict_reason: reason, ...extra,
  });

/**
 * `POST …/change-sets/{id}/decisions`, with the API's rules
 * (`docs/document-history-api.md`, Per-operation review): an operation is
 * decided once, a request that only repeats is a duplicate, and the last
 * decision takes the set out of `pending` without applying anything.
 */
function decide(changeSet: StoredChangeSet, body: ChangeSetDecisionsRequest): HttpResponse<ChangeSetResponse | ProblemDetails> {
  const requested = Array.isArray(body.decisions) ? body.decisions : [];
  if (requested.length === 0 || requested.length > 200) return invalidRequest(['body', 'decisions'], 'decisions must hold 1 to 200 items');
  for (const item of requested) {
    if (!Number.isInteger(item?.index) || item.index < 0) return invalidRequest(['body', 'decisions', 'index'], 'Input should be greater than or equal to 0');
    if (item.decision !== 'accepted' && item.decision !== 'rejected') return invalidRequest(['body', 'decisions', 'decision'], "Input should be 'accepted' or 'rejected'");
  }
  const indexes = requested.map((item) => item.index);
  const invalid = (detail: string) => problem('document_validation_failed', detail, { errors: [{ loc: ['body', 'decisions'], msg: detail, type: 'value_error' }] });
  if (new Set(indexes).size !== indexes.length) return invalid('An operation index is decided twice in one request');
  const outside = indexes.find((index) => index >= changeSet.operations.length);
  if (outside !== undefined) return invalid(`Operation index ${outside} is outside this change set`);

  if (requested.some((item) => item.origin === 'auto') && changeSet.apply_policy !== 'auto') {
    return changeSetConflict(changeSet, 'auto_not_allowed', 'Only an auto change set can be decided automatically');
  }
  const recorded = new Map(changeSet.decisions.map((item) => [item.index, item.decision]));
  const contradicted = requested.find((item) => recorded.has(item.index) && recorded.get(item.index) !== item.decision);
  if (contradicted) {
    return changeSetConflict(changeSet, 'operation_already_decided', 'That operation was already decided differently', {
      operation_index: contradicted.index,
    });
  }
  const headers = { 'Cache-Control': 'private, no-store' };
  const fresh = requested.filter((item) => !recorded.has(item.index));
  if (fresh.length === 0) return HttpResponse.json(changeSetResponse(changeSet, { duplicate: true }), { headers });
  if (changeSet.status !== 'pending') return changeSetConflict(changeSet, 'terminal_state', 'Only a pending change set can be decided');

  const decidedAt = new Date().toISOString();
  for (const item of fresh) {
    changeSet.decisions.push({ index: item.index, decision: item.decision, decided_at: decidedAt, decided_by: 'u-preview', origin: item.origin ?? 'manual' });
  }
  if (changeSet.decisions.length === changeSet.operations.length) {
    changeSet.status = changeSet.decisions.some((item) => item.decision === 'accepted') ? 'superseded' : 'rejected';
    changeSet.conflict_reason = 'decided_per_operation';
    changeSet.decided_at = decidedAt;
    changeSet.decided_by = 'u-preview';
  }
  return HttpResponse.json(changeSetResponse(changeSet), { headers });
}

function changeSetOr(workspaceId: string, documentId: string, changeSetId: string): StoredChangeSet | HttpResponse<ProblemDetails> {
  const doc = pageOr(workspaceId, documentId);
  if (isProblem(doc)) return doc;
  return changeSetsOf(doc._id).find((candidate) => candidate.change_set_id === changeSetId)
    ?? problem('change_set_not_found', 'Change set not found');
}

const historyHandlers = [
  http.get('/workspaces/{workspace_id}/documents/{document_id}/change-sets', ({ params, query, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const limit = bounded(query.get('limit'), 'limit', 50, 1, 100);
    if (typeof limit !== 'number') return limit;
    const status = query.get('status');
    const rows = changeSetsOf(doc._id)
      .filter((changeSet) => !status || changeSet.status === status)
      // Newest first, as the API lists them.
      .sort((a, b) => b.proposed_at.localeCompare(a.proposed_at));
    const page = pageOf(rows, limit, query.get('cursor'), `change-sets:${doc._id}:${status ?? ''}`);
    if (!page) return problem('invalid_cursor', 'Invalid change set cursor');
    return response(200).json({ change_sets: page.rows.map((changeSet) => changeSetResponse(changeSet)), next_cursor: page.next });
  }),

  http.get('/workspaces/{workspace_id}/documents/{document_id}/change-sets/{change_set_id}', ({ params, response }) => {
    const changeSet = changeSetOr(params.workspace_id, params.document_id, params.change_set_id);
    if (isProblem(changeSet)) return changeSet;
    return response(200).json(changeSetResponse(changeSet));
  }),

  http.post('/workspaces/{workspace_id}/documents/{document_id}/change-sets/{change_set_id}/decisions', async ({ params, request }) => {
    const changeSet = changeSetOr(params.workspace_id, params.document_id, params.change_set_id);
    if (isProblem(changeSet)) return changeSet;
    return decide(changeSet, await request.json());
  }),

  // A whole-set reject closes a partly decided set and keeps its record.
  http.post('/workspaces/{workspace_id}/documents/{document_id}/change-sets/{change_set_id}/reject', async ({ params, request, response }) => {
    const changeSet = changeSetOr(params.workspace_id, params.document_id, params.change_set_id);
    if (isProblem(changeSet)) return changeSet;
    const text = await request.text();
    const body = text ? (JSON.parse(text) as { reason?: string | null } | null) : null;
    if (changeSet.status === 'pending') {
      changeSet.status = 'rejected';
      changeSet.decided_at = new Date().toISOString();
      changeSet.decided_by = 'u-preview';
      changeSet.rejection_reason = typeof body?.reason === 'string' ? body.reason : null;
    } else if (changeSet.status !== 'rejected') {
      return changeSetConflict(changeSet, 'terminal_state', 'Change set cannot be rejected in its current state');
    }
    return response(200).json(changeSetResponse(changeSet, { compared: false }));
  }),

  http.get('/workspaces/{workspace_id}/documents/{document_id}/revisions', ({ params, query, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const limit = bounded(query.get('limit'), 'limit', 50, 1, 100);
    if (typeof limit !== 'number') return limit;
    const page = pageOf(historyOf(doc).revisions, limit, query.get('cursor'), `revisions:${doc._id}`);
    if (!page) return problem('invalid_cursor', 'Invalid revision cursor');
    return response(200).json({ revisions: page.rows, next_cursor: page.next });
  }),

  http.get('/workspaces/{workspace_id}/documents/{document_id}/comments', ({ params, query, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const status = query.get('status');
    const runId = query.get('run_id');
    if (status !== null && !['open', 'resolved', 'dismissed'].includes(status)) return problem('invalid_request', 'Invalid comment status.');
    const limit = bounded(query.get('limit'), 'limit', 100, 1, 200);
    if (typeof limit !== 'number') return limit;
    const rows = (fixtures.comments.get(doc._id) ?? []).filter((comment) =>
      (!status || comment.status === status) && (!runId || comment.run_id === runId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.comment_id.localeCompare(a.comment_id));
    const page = pageOf(rows, limit, query.get('cursor'), `comments:${params.workspace_id}:${doc._id}:${status}:${runId}`);
    if (!page) return problem('invalid_cursor', 'Invalid comment cursor.');
    return response(200).json({
      items: page.rows.map((comment) => {
        const block = doc.blocks.find((item) => item.id === comment.block_id);
        return { ...comment, outdated: !block || !mockAnchorText(block).includes(comment.quote) };
      }),
      next_cursor: page.next,
    });
  }),

  http.patch('/workspaces/{workspace_id}/documents/{document_id}/comments/{comment_id}', async ({ params, request, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const body = await request.json();
    if (!['open', 'resolved', 'dismissed'].includes(body.status)) return problem('invalid_request', 'Invalid comment status.');
    const comment = fixtures.comments.get(doc._id)?.find((item) => item.comment_id === params.comment_id);
    if (!comment) return problem('comment_not_found', 'No such comment on this page.');
    if (comment.status !== body.status) {
      comment.status = body.status;
      comment.decided_by = body.status === 'open' ? null : 'u-preview';
      comment.decided_at = body.status === 'open' ? null : new Date().toISOString();
    }
    const block = doc.blocks.find((item) => item.id === comment.block_id);
    return response(200).json({ ...comment, outdated: !block || !mockAnchorText(block).includes(comment.quote) });
  }),

  http.get('/workspaces/{workspace_id}/documents/{document_id}/reviews', ({ params, query, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const limit = bounded(query.get('limit'), 'limit', 50, 1, 100);
    if (typeof limit !== 'number') return limit;
    const rows = [...(fixtures.reviewRuns.get(doc._id) ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.run_id.localeCompare(a.run_id));
    const page = pageOf(rows, limit, query.get('cursor'), `reviews:${params.workspace_id}:${doc._id}`);
    if (!page) return problem('invalid_cursor', 'Invalid review cursor.');
    return response(200).json({
      items: page.rows.map((run) => ({
        ...run, session_id: run.created_by === 'u-preview' ? run.session_id : null,
        after_seq: run.created_by === 'u-preview' ? run.after_seq : null,
      })), next_cursor: page.next,
    });
  }),

  http.get('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}', ({ params, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const history = historyOf(doc);
    const revision = history.revisions.find((item) => item.revision_id === params.revision_id);
    const content = history.contents.get(params.revision_id);
    if (!revision || !content) return problem('revision_not_found', 'Revision not found');
    return response(200).json({ ...revision, content, semantic_operations: null });
  }),

  http.get('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/diff', ({ params, query, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const base = params.revision_id;
    const against = query.get('against') ?? 'current';
    const history = historyOf(doc);
    const target = against === 'current' ? history.pointer : against;
    const from = history.contents.get(base);
    // Against the live page, which may hold a save that is not a revision of
    // this tree yet; between two revisions, what each of them held.
    const to = against === 'current' ? contentOf(doc) : history.contents.get(target);
    if (!from || !to) return problem('revision_not_found', 'Revision not found');
    return response(200).json({
      base_revision_id: base,
      target_revision_id: against === 'current' ? null : against,
      target_head_seq: against === 'current' ? doc.head_seq : null,
      diff: {
        algorithm_version: 'stable-id-v1',
        base_hash: `h-${base}`,
        target_hash: `h-${target}`,
        // The seeded revisions keep their written-out changes (a citation's
        // sources among them); anything saved here is compared.
        changes: isSeededRevision(base) && isSeededRevision(target) ? seededChanges(base, target) : blockChanges(from, to),
      },
    });
  }),

  // Moves the current-version pointer; no revision is written, and the head
  // sequence still advances (docs/doc_architecture/13-branching-versions.md).
  http.post('/workspaces/{workspace_id}/documents/{document_id}/revisions/{revision_id}/restore', ({ params, request, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const ifMatch = request.headers.get('If-Match');
    const key = request.headers.get('Idempotency-Key');
    if (!ifMatch) return problem('precondition_required', 'If-Match is required');
    if (!key) return invalidRequest(['header', 'Idempotency-Key'], 'Field required');
    const fingerprint = `restore:${doc._id}:${params.revision_id}:${ifMatch}`;
    const replay = replayOf(key, fingerprint);
    if (replay) return replay;
    if (ifMatch !== etagOf(doc)) {
      return problem('stale_head', 'The document changed since it was read', { expected_head: ifMatch, current_head: etagOf(doc) });
    }
    const history = historyOf(doc);
    const content = history.contents.get(params.revision_id);
    if (!content) return problem('revision_not_found', 'Revision not found');
    const restored: StoredDocument = {
      ...doc,
      name: content.name ?? doc.name,
      tags: content.tags ?? doc.tags,
      blocks: structuredClone(content.blocks ?? []),
      sources: content.sources,
      citationStyle: content.citationStyle,
      instructions: content.instructions,
      documentType: content.documentType,
      head_seq: doc.head_seq + 1,
      updated_at: new Date().toISOString(),
    };
    fixtures.documents.set(doc._id, restored);
    history.pointer = params.revision_id;
    const head = headOf(restored);
    fixtures.idempotency.set(key, { request: fingerprint, head, etag: etagOf(restored) });
    return response(200).json(head, { headers: { ETag: etagOf(restored) } });
  }),
];

/* ----------------------------------------
   Chats and chat images
   ---------------------------------------- */

const chatNotFound = () => problem('chat_not_found', 'Chat not found');

const chatHandlers = [
  http.get('/workspaces/{workspace_id}/documents/{document_id}/chats', ({ params, query, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const limit = bounded(query.get('limit'), 'limit', 20, 1, 100);
    if (typeof limit !== 'number') return limit;
    const rows = [...chatsOf(doc._id)]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
    const page = pageOf(rows, limit, query.get('cursor'), `chats:${doc._id}`);
    if (!page) return problem('invalid_cursor', 'Invalid chat cursor');
    return response(200).json({ items: page.rows.map(chatSummary), next_cursor: page.next });
  }),

  http.patch('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}', async ({ params, request, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const chat = chatsOf(doc._id).find((item) => item.id === params.chat_id);
    if (!chat) return chatNotFound();
    const { title } = await request.json();
    chat.title = title?.trim() || null;
    chat.updated_at = new Date().toISOString();
    return response(200).json(chatSummary(chat));
  }),

  http.delete('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}', ({ params, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const list = chatsOf(doc._id);
    if (!list.some((chat) => chat.id === params.chat_id)) return chatNotFound();
    fixtures.chats.set(doc._id, list.filter((chat) => chat.id !== params.chat_id));
    detachChatAssets(params.workspace_id, params.chat_id);
    for (const [id, stored] of fixtures.plans) {
      if (stored.workspaceId === params.workspace_id && stored.chatId === params.chat_id) fixtures.plans.delete(id);
    }
    return response(204).empty();
  }),

  // The branch from the first message to `leaf`, the chat's newest message by default.
  http.get('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}/messages', ({ params, query, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const chat = chatsOf(doc._id).find((item) => item.id === params.chat_id);
    if (!chat) return chatNotFound();
    const raw = query.get('leaf');
    const leaf = raw === null ? (newestMessage(chat)?.id ?? null) : bounded(raw, 'leaf', 1, 1);
    if (leaf !== null && typeof leaf !== 'number') return leaf;
    if (leaf !== null && !chat.messages.some((item) => item.id === leaf)) return problem('message_not_found', 'Message not found');
    return response(200).json({ items: leaf === null ? [] : messageChain(chat, leaf), leaf_id: leaf });
  }),

  http.get('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}/sources/{handle}', ({ params, query, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const chat = chatsOf(doc._id).find((item) => item.id === params.chat_id);
    if (!chat) return chatNotFound();
    if (!/^S[1-9]\d*$/.test(params.handle)) return problem('invalid_request', 'Invalid source handle.');
    const source = chat.evidence.sources.find((item) => item.handle === params.handle);
    const passage = query.get('passage');
    if (passage !== null && !/^S[1-9]\d*\.[1-9]\d*$/.test(passage)) return problem('invalid_request', 'Invalid passage id.');
    if (!source || (passage !== null && !passage.startsWith(params.handle + '.'))) {
      return problem('source_not_found', 'That source or passage is not in this chat.');
    }
    const rows = chat.evidence.passages.filter((item) => item.id.startsWith(params.handle + '.')
      && (passage === null || item.id === passage));
    if (passage !== null && !rows.length) return problem('source_not_found', 'That source or passage is not in this chat.');
    const limit = bounded(query.get('limit'), 'limit', 20, 1, 50);
    if (typeof limit !== 'number') return limit;
    const page = pageOf(rows, limit, query.get('cursor'), `chat-source:${doc._id}:${chat.id}:${params.handle}:${passage ?? ''}`);
    if (!page) return problem('invalid_cursor', 'Invalid source cursor');
    const { aliases: _aliases, ...publicSource } = source;
    return response(200).json({
      source: publicSource,
      passages: page.rows.map((item) => ({ ...item, locator: {} })),
      next_cursor: page.next,
    });
  }),

  http.get('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}/plans/{plan_id}', ({ params, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    if (!chatsOf(doc._id).some((chat) => chat.id === params.chat_id)) return chatNotFound();
    const plan = planOf(params.workspace_id, doc._id, params.chat_id, params.plan_id);
    if (!plan) return problem('plan_not_found', 'Plan not found');
    return response(200).json(plan, { headers: { ETag: planEtag(plan) } });
  }),

  http.patch('/workspaces/{workspace_id}/documents/{document_id}/chats/{chat_id}/plans/{plan_id}', async ({ params, request, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    if (!chatsOf(doc._id).some((chat) => chat.id === params.chat_id)) return chatNotFound();
    const plan = planOf(params.workspace_id, doc._id, params.chat_id, params.plan_id);
    if (!plan) return problem('plan_not_found', 'Plan not found');
    const match = /^\s*(?:W\/)?"cwplan:(\d+)"\s*$/.exec(request.headers.get('If-Match') ?? '');
    if (!match) return problem('precondition_required', 'If-Match must be the plan’s ETag.');
    try {
      const updated = updatePlan(plan, Number(match[1]), await request.json());
      return response(200).json(updated, { headers: { ETag: planEtag(updated) } });
    } catch (error) {
      if (!(error instanceof MockPlanRefusal)) throw error;
      return problem(error.code, error.message, { expected_head: error.expected_head, current_head: error.current_head });
    }
  }),

  http.post('/workspaces/{workspace_id}/assets', async ({ params, request, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const key = request.headers.get('Idempotency-Key')?.trim();
    if (!key || key.length > 200 || /[^\x20-\x7e]/.test(key)) return problem('invalid_idempotency_key', 'A valid Idempotency-Key is required');
    const form = await formOf(request);
    const file = form?.get('file');
    // Request.formData() may return a File from another realm (Node/MSW).
    if (!file || typeof file === 'string') return invalidRequest(['body', 'file'], 'Field required');
    try {
      const stored = await storeAsset(workspace, key, file, file.name);
      return response(201).json(stored.asset);
    } catch (error) {
      if (error instanceof MockAssetError) return problem(error.code, error.message);
      throw error;
    }
  }),

  http.get('/workspaces/{workspace_id}/assets/{asset_id}', ({ params, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    if (!validAssetId(params.asset_id)) return invalidRequest(['path', 'asset_id'], 'Invalid asset id');
    const stored = readableAsset(workspace, params.asset_id);
    return stored ? response(200).json(stored.asset) : problem('asset_not_found', 'Asset not found');
  }),

  http.get('/workspaces/{workspace_id}/assets/{asset_id}/content', ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    if (!validAssetId(params.asset_id)) return invalidRequest(['path', 'asset_id'], 'Invalid asset id');
    const rendition = query.get('rendition') ?? 'original';
    if (!['original', 'display', 'thumbnail'].includes(rendition)) return invalidRequest(['query', 'rendition'], 'Unknown rendition');
    const stored = readableAsset(workspace, params.asset_id);
    if (!stored) return problem('asset_not_found', 'Asset not found');
    // The mock serves the uploaded bytes for every rendition. Full decoding,
    // all-frame validation and separate PNG derivatives are API tests.
    return response.untyped(new HttpResponse(stored.file, { headers: {
      'Content-Type': stored.asset.media_type, 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable', Vary: 'Cookie, Authorization',
      ETag: `"${params.asset_id}:${rendition}:${stored.asset.sha256}"`,
    } }));
  }),
];

/* ----------------------------------------
   The person: session, profile, tools, engines
   ---------------------------------------- */

const accountHandlers = [
  http.post('/auth/login', ({ response }) => response(200).json(AUTH_SESSION)),
  http.post('/auth/refresh', ({ response }) => response(200).json(AUTH_SESSION)),
  http.post('/auth/logout', ({ response }) => response(200).json({ success: true, message: 'Signed out' })),

  http.get('/users/me', ({ response }) => response(200).json(me())),
  http.patch('/users/me', async ({ request, response }) => {
    const changes = await request.json();
    for (const [field, value] of Object.entries(changes)) {
      if (value !== undefined) Object.assign(fixtures.profile, { [field]: value });
    }
    return response(200).json(me());
  }),

  http.get('/users/me/assistant', ({ response }) => response(200).json(assistantSettingsOf(fixtures.assistant))),
  http.put('/users/me/assistant', async ({ request, response }) => {
    const body: unknown = await request.json();
    // `UpdateAssistantSettingsRequest` forbids anything else, strictly typed.
    const refusal = assistantUpdateRefusal(body);
    if (refusal) return invalidRequest(refusal.loc, refusal.msg);
    fixtures.assistant = updateAccountSwitches(fixtures.assistant, body as Parameters<typeof updateAccountSwitches>[1]);
    return response(200).json(assistantSettingsOf(fixtures.assistant));
  }),

  agentHttp.get('/api/agent/engines', ({ response }) => response(200).json({
    runtime: 'local',
    default_engine: 'gateway',
    engines: Object.values(fixtures.engines),
    gateway_models: GATEWAY_MODELS,
  })),
  agentHttp.post('/api/agent/engines/{engine_id}/check', ({ params, response }) => {
    const id = params.engine_id;
    if (id !== 'gateway' && id !== 'claude' && id !== 'codex') {
      return invalidRequest(['path', 'engine_id'], "Input should be 'gateway', 'claude' or 'codex'");
    }
    if (id === 'codex') {
      fixtures.engines.codex = {
        engine: 'codex', name: 'Codex', state: 'ready', available: true,
        message: 'Signed in to Codex with your ChatGPT account.', auth_method: 'chatgpt',
        version: 'codex-cli 0.156.1', checked_at: Date.now() / 1000,
      };
    }
    return response(200).json(fixtures.engines[id]);
  }),
];

/**
 * Why `PUT /users/me/assistant` refuses a body, as its strict request model
 * does: a field it does not have, a switch that is not a boolean, an unknown
 * paper source (422).
 */
function assistantUpdateRefusal(body: unknown): { loc: string[]; msg: string } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { loc: ['body'], msg: 'Input should be a valid dictionary' };
  const switches = new Set<string>(ASSISTANT_REGISTRY.switches.map((item) => item.id));
  const sources = new Set<string>(ASSISTANT_REGISTRY.sources.map((item) => item.id));
  for (const [field, value] of Object.entries(body)) {
    if (field === 'sources') {
      if (value === null) continue;
      if (typeof value !== 'object' || Array.isArray(value)) return { loc: ['body', 'sources'], msg: 'Input should be a valid dictionary' };
      for (const [source, chosen] of Object.entries(value as Json)) {
        if (!sources.has(source)) return { loc: ['body', 'sources', source], msg: "Input should be 'semantic_scholar'" };
        if (typeof chosen !== 'boolean') return { loc: ['body', 'sources', source], msg: 'Input should be a valid boolean' };
      }
    } else if (!switches.has(field)) {
      return { loc: ['body', field], msg: 'Extra inputs are not permitted' };
    } else if (value !== null && typeof value !== 'boolean') {
      return { loc: ['body', field], msg: 'Input should be a valid boolean' };
    }
  }
  return null;
}

/**
 * `GET /workspaces/{w}/assistant/catalog?engine=`: every member reads it, a
 * viewer included; computed for the account, the workspace's policy, the
 * account's role there and the engine (`./assistantCatalog`).
 */
const catalogHandlers = [
  http.get('/workspaces/{workspace_id}/assistant/runs', ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const limit = Math.max(1, Math.min(50, Number(query.get('limit') ?? 20)));
    const page = pageOf(previewRuns(workspace), limit, query.get('cursor'), `assistant-runs:${workspace}`);
    if (!page) return problem('invalid_cursor', 'Invalid runs cursor');
    return response(200).json({ items: page.rows, next_cursor: page.next });
  }),

  http.get('/workspaces/{workspace_id}/assistant/catalog', ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const engine = query.get('engine') ?? 'gateway';
    if (engine !== 'gateway' && engine !== 'claude' && engine !== 'codex') {
      return invalidRequest(['query', 'engine'], "Input should be 'gateway', 'claude' or 'codex'");
    }
    return response(200).json(catalogOf(workspace, engine));
  }),
];

/* ----------------------------------------
   Research and sources
   ---------------------------------------- */

/** The policy refusal of a route that sends the caller's input to a scholarly service (`workspace_destination`). */
const OUTSIDE_RESEARCH_OFF = () => problem('workspace_policy', "This workspace's policy turned off outside research.", { policy: 'outside_research' });

/** The workspace, where its policy allows outside research, or the refusal. */
function scholarlyWorkspaceOr(id: string): string | HttpResponse<ProblemDetails> {
  const workspace = workspaceOr(id);
  if (isProblem(workspace)) return workspace;
  return workspacePolicyOf(workspace).outside_research ? workspace : OUTSIDE_RESEARCH_OFF();
}

/** The paper sources the account may use here: Papers on, each source on, and configured on the mock's server. */
function accountPaperSources(): string[] {
  const papers = fixtures.assistant.switches.papers ?? ASSISTANT_REGISTRY.switches.find((item) => item.id === 'papers')?.default ?? false;
  if (!papers) return [];
  return ASSISTANT_REGISTRY.sources
    .filter((source) => (fixtures.assistant.sources[source.id] ?? source.default) && MOCK_DEPLOYMENT.paperSources.has(source.id))
    .map((source) => source.id);
}

const sourceDisabled = (source = 'papers') => problem(
  'paper_source_disabled',
  'Paper search is switched off for this account. Turn on Papers and a paper source in Settings → AI & tools.',
  { source },
);

/** The workspace a paper route may search from, or why not: the policy, then the account (`account_paper_sources`). */
function paperWorkspaceOr(id: string): string | HttpResponse<ProblemDetails> {
  const workspace = scholarlyWorkspaceOr(id);
  if (isProblem(workspace)) return workspace;
  return accountPaperSources().length ? workspace : sourceDisabled();
}

/** A work by its key with its scheme, as `/papers/{key}` names it. */
function paperOr(raw: string): MockPaper | HttpResponse<ProblemDetails> {
  const key = decodeURIComponent(raw);
  if (!/^(doi|arxiv|pmid|pmcid|openalex|s2|corpusid):\S/i.test(key)) {
    return problem('unrecognized_identifier', 'Name the paper by an identifier with its scheme: doi:10.…, arxiv:2101.00001, pmid:…, openalex:W…');
  }
  return paperByKey(key) ?? problem('paper_not_found', 'No paper source knows that work.');
}

/** An identifier as the resolver reads it (`parse_work_id`): its key, with its scheme. */
function identifierKeyOf(raw: string): string | null {
  const value = raw.trim();
  const doi = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  if (/^10\.\d{4,9}\/\S+$/.test(doi)) return `doi:${doi.toLowerCase()}`;
  const arxiv = value.replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, '').replace(/^arxiv:\s*/i, '').replace(/v\d+$/, '');
  if (/^\d{4}\.\d{4,5}$/.test(arxiv)) return `arxiv:${arxiv}`;
  if (/^(pmid|pmcid|openalex|s2|corpusid):\S/i.test(value)) return value.replace(/^[a-z]+:/i, (scheme) => scheme.toLowerCase());
  return null;
}

/** Titles as the identity match compares them: case, accents, punctuation and spacing folded. */
const foldTitle = (title: string) => title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The venue a statement is asked for, as the contract lists them. */
const VENUE_IDS = new Set(MOCK_VENUES.map((venue) => venue.id));

const referenceHandlers = [
  // A claim check reads and advises: every member may ask (P2.API-5).
  http.post('/workspaces/{workspace_id}/claims/check', async ({ params, request, response }) => {
    const workspace = paperWorkspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const body = await request.json();
    const claim = typeof body.claim === 'string' ? body.claim.split(/\s+/).join(' ').trim() : '';
    if (!claim || claim.length > 2_000) return problem('invalid_request', 'claim is one assertion in words', { errors: [{ loc: ['body', 'claim'], msg: 'claim is one assertion in words', type: 'value_error' }] });
    const sources = [...new Set((body.sources ?? []).map((item) => item.trim()).filter(Boolean))];
    if (sources.length > 10) return problem('invalid_request', 'At most ten sources', { errors: [{ loc: ['body', 'sources'], msg: 'at most 10 items', type: 'too_long' }] });
    if (sources.some((key) => !/^(doi|arxiv|pmid|pmcid|openalex|s2|corpusid):\S/i.test(key))) {
      return problem('unrecognized_identifier', 'Name each paper by an identifier with its scheme: doi:10.…, arxiv:2101.00001, pmid:…, openalex:W…');
    }
    const job = startJob(workspace, 'claim_check', 1, jobResult({ claim: claimCheckResult(claim, sources) }));
    return response(202).json({ job: jobState(job) });
  }),
  // The audit is an editor's (the role guard says so before it runs).
  http.post('/workspaces/{workspace_id}/documents/{document_id}/references/check', ({ params, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    return response(202).json({ job: jobState(startReferenceAudit(params.workspace_id, doc)) });
  }),
  http.get('/workspaces/{workspace_id}/documents/{document_id}/references/status', ({ params, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const report = fixtures.referenceAudits.get(doc._id);
    return report ? response(200).json(structuredClone(report)) : problem('reference_audit_not_found', 'This page’s references have not been checked yet.');
  }),
  http.get('/workspaces/{workspace_id}/documents/{document_id}/ai-use', ({ params, query, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const limit = bounded(query.get('limit'), 'limit', 100, 1, 200);
    if (typeof limit !== 'number') return limit;
    const page = pageOf(aiUseEntries(doc._id), limit, query.get('cursor'), `ai-use:${doc._id}`);
    if (!page) return problem('invalid_cursor', 'The cursor is not one this list returned');
    return response(200).json({ entries: page.rows, next_cursor: page.next });
  }),
  http.get('/workspaces/{workspace_id}/documents/{document_id}/ai-use/statement', ({ params, query, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const venue = MOCK_VENUES.find((item) => item.id === query.get('venue'));
    if (!venue || !VENUE_IDS.has(venue.id)) return problem('invalid_request', `Unknown venue: one of ${[...VENUE_IDS].join(', ')}`);
    return response(200).json(renderStatement(venue, aiUseEntries(doc._id)));
  }),
];

const researchHandlers = [
  http.get('/workspaces/{workspace_id}/papers/search', ({ params, query, response }) => {
    const workspace = paperWorkspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const limit = bounded(query.get('limit'), 'limit', 20, 1, 50);
    if (typeof limit !== 'number') return limit;
    const year = (name: 'year_from' | 'year_to') => Number(query.get(name)) || undefined;
    return response(200).json(paperSearch(query.get('query') ?? '', {
      yearFrom: year('year_from'), yearTo: year('year_to'), limit, cursor: query.get('cursor'),
    }));
  }),
  http.get('/workspaces/{workspace_id}/papers/passages', ({ params, query, response }) => {
    const workspace = paperWorkspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const limit = bounded(query.get('limit'), 'limit', 8, 1, 20);
    if (typeof limit !== 'number') return limit;
    return response(200).json(paperPassages(query.get('query') ?? '', query.getAll('papers'), limit));
  }),
  http.get('/workspaces/{workspace_id}/papers/{key}/graph', ({ params, query, response }) => {
    const workspace = paperWorkspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const seed = paperOr(params.key);
    if (isProblem(seed)) return seed;
    const relation = query.get('relation');
    if (relation !== 'references' && relation !== 'citations' && relation !== 'related') {
      return problem('invalid_request', 'relation must be references, citations or related');
    }
    return response(200).json(paperGraph(seed, relation));
  }),
  http.get('/workspaces/{workspace_id}/papers/{key}', ({ params, response }) => {
    const workspace = paperWorkspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const paper = paperOr(params.key);
    if (isProblem(paper)) return paper;
    return response(200).json(paperDetail(paper));
  }),
  // The pipeline: resolve at the registry, match the claimed work, corroborate, read the status.
  http.get('/workspaces/{workspace_id}/sources/resolve', ({ params, query, response }) => {
    const workspace = scholarlyWorkspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const key = identifierKeyOf(query.get('identifier') ?? '');
    if (!key) return problem('unrecognized_identifier', 'Enter a DOI, an arXiv id, a PMID or a paper source’s id.');
    if (/^(s2|corpusid|openalex):/.test(key)) {
      const source = key.startsWith('openalex:') ? 'openalex' : 'semantic_scholar';
      if (!accountPaperSources().includes(source)) return sourceDisabled(source);
    }
    const known = KNOWN_WORKS.find((work) => work.key === key) ?? paperByKey(key)?.record;
    let record: ReferenceRecordOutput;
    if (known) {
      record = { ...structuredClone(known), state: known.state === 'unchecked' ? 'verified' : known.state, checked: '2026-09-20' };
    } else if (key.startsWith('doi:')) {
      // Any other DOI: one registry has it, so it is to be reviewed.
      record = {
        key, kind: 'paper', provider: 'crossref', state: 'needs_review', flags: [], checked: '2026-09-20',
        csl: { id: key, type: 'article-journal', title: 'A resolved paper', author: [{ family: 'Author', given: 'A.' }], issued: { 'date-parts': [[2024]] }, DOI: key.slice(4) },
      };
    } else {
      return problem('source_not_found', 'No registry has a record for that identifier.');
    }
    const claimed = query.get('title')?.trim();
    if (claimed && foldTitle(claimed) !== foldTitle(record.csl.title)) {
      return problem('source_mismatch', 'That identifier names a different work.', { claimed_title: claimed, found_title: record.csl.title });
    }
    const aliases = paperByKey(key)?.aliases ?? [];
    return response(200).json({ source: record, aliases, notes: [] });
  }),
];

/* ----------------------------------------
   PDFs and the Library
   ---------------------------------------- */

const resourceNotFound = () => problem('resource_not_found', 'Resource not found');
const collectionNotFound = () => problem('collection_not_found', 'Collection not found');

/** Reads a multipart upload's parts; a body the runtime cannot parse has none. */
async function formOf(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

/** A PDF of the workspace; another workspace's is not found. */
function pdfOr(workspaceId: string, resourceId: string | number): StoredPdf | HttpResponse<ProblemDetails> {
  const workspace = workspaceOr(workspaceId);
  if (isProblem(workspace)) return workspace;
  return pdfsIn(workspace).find((item) => item.id === Number(resourceId)) ?? resourceNotFound();
}

/** The PDFs of one scope, as `sp_resource_scope_list` selects and orders them, bounded by the workspace. */
function resourcesIn(
  workspaceId: string,
  scope: string,
  documentId: string | null,
  collectionId: number | null,
): StoredPdf[] | HttpResponse<ProblemDetails> {
  const scopes = ['library', 'unfiled', 'document', 'context', 'collection', 'collection_recursive'];
  if (!scopes.includes(scope)) return invalidRequest(['query', 'scope'], `scope must be one of ${JSON.stringify([...scopes].sort())}`);
  if ((scope === 'document' || scope === 'context') && !documentId) return problem('bad_request', `document_id is required for ${scope} scope`);
  if ((scope === 'collection' || scope === 'collection_recursive') && collectionId === null) {
    return problem('bad_request', `collection_id is required for ${scope} scope`);
  }
  if (documentId && !workspaceDocument(workspaceId, documentId)) return documentNotFound();
  if (collectionId !== null && !workspaceCollection(workspaceId, collectionId)) return collectionNotFound();
  const subtree = new Set(collectionId === null ? [] : collectionSubtree(collectionId).map((item) => item.id));
  const reachable = new Set(
    liveCollections(workspaceId)
      .filter((collection) => documentId && collection.grants.has(documentId))
      .flatMap((collection) => collectionSubtree(collection.id).map((item) => item.id)),
  );
  const unfiled = (pdf: StoredPdf) => pdf.document_id === null && pdf.collection_id === null;
  return pdfsIn(workspaceId)
    .filter((pdf) => {
      switch (scope) {
        case 'unfiled': return unfiled(pdf);
        case 'collection': return pdf.collection_id === collectionId;
        case 'collection_recursive': return pdf.collection_id !== null && subtree.has(pdf.collection_id);
        case 'document':
        case 'context':
          return pdf.document_id === documentId
            || (scope === 'context' && unfiled(pdf))
            || (pdf.collection_id !== null && reachable.has(pdf.collection_id));
        default: return true;
      }
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
}

const number = (value: string | null) => (value === null || value === '' ? null : Number(value));

const resourceHandlers = [
  http.get('/workspaces/{workspace_id}/resources', ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const limit = bounded(query.get('limit'), 'limit', 50, 1, 100);
    if (typeof limit !== 'number') return limit;
    const scope = query.get('scope') ?? 'library';
    const rows = resourcesIn(workspace, scope, query.get('document_id'), number(query.get('collection_id')));
    if (!Array.isArray(rows)) return rows;
    const page = pageOf(rows, limit, query.get('cursor'), `resources:${workspace}:${scope}:${query.get('document_id')}:${query.get('collection_id')}`);
    if (!page) return problem('invalid_cursor', 'Invalid resource cursor');
    return response(200).json({ items: page.rows.map(pdfItem), next_cursor: page.next });
  }),

  // There is no default location: the client says where the PDF goes.
  http.post('/workspaces/{workspace_id}/resources', async ({ params, request, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    if (!request.headers.get('Idempotency-Key')) return invalidRequest(['header', 'Idempotency-Key'], 'Field required');
    const form = await formOf(request);
    const file = form?.get('file');
    if (!(file instanceof Blob)) return invalidRequest(['body', 'file'], 'Field required');
    const name = file instanceof File ? file.name : 'upload.pdf';
    if (file.size === 0) return problem('upload_empty', 'The file is empty');
    if (file.type && file.type !== 'application/pdf') return problem('upload_not_pdf', 'Choose a PDF');
    const location = form?.get('location');
    const documentId = form?.get('document_id');
    const collectionId = form?.get('collection_id');
    if (location !== 'document' && location !== 'collection' && location !== 'unfiled') {
      return invalidRequest(['body', 'location'], "Input should be 'document', 'collection' or 'unfiled'");
    }
    if (location === 'document' && (typeof documentId !== 'string' || !workspaceDocument(workspace, documentId))) return documentNotFound();
    if (location === 'collection' && (typeof collectionId !== 'string' || !workspaceCollection(workspace, Number(collectionId)))) {
      return collectionNotFound();
    }
    const id = Math.max(0, ...fixtures.pdfs.map((item) => item.id)) + 1;
    const pdf: StoredPdf = {
      ...pdfRow(id, name, name.replace(/\.pdf$/i, ''), new Date().toISOString(), workspace),
      byte_size: file.size,
      document_id: location === 'document' ? String(documentId) : null,
      collection_id: location === 'collection' ? Number(collectionId) : null,
    };
    fixtures.pdfs.unshift(pdf);
    fixtures.pdfFiles.set(id, file);
    return response(201).json(pdfItem(pdf));
  }),

  http.get('/workspaces/{workspace_id}/resources/search', ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const term = query.get('query') ?? '';
    const scope = query.get('scope') ?? 'library';
    const rows = resourcesIn(workspace, scope, query.get('document_id'), number(query.get('collection_id')));
    if (!Array.isArray(rows)) return rows;
    const only = number(query.get('resource_id'));
    const searched = only === null ? rows : rows.filter((pdf) => pdf.id === only);
    const items = searched.map((pdf, index) => ({
      resource_id: pdf.id,
      filename: pdf.filename,
      title: pdf.title,
      offset: 1200 + index * 800,
      excerpt: `… the auxiliary ${term} term keeps experts evenly used; without it, a few experts receive most tokens and the rest collapse …`,
    }));
    return response(200).json({
      query: term, scope: scope as 'library', items, resources_searched: searched.length, resources_skipped: [], truncated: false, next_cursor: null,
    });
  }),

  http.get('/workspaces/{workspace_id}/resources/{resource_id}', ({ params, response }) => {
    const pdf = pdfOr(params.workspace_id, params.resource_id);
    return isProblem(pdf) ? pdf : response(200).json(pdfItem(pdf));
  }),

  http.patch('/workspaces/{workspace_id}/resources/{resource_id}', async ({ params, request, response }) => {
    const pdf = pdfOr(params.workspace_id, params.resource_id);
    if (isProblem(pdf)) return pdf;
    const filename = (await request.json()).filename?.trim() ?? '';
    if (!filename || filename.length > 255) return invalidRequest(['body', 'filename'], 'String should have 1 to 255 characters');
    pdf.filename = filename;
    pdf.updated_at = new Date().toISOString();
    return response(200).json(pdfItem(pdf));
  }),

  // To the Trash on its own; trashing it again answers the same.
  http.post('/workspaces/{workspace_id}/resources/{resource_id}/trash', ({ params, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const pdf = fixtures.pdfs.find((item) => item.workspace_id === workspace && item.id === Number(params.resource_id));
    // One that went with its page or a collection is gone, as far as this route can tell.
    if (!pdf || (pdf.trashed_at && pdf.trash_root?.kind !== 'resource')) return resourceNotFound();
    if (!roleAllows(workspace, 'editor')) return roleRequired('editor');
    if (!pdf.trashed_at) trashPdf(pdf);
    return response(200).json({ id: pdf.id, trashed_at: pdf.trashed_at as string, purge_after: purgeAfterOf(pdf.trashed_at) as string });
  }),

  // Back to its location, or to Unfiled when that page or collection is gone.
  http.post('/workspaces/{workspace_id}/resources/{resource_id}/restore', ({ params, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const pdf = fixtures.pdfs.find((item) => item.workspace_id === workspace && item.id === Number(params.resource_id));
    if (!pdf) return resourceNotFound();
    if (!pdf.trashed_at) return problem('not_in_trash', 'The PDF is not in the Trash');
    if (pdf.trash_root?.kind !== 'resource') return resourceNotFound();
    if (!mayRestore(workspace, pdf.trashed_by)) return roleRequired('admin');
    return response(200).json(pdfItem(restorePdf(pdf)));
  }),

  http.get('/workspaces/{workspace_id}/resources/{resource_id}/content', ({ params, response }) => {
    const pdf = pdfOr(params.workspace_id, params.resource_id);
    if (isProblem(pdf)) return pdf;
    const file = fixtures.pdfFiles.get(pdf.id);
    if (!file) return problem('resource_not_found', 'The preview has metadata only for this sample PDF.');
    return response.untyped(new HttpResponse(file, { headers: { 'Content-Type': 'application/pdf' } }));
  }),

  http.get('/workspaces/{workspace_id}/resources/{resource_id}/markdown', ({ params, query, response }) => {
    const pdf = pdfOr(params.workspace_id, params.resource_id);
    if (isProblem(pdf)) return pdf;
    const all = `# ${pdf.title ?? 'Document'}\n\nMixture-of-experts layers route each token to a few experts. The auxiliary load balancing loss term keeps experts evenly used.`;
    const offset = bounded(query.get('offset'), 'offset', 0, 0);
    const limit = bounded(query.get('limit'), 'limit', 20_000, 1, 120_000);
    if (typeof offset !== 'number') return offset;
    if (typeof limit !== 'number') return limit;
    const text = all.slice(offset, offset + limit);
    const end = offset + text.length;
    return response(200).json({
      resource: pdfItem(pdf), text, offset, returned_chars: text.length, total_chars: all.length,
      next_offset: end < all.length ? end : null, truncated: end < all.length,
    });
  }),

  http.post('/workspaces/{workspace_id}/resources/{resource_id}/extract', ({ params, response }) => {
    const pdf = pdfOr(params.workspace_id, params.resource_id);
    if (isProblem(pdf)) return pdf;
    pdf.extraction = { ...pdf.extraction, status: 'ready', error: null, extracted_at: new Date().toISOString() };
    return response(200).json(pdfItem(pdf));
  }),

  // A PDF is on one page, in one collection or Unfiled; a target in another workspace is not found.
  http.put('/workspaces/{workspace_id}/resources/{resource_id}/location', async ({ params, request, response }) => {
    const pdf = pdfOr(params.workspace_id, params.resource_id);
    if (isProblem(pdf)) return pdf;
    const target = await request.json();
    if (target.kind === 'document') {
      if (!workspaceDocument(pdf.workspace_id, target.document_id)) return documentNotFound();
      Object.assign(pdf, { document_id: target.document_id, collection_id: null });
    } else if (target.kind === 'collection') {
      if (!workspaceCollection(pdf.workspace_id, target.collection_id)) return collectionNotFound();
      Object.assign(pdf, { document_id: null, collection_id: target.collection_id });
    } else {
      Object.assign(pdf, { document_id: null, collection_id: null });
    }
    pdf.updated_at = new Date().toISOString();
    return response(200).json(pdfItem(pdf));
  }),
];

/** The API's limits: 32 levels, root = 1, and 10,000 live collections per workspace. */
const MAX_COLLECTION_DEPTH = 32;
const COLLECTION_LIMIT = 10_000;

/** A collection write's `If-Match` (428 without one, 412 `stale_collection` when it is not the row's). */
function collectionPrecondition(request: Request, collection: StoredCollection): HttpResponse<ProblemDetails> | null {
  const ifMatch = request.headers.get('If-Match');
  if (!ifMatch) return problem('precondition_required', 'If-Match is required');
  if (ifMatch !== collectionEtagOf(collection)) {
    return problem('stale_collection', 'The collection changed since it was read', { expected_head: ifMatch, current_head: collectionEtagOf(collection) });
  }
  return null;
}

/** A collection's ETag header, beside the `etag` its detail carries. */
const collectionHeaders = (collection: StoredCollection) => ({ headers: { ETag: collectionEtagOf(collection) } });

/** The tallest chain of collections under (and including) this one. */
function subtreeHeight(id: number): number {
  const root = fixtures.collections.get(id);
  if (!root) return 0;
  return 1 + Math.max(0, ...collectionChildren(root.workspace_id, id).map((child) => subtreeHeight(child.id)));
}

function collectionOr(workspaceId: string, collectionId: string | number): StoredCollection | HttpResponse<ProblemDetails> {
  const workspace = workspaceOr(workspaceId);
  if (isProblem(workspace)) return workspace;
  return workspaceCollection(workspace, Number(collectionId)) ?? collectionNotFound();
}

const collectionHandlers = [
  // The top level, or one collection's immediate children; `grant_state_for` adds a page's grant on each.
  http.get('/workspaces/{workspace_id}/collections', ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const limit = bounded(query.get('limit'), 'limit', 50, 1, 100);
    if (typeof limit !== 'number') return limit;
    const parent = query.get('parent_id') ?? 'root';
    const parentId = parent === 'root' ? null : Number(parent);
    if (parentId !== null && !workspaceCollection(workspace, parentId)) return collectionNotFound();
    const grantStateFor = query.get('grant_state_for');
    if (grantStateFor && !workspaceDocument(workspace, grantStateFor)) return documentNotFound();
    // In the parent's order; a cursor read before that order changed no longer continues it.
    const rows = orderedCollections(workspace, parentId);
    const page = pageOf(rows, limit, query.get('cursor'), `collections:${workspace}:${parent}:${sortModeOf(workspace, parentId)}`);
    if (!page) return problem('invalid_cursor', 'Invalid collection cursor');
    return response(200).json({
      items: page.rows.map((collection) => collectionSummary(collection, grantStateFor)),
      next_cursor: page.next,
    });
  }),

  http.post('/workspaces/{workspace_id}/collections', async ({ params, request, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    if (!request.headers.get('Idempotency-Key')) return invalidRequest(['header', 'Idempotency-Key'], 'Field required');
    const body = await request.json();
    const name = body.name.trim() || 'Untitled collection';
    const parentId = body.parent_id ?? null;
    if (parentId !== null && !workspaceCollection(workspace, parentId)) return collectionNotFound();
    if (parentId !== null && collectionPath(parentId).length >= MAX_COLLECTION_DEPTH) return problem('depth_limit', 'Collections nest at most 32 deep');
    if (liveCollections(workspace).length >= COLLECTION_LIMIT) {
      return problem('collection_limit', 'This workspace holds as many collections as it can', { limit: COLLECTION_LIMIT });
    }
    const siblings = collectionChildren(workspace, parentId).sort(byKey((row) => row.id));
    const sortKey = keyAt(siblings, body.position as Position, (row) => row.id);
    if (sortKey === null) return problem('invalid_position', 'The position names no collection there');
    const now = new Date().toISOString();
    const collection: StoredCollection = {
      id: fixtures.nextCollectionId++, workspace_id: workspace, name, description: body.description ?? null,
      parent_id: parentId, sort_key: sortKey, sort_mode: 'name', grant_new_pages: false, row_version: 1,
      grants: new Map(), created_at: now, updated_at: now, trashed_at: null, trash_root_id: null, trashed_by: null,
    };
    fixtures.collections.set(collection.id, collection);
    bumpTree(workspace);
    return response(201).json(collectionDetail(collection), { headers: { ETag: collectionEtagOf(collection) } });
  }),

  http.get('/workspaces/{workspace_id}/collections/{collection_id}', ({ params, response }) => {
    const collection = collectionOr(params.workspace_id, params.collection_id);
    return isProblem(collection) ? collection : response(200).json(collectionDetail(collection), { headers: { ETag: collectionEtagOf(collection) } });
  }),

  // Only the fields present change; `sort_mode` and `grant_new_pages` among them.
  http.patch('/workspaces/{workspace_id}/collections/{collection_id}', async ({ params, request, response }) => {
    const collection = collectionOr(params.workspace_id, params.collection_id);
    if (isProblem(collection)) return collection;
    const stale = collectionPrecondition(request, collection);
    if (stale) return stale;
    const { name, description, sort_mode: sortMode, grant_new_pages: grantNewPages } = await request.json();
    if (typeof name === 'string') collection.name = name.trim() || 'Untitled collection';
    if (description !== undefined) collection.description = description;
    if (sortMode) collection.sort_mode = sortMode as SortMode;
    // The setting applies to pages placed after it is on; it grants no page already there.
    if (typeof grantNewPages === 'boolean') collection.grant_new_pages = grantNewPages;
    collection.row_version += 1;
    collection.updated_at = new Date().toISOString();
    bumpTree(collection.workspace_id);
    return response(200).json(collectionDetail(collection), collectionHeaders(collection));
  }),

  // The subtree moves under `parent_id` (`null` for the top level), at `position` among its new siblings.
  http.post('/workspaces/{workspace_id}/collections/{collection_id}/move', async ({ params, request, response }) => {
    const collection = collectionOr(params.workspace_id, params.collection_id);
    if (isProblem(collection)) return collection;
    const stale = collectionPrecondition(request, collection);
    if (stale) return stale;
    const { parent_id: parentId = null, position } = await request.json();
    if (parentId !== null && !workspaceCollection(collection.workspace_id, parentId)) return collectionNotFound();
    if (parentId !== null && collectionSubtree(collection.id).some((item) => item.id === parentId)) {
      return problem('cycle', 'A collection cannot move under itself');
    }
    if (parentId === collection.parent_id) return problem('unchanged', 'The collection is already there');
    const depth = parentId === null ? 0 : collectionPath(parentId).length;
    if (depth + subtreeHeight(collection.id) > MAX_COLLECTION_DEPTH) return problem('depth_limit', 'Collections nest at most 32 deep');
    const siblings = collectionChildren(collection.workspace_id, parentId).sort(byKey((row) => row.id));
    const sortKey = keyAt(siblings, position as Position, (row) => row.id);
    if (sortKey === null) return problem('invalid_position', 'The position names no collection there');
    collection.parent_id = parentId;
    collection.sort_key = sortKey;
    collection.row_version += 1;
    collection.updated_at = new Date().toISOString();
    bumpTree(collection.workspace_id);
    // Pages below follow their new path's "Pages here can use these PDFs".
    const moved = new Set(collectionSubtree(collection.id).map((item) => item.id));
    for (const doc of documentsIn(collection.workspace_id)) {
      if (doc.collection_id !== null && moved.has(doc.collection_id)) syncSettingGrant(doc);
    }
    return response(200).json(collectionDetail(collection), collectionHeaders(collection));
  }),

  // A new place among the collection's current siblings, in a parent ordered by hand.
  http.post('/workspaces/{workspace_id}/collections/{collection_id}/reorder', async ({ params, request, response }) => {
    const collection = collectionOr(params.workspace_id, params.collection_id);
    if (isProblem(collection)) return collection;
    const stale = collectionPrecondition(request, collection);
    if (stale) return stale;
    if (sortModeOf(collection.workspace_id, collection.parent_id) !== 'custom') {
      return problem('not_custom_order', 'The parent is not in custom order');
    }
    const { position } = await request.json();
    const siblings = collectionChildren(collection.workspace_id, collection.parent_id)
      .filter((row) => row.id !== collection.id)
      .sort(byKey((row) => row.id));
    const sortKey = keyAt(siblings, position as Position, (row) => row.id);
    if (sortKey === null) return problem('invalid_position', 'The position names no collection there');
    collection.sort_key = sortKey;
    collection.row_version += 1;
    bumpTree(collection.workspace_id);
    return response(200).json(collectionDetail(collection), collectionHeaders(collection));
  }),

  // What a trash would take with it; the trash sends these counts back.
  http.get('/workspaces/{workspace_id}/collections/{collection_id}/trash-preview', ({ params, response }) => {
    const collection = collectionOr(params.workspace_id, params.collection_id);
    return isProblem(collection) ? collection : response(200).json(collectionTrashPreview(collection));
  }),

  // To the Trash with everything it holds, if it still holds what the author
  // was shown. The pages go through its job: 202 while there are pages to move.
  http.post('/workspaces/{workspace_id}/collections/{collection_id}/trash', async ({ params, request, response }) => {
    const collection = collectionOr(params.workspace_id, params.collection_id);
    if (isProblem(collection)) return collection;
    if (!roleAllows(collection.workspace_id, 'editor')) return roleRequired('editor');
    const stale = collectionPrecondition(request, collection);
    if (stale) return stale;
    const expected = await request.json();
    const preview = collectionTrashPreview(collection);
    if (
      expected.expected_collection_count !== preview.collection_count
      || expected.expected_page_count !== preview.page_count
      || expected.expected_pdf_count !== preview.pdf_count
      || expected.expected_pdf_bytes !== preview.pdf_bytes
    ) {
      return problem('preview_changed', 'The collection changed since the preview; review it again');
    }
    const counts = trashCollectionTree(collection);
    const job = counts.page_count > 0 ? startJob(collection.workspace_id, 'collection_trash', counts.page_count) : null;
    return response(job ? 202 : 200).json({
      collection_id: collection.id,
      trashed_at: collection.trashed_at as string,
      purge_after: purgeAfterOf(collection.trashed_at) as string,
      ...counts,
      tree_version: treeVersionOf(collection.workspace_id),
      job: job && jobState(job),
    });
  }),

  // Back with what it held; its pages come back through its job (202).
  http.post('/workspaces/{workspace_id}/collections/{collection_id}/restore', ({ params, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const collection = fixtures.collections.get(Number(params.collection_id));
    if (!collection || collection.workspace_id !== workspace) return collectionNotFound();
    if (!collection.trashed_at) return problem('not_in_trash', 'The collection is not in the Trash');
    // One that went with a collection above it comes back only with that one.
    if (collection.trash_root_id !== collection.id) return collectionNotFound();
    if (!mayRestore(workspace, collection.trashed_by)) return roleRequired('admin');
    const { movedToRoot, pageCount } = restoreCollectionTree(collection);
    const job = pageCount > 0 ? startJob(workspace, 'collection_restore', pageCount) : null;
    return response(job ? 202 : 200).json({
      collection: collectionDetail(collection),
      moved_to_root: movedToRoot,
      tree_version: treeVersionOf(workspace),
      job: job && jobState(job),
    });
  }),

  // The collections a page uses, each with its path.
  http.get('/workspaces/{workspace_id}/documents/{document_id}/pdf-grants', ({ params, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const items = liveCollections(doc.workspace_id)
      .filter((collection) => collection.grants.has(doc._id))
      .map((collection) => ({
        collection_id: collection.id,
        name: collection.name,
        origin: collection.grants.get(doc._id) ?? 'manual',
        path: collectionPath(collection.id).map((item) => ({ id: item.id, name: item.name })),
      }));
    return response(200).json({ items });
  }),

  http.put('/workspaces/{workspace_id}/documents/{document_id}/pdf-grants/{collection_id}', ({ params, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const collection = workspaceCollection(doc.workspace_id, Number(params.collection_id));
    if (!collection) return collectionNotFound();
    // Granting by hand makes the grant the author's, kept wherever the page moves.
    collection.grants.set(doc._id, 'manual');
    return response(200).json({ collection_id: collection.id, ...grantStateOf(collection, doc._id) });
  }),

  // Idempotent: a page that does not use the collection keeps not using it.
  http.delete('/workspaces/{workspace_id}/documents/{document_id}/pdf-grants/{collection_id}', ({ params, response }) => {
    const doc = pageOr(params.workspace_id, params.document_id);
    if (isProblem(doc)) return doc;
    const collection = workspaceCollection(doc.workspace_id, Number(params.collection_id));
    if (!collection) return collectionNotFound();
    collection.grants.delete(doc._id);
    return response(200).json({ collection_id: collection.id, ...grantStateOf(collection, doc._id) });
  }),
];

/* ----------------------------------------
   The Trash and workspace jobs
   ---------------------------------------- */

const trashHandlers = [
  // The workspace's trash roots, newest first, a page at a time.
  http.get('/workspaces/{workspace_id}/trash', ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const limit = bounded(query.get('limit'), 'limit', 50, 1, 100);
    if (typeof limit !== 'number') return limit;
    const page = pageOf(trashRoots(workspace), limit, query.get('cursor'), `trash:${workspace}`);
    if (!page) return problem('invalid_cursor', 'Invalid trash cursor');
    return response(200).json({ items: page.rows, next_cursor: page.next });
  }),

  // Everything in the Trash, deleted forever as a job; an admin's.
  http.delete('/workspaces/{workspace_id}/trash', ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    if (!roleAllows(workspace, 'admin')) return roleRequired('admin');
    if (query.get('confirm') !== 'empty') return invalidRequest(['query', 'confirm'], "Input should be 'empty'");
    const roots = trashRoots(workspace);
    for (const root of roots) purgeRoot(root);
    return response(202).json({ job: jobState(startJob(workspace, 'trash_empty', roots.length)) });
  }),

  // One trash root, deleted forever as a job; an admin's. A collection sends the counts the Trash showed.
  http.delete('/workspaces/{workspace_id}/trash/{kind}/{item_id}', ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    if (!roleAllows(workspace, 'admin')) return roleRequired('admin');
    const kind = params.kind;
    if (kind !== 'collection' && kind !== 'document' && kind !== 'resource') {
      return invalidRequest(['path', 'kind'], "Input should be 'collection', 'document' or 'resource'");
    }
    const root = trashRoots(workspace).find((item) => item.kind === kind && item.id === params.item_id);
    if (!root) {
      return kind === 'document' ? documentNotFound() : kind === 'collection' ? collectionNotFound() : resourceNotFound();
    }
    if (kind === 'collection') {
      const expected = ['collection_count', 'page_count', 'pdf_count', 'pdf_bytes'] as const;
      const sent = expected.map((field) => query.get(`expected_${field}`));
      if (sent.some((value) => value === null || value === '')) {
        return problem('precondition_required', 'Send the expected_* counts the Trash shows for this collection');
      }
      const counts = trashRootCounts(Number(root.id));
      if (expected.some((field, index) => Number(sent[index]) !== counts[field])) {
        return problem('preview_changed', 'The collection holds something else now; review it again');
      }
    }
    purgeRoot(root);
    const jobKind = kind === 'collection' ? 'collection_purge' : kind === 'document' ? 'document_purge' : 'resource_purge';
    return response(202).json({ job: jobState(startJob(workspace, jobKind, 1)) });
  }),

  // A job's status and progress; another workspace's is not found.
  http.get('/workspaces/{workspace_id}/jobs/{job_id}', ({ params, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const job = fixtures.jobs.get(Number(params.job_id));
    if (!job || job.workspace_id !== workspace) return problem('job_not_found', 'Job not found');
    return response(200).json(jobState(job));
  }),
];

function imageAllowed(workspaceId: string) {
  if (!workspacePolicyOf(workspaceId).images) return problem('workspace_policy', 'Images are switched off in this workspace.', { policy: 'images' });
  if (!fixtures.imageGenerationEnabled || !fixtures.assistant.switches.images) return problem('image_generation_unavailable', 'Image generation is not configured or is switched off.');
  return null;
}

function imageGenerationOr(workspaceId: string, generationId: string) {
  const info = fixtures.imageGenerations.get(generationId);
  if (!info || info.workspace_id !== workspaceId) return problem('image_generation_not_found', 'Image request not found.');
  if (info.created_by !== PREVIEW_USER_ID && (!info.asset_id || !readableAsset(workspaceId, info.asset_id))) {
    return problem('image_generation_not_found', 'Image request not found.');
  }
  return info;
}

function publicGeneration(info: ImageGenerationInfo): ImageGenerationInfo {
  return { ...info, can_decide: info.created_by === PREVIEW_USER_ID && roleAllows(info.workspace_id, 'editor') };
}

const imageGenerationHandlers = [
  http.post('/workspaces/{workspace_id}/image-generations', async ({ params, request, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const blocked = imageAllowed(workspace);
    if (blocked) return blocked;
    const body = await request.json();
    const page = pageOr(workspace, body.document_id);
    if (isProblem(page)) return page;
    if (body.engine === 'claude') return problem('image_generation_unavailable', "Images aren't available with Claude Code.");
    const key = request.headers.get('Idempotency-Key')?.trim();
    if (!key) return problem('invalid_idempotency_key', 'An action key is required.');
    if (Object.keys(body).some((name) => !['document_id', 'engine', 'purpose', 'description', 'style', 'exact_text', 'aspect_ratio'].includes(name))
      || !body.description?.trim() || body.description.length > 2000) return invalidRequest(['body'], 'Describe one illustration.');
    const action = `${workspace}:${key}`;
    const hash = JSON.stringify(body);
    const replay = fixtures.imageGenerationActions.get(action);
    if (replay) {
      if (replay.hash !== hash) return problem('idempotency_key_reused', 'This key named a different request.');
      const info = imageGenerationOr(workspace, replay.generationId);
      return isProblem(info) ? info : response(201).json(publicGeneration(info));
    }
    const quota = generationQuota(workspace);
    if (!quota.available) return problem('image_quota_exceeded', quota.reason!, { scope: quota.scope, resets_at: quota.resets_at });
    const info = proposeGeneration(workspace, body.document_id, {
      purpose: body.purpose, description: body.description, style: body.style ?? '',
      exact_text: body.exact_text ?? '', aspect_ratio: body.aspect_ratio ?? '3:2',
    }, body.engine ?? 'gateway');
    fixtures.imageGenerationActions.set(action, { hash, generationId: info.generation_id });
    return response(201).json(publicGeneration(info));
  }),
  http.get('/workspaces/{workspace_id}/image-generations', async ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const page = pageOr(workspace, query.get('document_id') ?? '');
    if (isProblem(page)) return page;
    const limit = Math.min(100, Math.max(1, Number(query.get('limit') ?? 50)));
    const cursor = query.get('cursor');
    const rows = [...fixtures.imageGenerations.values()].filter((info) => info.workspace_id === workspace
      && info.document_id === page._id && (!cursor || info.generation_id > cursor)).sort((a, b) => a.generation_id.localeCompare(b.generation_id));
    const items = [];
    for (const row of rows.slice(0, limit)) {
      const authorized = imageGenerationOr(workspace, row.generation_id);
      if (!isProblem(authorized)) items.push(publicGeneration(await generationState(authorized)));
    }
    return response(200).json({ items, next_cursor: rows.length > limit ? rows[limit - 1]!.generation_id : null });
  }),
  http.get('/workspaces/{workspace_id}/image-generations/availability', ({ params, query, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const reason = !roleAllows(workspace, 'editor') ? 'Viewers cannot generate images.'
      : !workspacePolicyOf(workspace).images ? 'Images are switched off in this workspace.'
      : !fixtures.imageGenerationEnabled ? 'Image generation is not configured on this server.'
      : !fixtures.assistant.switches.images ? 'Images are switched off in your settings.'
      : query.get('engine') === 'claude' ? "Images aren't available with Claude Code." : null;
    return response(200).json(reason ? { available: false, reason, scope: null, resets_at: null } : generationQuota(workspace));
  }),
  http.get('/workspaces/{workspace_id}/image-generations/{generation_id}', async ({ params, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const info = imageGenerationOr(workspace, params.generation_id);
    return isProblem(info) ? info : response(200).json(publicGeneration(await generationState(info)));
  }),
  http.patch('/workspaces/{workspace_id}/image-generations/{generation_id}', async ({ params, request, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const blocked = imageAllowed(workspace);
    if (blocked) return blocked;
    const info = imageGenerationOr(workspace, params.generation_id);
    if (isProblem(info)) return info;
    const body = await request.json();
    if (info.status !== 'proposed' || info.created_by !== PREVIEW_USER_ID) return problem('generation_not_pending', 'This request was already decided.');
    if (body.confirmation_token !== info.confirmation_token) return problem('generation_request_changed', 'Read the latest request before changing it.');
    if (!body.prompt.trim() || body.prompt.length > 4000 || Object.keys(body).some((key) => !['prompt', 'aspect_ratio', 'confirmation_token'].includes(key))) return invalidRequest(['body'], 'Invalid image request edit.');
    Object.assign(info, { prompt: body.prompt, aspect_ratio: body.aspect_ratio });
    Object.assign(info, generationQuote(info));
    return response(200).json(publicGeneration(info));
  }),
  http.post('/workspaces/{workspace_id}/image-generations/{generation_id}/confirm', async ({ params, request, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const blocked = imageAllowed(workspace);
    if (blocked) return blocked;
    const info = imageGenerationOr(workspace, params.generation_id);
    if (isProblem(info)) return info;
    const body = await request.json();
    const key = request.headers.get('Idempotency-Key')?.trim();
    if (!key) return problem('invalid_idempotency_key', 'A confirmation action key is required.');
    if (Object.keys(body).some((name) => name !== 'confirmation_token')) return invalidRequest(['body'], 'Confirm the exact displayed request only.');
    const receipt = fixtures.imageConfirmations.get(info.generation_id);
    if (receipt?.key === key) {
      if (receipt.token !== body.confirmation_token) return problem('idempotency_key_reused', 'This confirmation named a different request.');
      const job = fixtures.jobs.get(info.job_id!);
      return job ? response(202).json({ job: jobState(job) }) : problem('job_not_found', 'Generation job not found.');
    }
    if (info.status !== 'proposed' || info.created_by !== PREVIEW_USER_ID) return problem('generation_not_pending', 'This request was already decided.');
    if (body.confirmation_token !== info.confirmation_token) return problem('generation_request_changed', 'Read the exact request again before generating.');
    const now = new Date().toISOString();
    const confirmed = [...fixtures.imageGenerations.values()].filter((row) => row.confirmed_at !== null);
    if (confirmed.filter((row) => row.created_by === PREVIEW_USER_ID && row.confirmed_at!.slice(0, 10) === now.slice(0, 10)).length >= 20) return problem('image_quota_exceeded', 'Daily confirmation quota reached.', { scope: 'person', resets_at: null });
    if (confirmed.filter((row) => row.workspace_id === workspace && row.confirmed_at!.slice(0, 7) === now.slice(0, 7)).length >= 200) return problem('image_quota_exceeded', 'Monthly workspace confirmation quota reached.', { scope: 'workspace', resets_at: null });
    const job = confirmGeneration(info);
    fixtures.imageConfirmations.set(info.generation_id, { key, token: body.confirmation_token });
    return response(202).json({ job: jobState(job) });
  }),
  http.post('/workspaces/{workspace_id}/image-generations/{generation_id}/discard', ({ params, response }) => {
    const workspace = workspaceOr(params.workspace_id);
    if (isProblem(workspace)) return workspace;
    const info = imageGenerationOr(workspace, params.generation_id);
    if (isProblem(info)) return info;
    if (info.created_by !== PREVIEW_USER_ID || !['proposed', 'confirmed', 'running', 'succeeded'].includes(info.status)) return problem('generation_not_pending', 'This request was already decided.');
    if (info.status === 'running') { info.status = 'unknown'; info.error_code = 'image_generation_unknown'; }
    else info.status = 'discarded';
    info.completed_at = new Date().toISOString();
    return response(200).json(publicGeneration(info));
  }),
];

/** Every route the mock answers, and the assistant socket. */
export const handlers = [
  // First: a write the account's role does not allow never reaches its route.
  roleGuard,
  ...workspaceHandlers,
  ...memberHandlers,
  ...pageHandlers,
  ...historyHandlers,
  ...chatHandlers,
  ...imageGenerationHandlers,
  ...accountHandlers,
  ...catalogHandlers,
  ...researchHandlers,
  ...referenceHandlers,
  ...resourceHandlers,
  ...collectionHandlers,
  ...trashHandlers,
  assistantSocket({ previewFixtures: true }),
];

/**
 * For the dev preview only: an API route the mock does not answer is a 404
 * problem and a console warning, so the page shows what a missing route does
 * instead of the request leaving for a server that is not there. The tests
 * fail on such a request instead (`onUnhandledRequest: 'error'`).
 */
export const unmockedApi = untypedHttp.all(`${API_BASE}/*`, ({ request }) => {
  const path = new URL(request.url).pathname;
  console.warn('[dev-preview] unmocked API call', request.method, path);
  return problem('not_found', `${request.method} ${path} is not mocked in the dev preview`);
});

/** Put the mock back as it started: its fixture state and the assistant's sessions and runs. */
export function resetMockApi(): void {
  resetAssistantSockets();
  resetFixtures();
}
