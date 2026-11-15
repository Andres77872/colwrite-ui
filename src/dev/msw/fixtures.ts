/**
 * The mock API's state, shared by the dev preview (`dev-preview.html`) and the
 * tests: two workspaces (the personal one and a second), their pages with
 * version trees, the stored change sets, chats, PDFs, the Library's
 * collections, the agent tool catalog and the engines.
 *
 * Everything here answers in the contract's shapes (`src/api/schema.d.ts`);
 * where the contract is looser than ColWrite-api, the rules follow the API
 * (`docs/document-history-api.md`, `src/routes/*.py`). `resetFixtures()` puts
 * it all back as it was; the tests do that after every case.
 */
import { uid } from '@/lib/uid';
import type {
  AgentToolSettingsResponse,
  ChangeSetOperationDecisionResponse,
  ChangeSetResponse,
  ChatImageItem,
  ChatMessage,
  ChatSummary,
  CitationSource,
  ClaimAssessment,
  ClaimEvidenceFinding,
  CollectionDetail,
  CollectionGrantState,
  CollectionSummary,
  DeletedWorkspaceSummary,
  DocumentContentOutput,
  DocumentStateResponse,
  DocumentSummaryResponse,
  EngineStatusResponse,
  Invitation,
  JobResult,
  MessageImage,
  MessagePdf,
  OwnershipTransferModel,
  PaperGraphResponse,
  PaperPayload,
  ResourceItem,
  RevisionMetadataResponse,
  SemanticDiffEntry,
  TrashCounts,
  TrashItem,
  UserMeResponse,
  UserProfileModel,
  WorkspaceDetailResponse,
  WorkspaceJob,
  WorkspaceMember,
  WorkspacePolicyModel,
  WorkspaceSummary,
  WorkspaceUsageResponse,
  WorkspaceUsageShare,
  AccountUsageResponse,
} from '@/api/schema';
import agentTools from '../agentToolsFixture.json';
import { FIXTURE_DOCUMENT_ID, fixtureDocument } from '../fixtureDocument';

export { FIXTURE_DOCUMENT_ID };

export type WireBlock = NonNullable<DocumentContentOutput['blocks']>[number];
type Json = Record<string, unknown>;

/* ----------------------------------------
   Workspaces
   ---------------------------------------- */

/** The preview account's personal workspace: every seeded page but one is here. */
export const PERSONAL_WORKSPACE_ID = 'wsp-6f1c0f5e-8a8b-4c4d-9e2f-1a2b3c4d5e6f';
/** A second workspace the account is a member of (an editor), with a page of its own. */
export const LAB_WORKSPACE_ID = 'wsp-2b7e9d10-4c3a-4f1e-8b2d-9a0c1e2f3a4b';
/** The page in the second workspace, for following a `?doc=` link into it. */
export const LAB_DOCUMENT_ID = '66f0c0ffee0000000000d1a1';
/** A shared workspace the account owns, with nothing in it yet: the empty state, the policy, export and delete. */
export const OWNED_WORKSPACE_ID = 'wsp-9c4d2e7a-1b3f-4a6c-8d0e-5f7a9b1c3d5e';
/** A shared workspace the account owns and deleted, restorable for its 30 days. */
export const DELETED_WORKSPACE_ID = 'wsp-4e8a1c3b-7d2f-4b9e-a6c0-2d4f6a8b0c1e';
/** A shared workspace the account is a viewer in (M6): the read-only editor, review read-only, no Auto. */
export const VIEWER_WORKSPACE_ID = 'wsp-7a3c9e1d-5b2f-4d8a-9c6e-0f1a2b3c4d5f';
/** The viewer workspace's page, with a change set waiting for an editor. */
export const VIEWER_DOCUMENT_ID = '66f0c0ffee0000000000f1a1';
/** A shared workspace the account is not in yet; the seeded invitation joins it. */
export const INVITED_WORKSPACE_ID = 'wsp-3d5f7b9c-1e2a-4c6b-8d0f-a1b2c3d4e5f6';

export type SortMode = CollectionSummary['sort_mode'];
export type WorkspacePolicy = WorkspacePolicyModel;

/** Every switch on: what a workspace with no stored policy restricts (nothing). */
export const OPEN_POLICY: WorkspacePolicy = { web_search: true, outside_research: true, auto: true };

/** The newest export of a workspace, downloadable until it expires. */
export type StoredExport = {
  filename: string;
  include_pdfs: boolean;
  page_count: number;
  pdf_count: number;
  byte_size: number;
  expires_at: string;
};

/**
 * A workspace as the mock keeps it: its row, the order of its top level, the
 * counter in its ETag (`"cww:{row_version}"`), its `tree_version`, which
 * every structural change advances, its policy, its newest export, and when
 * it was deleted (a deleted one answers nothing until it is restored). Who
 * is in it, and with which role, is `fixtures.members`; the account's own
 * role is its row there (`roleOf`).
 */
export type StoredWorkspace = Omit<WorkspaceSummary, 'role' | 'member_count'> & {
  created_at: string;
  updated_at: string;
  root_sort_mode: SortMode;
  row_version: number;
  tree_version: number;
  policy: WorkspacePolicy;
  deleted_at: string | null;
  purge_after: string | null;
  export: StoredExport | null;
};

export type WorkspaceRole = WorkspaceSummary['role'];
export type StoredMember = WorkspaceMember;

const DAY_MS = 24 * 3600 * 1000;

function seededWorkspaces(): Map<string, StoredWorkspace> {
  const live = { policy: OPEN_POLICY, deleted_at: null, purge_after: null, export: null };
  const deletedAt = Date.now() - 5 * DAY_MS;
  const workspaces: StoredWorkspace[] = [
    {
      id: PERSONAL_WORKSPACE_ID, name: 'Personal', kind: 'personal', icon: null,
      last_opened_at: NOW, created_at: '2026-01-10T10:00:00Z', updated_at: NOW,
      // Pages at the top level by their last edit, collections by name.
      root_sort_mode: 'updated', row_version: 1, tree_version: 1, ...live,
    },
    {
      id: LAB_WORKSPACE_ID, name: 'Lab workspace', kind: 'shared', icon: '🧪',
      last_opened_at: '2026-09-12T08:00:00Z', created_at: '2026-03-02T10:00:00Z', updated_at: '2026-09-12T08:00:00Z',
      root_sort_mode: 'name', row_version: 1, tree_version: 1, ...live,
    },
    {
      id: OWNED_WORKSPACE_ID, name: 'Side project', kind: 'shared', icon: 'tint:green',
      last_opened_at: '2026-08-30T08:00:00Z', created_at: '2026-08-30T08:00:00Z', updated_at: '2026-08-30T08:00:00Z',
      root_sort_mode: 'name', row_version: 1, tree_version: 1, ...live,
    },
    {
      id: VIEWER_WORKSPACE_ID, name: 'Reading group', kind: 'shared', icon: '📚',
      last_opened_at: '2026-08-20T08:00:00Z', created_at: '2026-07-01T08:00:00Z', updated_at: '2026-08-20T08:00:00Z',
      root_sort_mode: 'name', row_version: 1, tree_version: 1, ...live,
    },
    {
      id: DELETED_WORKSPACE_ID, name: 'Old project', kind: 'shared', icon: null,
      last_opened_at: '2026-06-01T08:00:00Z', created_at: '2026-05-01T08:00:00Z', updated_at: '2026-06-01T08:00:00Z',
      root_sort_mode: 'name', row_version: 1, tree_version: 1, ...live,
      deleted_at: new Date(deletedAt).toISOString(), purge_after: new Date(deletedAt + 30 * DAY_MS).toISOString(),
    },
    {
      id: INVITED_WORKSPACE_ID, name: 'Thesis committee', kind: 'shared', icon: '🎓',
      last_opened_at: null, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z',
      root_sort_mode: 'name', row_version: 1, tree_version: 1, ...live,
    },
  ];
  return new Map(workspaces.map((workspace) => [workspace.id, workspace]));
}

/* ----------------------------------------
   Members, invitations and ownership (M6)
   ---------------------------------------- */

/** The other people of the seeded workspaces, as the auth service names them. */
export const PEOPLE = {
  grace: { user_id: 'u-grace', username: 'grace', display_name: 'Grace Hopper', avatar_url: null },
  alan: { user_id: 'u-alan', username: 'alan', display_name: 'Alan Turing', avatar_url: null },
  katherine: { user_id: 'u-katherine', username: 'katherine', display_name: 'Katherine Johnson', avatar_url: null },
  marie: { user_id: 'u-marie', username: 'marie', display_name: 'Marie Curie', avatar_url: null },
} as const;

const ADA = { user_id: 'u-preview', username: 'Ada Author', display_name: 'Ada Author', avatar_url: null };

/** The signed-in account as a member row names it. */
export const ownIdentity = () => ({ ...ADA });

/** The addresses the preview account has verified at the auth service; an invitation must name one. */
export const VERIFIED_EMAILS = ['ada@example.org'];

function member(person: Pick<StoredMember, 'user_id' | 'username' | 'display_name' | 'avatar_url'>, role: WorkspaceRole, joinedAt: string, addedBy: string | null = null): StoredMember {
  return { ...person, role, added_by: addedBy, joined_at: joinedAt };
}

/**
 * Who is in each workspace. The account is an owner of its personal
 * workspace, Side project and Old project, an editor in Lab workspace beside
 * an owner, an admin and a viewer, and a viewer in Reading group. It is not
 * in Thesis committee, which its seeded invitation joins.
 */
function seededMembers(): Map<string, StoredMember[]> {
  return new Map([
    [PERSONAL_WORKSPACE_ID, [member(ADA, 'owner', '2026-01-10T10:00:00Z')]],
    [LAB_WORKSPACE_ID, [
      member(PEOPLE.grace, 'owner', '2026-03-02T10:00:00Z'),
      member(PEOPLE.alan, 'admin', '2026-03-03T10:00:00Z', PEOPLE.grace.user_id),
      member(ADA, 'editor', '2026-03-05T10:00:00Z', PEOPLE.grace.user_id),
      member(PEOPLE.katherine, 'viewer', '2026-04-01T10:00:00Z', PEOPLE.alan.user_id),
    ]],
    [OWNED_WORKSPACE_ID, [
      member(ADA, 'owner', '2026-08-30T08:00:00Z'),
      member(PEOPLE.marie, 'editor', '2026-09-02T08:00:00Z', ADA.user_id),
    ]],
    [VIEWER_WORKSPACE_ID, [
      member(PEOPLE.grace, 'owner', '2026-07-01T08:00:00Z'),
      member(PEOPLE.marie, 'editor', '2026-07-02T08:00:00Z', PEOPLE.grace.user_id),
      member(ADA, 'viewer', '2026-07-10T08:00:00Z', PEOPLE.grace.user_id),
    ]],
    [DELETED_WORKSPACE_ID, [member(ADA, 'owner', '2026-05-01T08:00:00Z')]],
    [INVITED_WORKSPACE_ID, [member(PEOPLE.alan, 'owner', '2026-09-01T08:00:00Z')]],
  ]);
}

const ROLE_ORDER: readonly WorkspaceRole[] = ['owner', 'admin', 'editor', 'viewer'];

/** The workspace's active members: owners first, then admins, editors and viewers, each by name. */
export function membersOf(workspaceId: string): StoredMember[] {
  return [...(fixtures.members.get(workspaceId) ?? [])].sort((a, b) =>
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
    || (a.display_name ?? a.username).localeCompare(b.display_name ?? b.username));
}

/** The account's own membership row, or none: it is not in the workspace. */
export function ownMembership(workspaceId: string): StoredMember | undefined {
  return fixtures.members.get(workspaceId)?.find((row) => row.user_id === PREVIEW_USER_ID);
}

/** The account's role in a workspace it is in. */
export function roleOf(workspaceId: string): WorkspaceRole | undefined {
  return ownMembership(workspaceId)?.role;
}

/**
 * Give the account another role in a workspace, as an admin would from
 * another tab (the preview's `setRoleElsewhere`); `null` removes it from the
 * workspace. Its next read of the workspace says so.
 */
export function setRoleElsewhere(workspaceId: string, role: WorkspaceRole | null): boolean {
  const rows = fixtures.members.get(workspaceId);
  const own = ownMembership(workspaceId);
  const workspace = fixtures.workspaces.get(workspaceId);
  if (!rows || !own || !workspace || workspace.kind === 'personal') return false;
  if (role === null) {
    fixtures.members.set(workspaceId, rows.filter((row) => row !== own));
    if (fixtures.transfers.get(workspaceId)?.to_user_id === PREVIEW_USER_ID) fixtures.transfers.delete(workspaceId);
  } else {
    own.role = role;
  }
  return true;
}

/** An invitation as the mock keeps it: the address and the token too, which the API never stores. */
export type StoredInvitation = Invitation & {
  workspace_id: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'revoked';
};

/** The seeded invitation links, for the preview (`?invite=`) and the tests. */
export const INVITE_TOKENS = {
  /** Joins Thesis committee as an editor. */
  join: 'cwinv-preview-join',
  /** For another address than the account's. */
  mismatch: 'cwinv-preview-mismatch',
  /** Lapsed two days ago. */
  expired: 'cwinv-preview-expired',
} as const;

/** "a***@example.org", as the API masks an invited address. */
export function emailHint(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

function seededInvitations(): Map<string, StoredInvitation> {
  const invitation = (fields: Omit<StoredInvitation, 'email_hint' | 'created_at' | 'status'> & Partial<Pick<StoredInvitation, 'status' | 'created_at'>>): StoredInvitation => ({
    email_hint: emailHint(fields.email), created_at: '2026-09-18T09:00:00Z', status: 'pending', ...fields,
  });
  const soon = new Date(Date.now() + 6 * DAY_MS).toISOString();
  return new Map([
    invitation({ id: 'inv-join', workspace_id: INVITED_WORKSPACE_ID, email: 'ada@example.org', role: 'editor', invited_by: PEOPLE.alan.user_id, expire_time: soon, token: INVITE_TOKENS.join }),
    invitation({ id: 'inv-mismatch', workspace_id: INVITED_WORKSPACE_ID, email: 'ada.lovelace@university.example', role: 'viewer', invited_by: PEOPLE.alan.user_id, expire_time: soon, token: INVITE_TOKENS.mismatch }),
    invitation({ id: 'inv-expired', workspace_id: INVITED_WORKSPACE_ID, email: 'ada@example.org', role: 'viewer', invited_by: PEOPLE.alan.user_id, expire_time: new Date(Date.now() - 2 * DAY_MS).toISOString(), token: INVITE_TOKENS.expired, created_at: '2026-09-01T09:00:00Z' }),
    // A pending invitation in the workspace the account owns, for the admins' list.
    invitation({ id: 'inv-side', workspace_id: OWNED_WORKSPACE_ID, email: 'sam@example.org', role: 'viewer', invited_by: ADA.user_id, expire_time: soon, token: 'cwinv-preview-side' }),
  ].map((row) => [row.id, row]));
}

/** The workspace's pending invitations, newest first, as its admins see them. */
export function pendingInvitations(workspaceId: string): Invitation[] {
  const now = Date.now();
  return [...fixtures.invitations.values()]
    .filter((row) => row.workspace_id === workspaceId && row.status === 'pending' && Date.parse(row.expire_time) > now)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .map(({ id, role, email_hint, invited_by, expire_time, created_at }) => ({ id, role, email_hint, invited_by, expire_time, created_at }));
}

/** A pending transfer of a workspace's ownership. */
export type StoredTransfer = OwnershipTransferModel;

/** Lab workspace's owner asked the account to become its owner. */
function seededTransfers(): Map<string, StoredTransfer> {
  return new Map([[LAB_WORKSPACE_ID, {
    from_user_id: PEOPLE.grace.user_id,
    to_user_id: PREVIEW_USER_ID,
    expire_time: new Date(Date.now() + 5 * DAY_MS).toISOString(),
  }]]);
}

/** The workspace's pending transfer, unless it lapsed. */
export function transferOf(workspaceId: string): StoredTransfer | null {
  const transfer = fixtures.transfers.get(workspaceId);
  return transfer && Date.parse(transfer.expire_time) > Date.now() ? transfer : null;
}

/** A workspace the account can open: a member of it, and not deleted. */
export function liveWorkspace(workspaceId: string): StoredWorkspace | undefined {
  const workspace = fixtures.workspaces.get(workspaceId);
  return workspace && !workspace.deleted_at && ownMembership(workspaceId) ? workspace : undefined;
}

/**
 * Delete a workspace as its owner would from another tab (the preview's
 * `deleteWorkspaceElsewhere`): every route under it is 404 from now on, so
 * the app's next read of it moves the app to the next workspace.
 */
export function deleteWorkspaceElsewhere(workspaceId: string): boolean {
  const workspace = liveWorkspace(workspaceId);
  if (!workspace || workspace.kind === 'personal') return false;
  const at = Date.now();
  workspace.deleted_at = new Date(at).toISOString();
  workspace.purge_after = new Date(at + 30 * DAY_MS).toISOString();
  workspace.row_version += 1;
  return true;
}

/** The workspace's policy; one the account cannot open restricts everything. */
export function workspacePolicyOf(workspaceId: string): WorkspacePolicy {
  return liveWorkspace(workspaceId)?.policy ?? { web_search: false, outside_research: false, auto: false };
}

/** A workspace in the list the switcher reads (`GET /workspaces` `items`). */
export function workspaceSummary(workspace: StoredWorkspace): WorkspaceSummary {
  const { id, name, kind, icon, last_opened_at } = workspace;
  return { id, name, kind, role: roleOf(id) ?? 'viewer', icon, last_opened_at, member_count: membersOf(id).length };
}

/** The deleted shared workspaces the account owns and can still restore, most recently deleted first. */
export function deletedWorkspaces(): DeletedWorkspaceSummary[] {
  const now = Date.now();
  return [...fixtures.workspaces.values()]
    .filter((workspace) => workspace.deleted_at && workspace.purge_after && workspace.kind === 'shared'
      && roleOf(workspace.id) === 'owner' && Date.parse(workspace.purge_after) > now)
    .sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? ''))
    .map((workspace) => ({
      id: workspace.id, name: workspace.name, icon: workspace.icon, kind: workspace.kind,
      deleted_at: workspace.deleted_at as string, purge_after: workspace.purge_after as string,
    }));
}

/** A page as the API stores it: its workspace, its content, its head counter, and when it was written. */
export type StoredDocument = {
  _id: string;
  workspace_id: string;
  /** The page's home: a collection, or `null` for the top level. */
  collection_id: number | null;
  /** Its place among its home's pages in custom order. */
  sort_key: string;
  /** The counter in its placement ETag (`"cwp:{placement_seq}"`), apart from the content ETag. */
  placement_seq: number;
  name: string;
  /** The head sequence, the counter in the page's ETag. */
  head_seq: number;
  tags: string[];
  blocks: WireBlock[];
  sources?: CitationSource[] | null;
  citationStyle?: DocumentContentOutput['citationStyle'];
  created_at: string;
  updated_at: string;
  /**
   * When the page went to the Trash. It keeps its row, its home and its
   * history there, and is in no list; a read or a write of it is 409
   * `document_in_trash`.
   */
  deleted_at: string | null;
  /** What took it to the Trash: the page itself, or the collection it went with. */
  trash_root?: PageTrashRoot | null;
  /** Who moved it there. */
  trashed_by?: string | null;
};

/** The item whose move to the Trash took a page there. */
export type PageTrashRoot = { kind: 'document' | 'collection'; id: string };

const NOW = '2026-09-20T14:32:00Z';
const SERIALIZER = 'canonical-json-v1';

type WireChild = NonNullable<Extract<WireBlock, { type: 'paragraph' }>['children']>[number];

/** A child with the fields its model defaults filled in, as the API serializes it. */
function wireChild(value: Json): WireChild {
  switch (value.type) {
    case 'citation': return { style: 'numeric', ...value } as WireChild;
    case 'equation': return { display: false, numbered: false, ...value } as WireChild;
    case 'table': return { header: false, ...value } as WireChild;
    case 'aiBeat': return { collapsed: false, message: '', prompt: '', ...value } as WireChild;
    default: return value as WireChild;
  }
}

/**
 * A block with the fields its model defaults filled in, as the API
 * serializes every page (`DocumentContent`): the view-state flags, the
 * paragraph's columns, an empty html or text.
 */
export function wireBlock(value: Json): WireBlock {
  const view = { aiHidden: false, collapsed: false, locked: false };
  switch (value.type) {
    case 'paragraph': {
      const children = Array.isArray(value.children) ? (value.children as Json[]).map(wireChild) : [];
      return { ...view, columns: 1, html: '', ...value, children } as WireBlock;
    }
    case 'heading': return { ...view, html: '', level: 2, ...value } as WireBlock;
    case 'code': return { ...view, text: '', ...value } as WireBlock;
    default: return { ...view, ...value } as WireBlock;
  }
}

/* ----------------------------------------
   Pages
   ---------------------------------------- */

function simpleDocument(
  _id: string,
  name: string,
  headSeq: number,
  text: string,
  updatedAt: string,
  workspaceId = PERSONAL_WORKSPACE_ID,
  collectionId: number | null = null,
): StoredDocument {
  return {
    _id,
    workspace_id: workspaceId,
    collection_id: collectionId,
    sort_key: '',
    placement_seq: 1,
    name,
    head_seq: headSeq,
    tags: [],
    blocks: [
      wireBlock({ id: `${_id}-h`, type: 'heading', level: 1, html: 'Notes' }),
      wireBlock({ id: `${_id}-p`, type: 'paragraph', html: text, children: [] }),
    ],
    created_at: '2026-09-01T10:00:00Z',
    updated_at: updatedAt,
    deleted_at: null,
  };
}

/**
 * A document whose stored change set was left half-reviewed, so per-operation
 * review can be seen without a backend: open "Camera-ready edits (review in
 * progress)" from the documents menu.
 *
 * Of its five operations, one was accepted and one rejected before; the
 * server's record says so, and they are not offered again. Three are left,
 * and one of those rewrites a paragraph the author changed after the
 * assistant read it, which the target fingerprints show. Shapes follow
 * ColWrite-api `docs/document-history-api.md` (Per-operation review,
 * Operation targets).
 */
export const REVIEW_DOCUMENT_ID = '66f0c0ffee0000000000d0c5';
const REVIEW_CHANGE_SET_ID = '7d1f0c6e-5a0b-4d7e-9f43-2b6f1c0a9e11';

/** What the assistant read in the Results paragraph, before the author changed it. */
const RESULTS_AS_PROPOSED = 'Sparse routing matches the dense baseline at roughly half the compute.';

const reviewParagraph = (id: string, html: string): WireBlock => wireBlock({ id, type: 'paragraph', html, children: [] });

function reviewDocument(): StoredDocument {
  return {
    _id: REVIEW_DOCUMENT_ID,
    workspace_id: PERSONAL_WORKSPACE_ID,
    collection_id: null,
    sort_key: '',
    placement_seq: 1,
    name: 'Camera-ready edits (review in progress)',
    head_seq: 4,
    tags: [],
    blocks: [
      wireBlock({ id: 'cr-h', type: 'heading', level: 1, html: 'Camera-ready edits' }),
      reviewParagraph('cr-abstract', 'We study sparse routing at long context lengths and find that it scales well.'),
      reviewParagraph('cr-setup', 'All models are trained for 100k steps on sequences of up to 128k tokens.'),
      // The insert the author already accepted.
      reviewParagraph('cr-seeds', 'Each configuration is run with three seeds, and we report the mean.'),
      // Rewritten by the author after the assistant proposed its own version.
      reviewParagraph('cr-results', 'Sparse routing matches the dense baseline at 38% of the compute, measured on the 128k split.'),
      reviewParagraph('cr-limits', 'We did not evaluate sequences longer than 128k tokens.'),
      // The deletion the author already rejected.
      reviewParagraph('cr-thanks', 'We thank the anonymous reviewers for their comments.'),
    ],
    created_at: '2026-09-15T09:00:00Z',
    updated_at: '2026-09-20T13:12:00Z',
    deleted_at: null,
  };
}

function seededDocuments(): Map<string, StoredDocument> {
  const fixture = fixtureDocument();
  const documents: StoredDocument[] = [
    {
      _id: fixture._id,
      workspace_id: PERSONAL_WORKSPACE_ID,
      collection_id: null,
      sort_key: '',
      placement_seq: 1,
      name: fixture.name,
      head_seq: fixture.head_seq,
      citationStyle: 'numeric',
      sources: fixture.sources as CitationSource[],
      blocks: fixture.blocks.map((block) => wireBlock(block)),
      tags: [],
      created_at: '2026-09-18T17:40:00Z',
      updated_at: NOW,
      deleted_at: null,
    },
    simpleDocument('66f0c0ffee0000000000d0c2', 'Related work: conditional computation', 7, 'Mixture-of-experts, routing, and sparsity.', '2026-09-19T16:20:00Z'),
    simpleDocument('66f0c0ffee0000000000d0c3', 'Rebuttal notes — ICLR', 2, 'Reviewer 2 asks for a dense baseline at 128k.', '2026-09-12T08:05:00Z'),
    simpleDocument('66f0c0ffee0000000000d0c4', 'Scaling laws reading list', 11, 'Kaplan 2020, Hoffmann 2022, Clark 2022.', '2026-09-04T11:45:00Z'),
    reviewDocument(),
    simpleDocument(LAB_DOCUMENT_ID, 'Lab meeting notes', 3, 'Agenda: the routing ablation and the cluster budget.', '2026-09-11T15:00:00Z', LAB_WORKSPACE_ID),
    simpleDocument(VIEWER_DOCUMENT_ID, 'Week 4: attention variants', 5, 'Multi-head latent attention compresses the keys and values into one latent vector.', '2026-08-20T08:00:00Z', VIEWER_WORKSPACE_ID),
    ...treePages(),
    ...trashedPages(),
  ];
  return new Map(placeInOrder(documents).map((doc) => [doc._id, doc]));
}

/* ----------------------------------------
   The Trash fixture (M4)
   ---------------------------------------- */

/** The account the preview is signed in as, who moved the seeded items to the Trash. */
export const PREVIEW_USER_ID = 'u-preview';

/** How long the Trash keeps an item before it is purged. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** When an item that went to the Trash at `at` is deleted for good. */
export function purgeAfterOf(at: string | null | undefined): string | null {
  return at ? new Date(Date.parse(at) + RETENTION_MS).toISOString() : null;
}

/** A moment `days` ago, so the seeded Trash always has its 30 days ahead of it. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * What the seeded Trash holds: a collection with a sub-collection, two pages
 * and a PDF (Old drafts, three days ago), and a page from Thesis (yesterday).
 */
export const TRASHED = {
  collection: 11,
  subCollection: 12,
  collectionPages: ['66f0c0ffee0000000000e0a1', '66f0c0ffee0000000000e0a2'],
  collectionPdf: 71,
  page: '66f0c0ffee0000000000e0b1',
} as const;

function trashedPages(): StoredDocument[] {
  const collectionAt = daysAgo(3);
  const pageAt = daysAgo(1);
  const inCollection = (id: string, name: string, text: string, collectionId: number): StoredDocument => ({
    ...simpleDocument(id, name, 2, text, '2026-04-10T09:00:00Z', PERSONAL_WORKSPACE_ID, collectionId),
    deleted_at: collectionAt,
    trash_root: { kind: 'collection', id: String(TRASHED.collection) },
    trashed_by: PREVIEW_USER_ID,
  });
  return [
    inCollection(TRASHED.collectionPages[0], 'First draft of the introduction', 'Superseded by Chapter 1.', TRASHED.collection),
    inCollection(TRASHED.collectionPages[1], 'Ideas we dropped', 'Dense routing at 1M tokens.', TRASHED.subCollection),
    {
      ...simpleDocument(TRASHED.page, 'Discarded abstract', 2, 'An earlier abstract, before the results changed.', '2026-08-20T09:00:00Z', PERSONAL_WORKSPACE_ID, TREE.thesis),
      deleted_at: pageAt,
      trash_root: { kind: 'document', id: TRASHED.page },
      trashed_by: PREVIEW_USER_ID,
    },
    // Another member's trash, in the viewer workspace: the Trash names who moved it.
    {
      ...simpleDocument(VIEWER_TRASHED_PAGE_ID, 'Week 3 outline', 2, 'An outline we replaced with the week 4 notes.', '2026-08-10T09:00:00Z', VIEWER_WORKSPACE_ID),
      deleted_at: daysAgo(2),
      trash_root: { kind: 'document', id: VIEWER_TRASHED_PAGE_ID },
      trashed_by: PEOPLE.marie.user_id,
    },
  ];
}

/** The page another member of the viewer workspace moved to the Trash. */
export const VIEWER_TRASHED_PAGE_ID = '66f0c0ffee0000000000f1a2';

/* ----------------------------------------
   The collection fixture (M3)
   ---------------------------------------- */

/** Collection ids of the seeded tree, for the tests and the console helpers. */
export const TREE = {
  thesis: 1,
  readingNotes: 2,
  chapter1: 3,
  chapter2: 4,
  /** A chain five collections deep: Archive › 2025 › Spring term › Week 3 › Drafts. */
  archive: 5,
  drafts: 9,
  /** Sixty pages, to exercise "Show more". */
  lectures: 10,
} as const;

/** Page ids of the seeded tree. */
export const TREE_PAGES = {
  outline: '66f0c0ffee0000000000e001',
  chapter1Notes: '66f0c0ffee0000000000e002',
  methods: '66f0c0ffee0000000000e003',
  results: '66f0c0ffee0000000000e004',
  draftsNotes: '66f0c0ffee0000000000e005',
} as const;

const OLD = '2026-06-01T09:00:00Z';

/**
 * The pages that live in the seeded collections: Thesis › Outline, Chapter 1
 * › Notes, Chapter 2 › Methods and Results, a second "Notes" at the end of the
 * five-level chain, and sixty lectures. They were edited before the pages at
 * the top level, so the most recent pages are those.
 */
function treePages(): StoredDocument[] {
  const page = (id: string, name: string, text: string, collectionId: number, updatedAt = OLD) =>
    simpleDocument(id, name, 2, text, updatedAt, PERSONAL_WORKSPACE_ID, collectionId);
  const lectures = Array.from({ length: 60 }, (_, index) => {
    const number = index + 1;
    const minutes = String(index % 60).padStart(2, '0');
    return page(
      `66f0c0ffee0000000000f${String(number).padStart(3, '0')}`,
      `Lecture ${number}`,
      `Notes from lecture ${number}.`,
      TREE.lectures,
      `2026-03-${String(1 + (index % 28)).padStart(2, '0')}T10:${minutes}:00Z`,
    );
  });
  return [
    page(TREE_PAGES.outline, 'Outline', 'Chapters, their claims and what each one needs.', TREE.thesis, '2026-09-02T09:00:00Z'),
    page(TREE_PAGES.chapter1Notes, 'Notes', 'Open questions for the introduction.', TREE.chapter1),
    page(TREE_PAGES.methods, 'Methods', 'How the routing experiments were run.', TREE.chapter2, '2026-08-30T09:00:00Z'),
    page(TREE_PAGES.results, 'Results', 'What the routing experiments found.', TREE.chapter2, '2026-08-29T09:00:00Z'),
    page(TREE_PAGES.draftsNotes, 'Notes', 'Loose drafts, filed five levels deep.', TREE.drafts),
    ...lectures,
  ];
}

/** Sort keys in creation order for each home, as the API gives new pages: each after the last. */
function placeInOrder(documents: StoredDocument[]): StoredDocument[] {
  const last = new Map<string, string | null>();
  return documents.map((doc) => {
    const home = `${doc.workspace_id}:${doc.collection_id ?? 'root'}`;
    const key = keyBetween(last.get(home) ?? null, null);
    last.set(home, key);
    return { ...doc, sort_key: key };
  });
}

function seededCollections(): Map<number, StoredCollection> {
  const at = '2026-05-01T10:00:00Z';
  const collection = (
    id: number,
    name: string,
    parentId: number | null,
    extra: Partial<StoredCollection> = {},
  ): StoredCollection => ({
    id, workspace_id: PERSONAL_WORKSPACE_ID, name, description: null, parent_id: parentId,
    sort_key: '', sort_mode: 'name', grant_new_pages: false, row_version: 1, grants: new Map(),
    created_at: at, updated_at: at, trashed_at: null, trash_root_id: null, trashed_by: null, ...extra,
  });
  const trashed = { trashed_at: daysAgo(3), trash_root_id: TRASHED.collection, trashed_by: PREVIEW_USER_ID };
  const rows = [
    // Thesis is in custom order, so Move up and Move down have something to do.
    collection(TREE.thesis, 'Thesis', null, { sort_mode: 'custom' }),
    collection(TREE.readingNotes, 'Reading notes', null, { description: 'Papers to read; no pages yet.' }),
    collection(TREE.chapter1, 'Chapter 1', TREE.thesis),
    collection(TREE.chapter2, 'Chapter 2', TREE.thesis),
    collection(TREE.archive, 'Archive', null),
    collection(6, '2025', TREE.archive),
    collection(7, 'Spring term', 6),
    collection(8, 'Week 3', 7),
    collection(TREE.drafts, 'Drafts', 8),
    collection(TREE.lectures, 'Lecture notes', null, { sort_mode: 'custom' }),
    // In the Trash: Old drafts went there with what it held.
    collection(TRASHED.collection, 'Old drafts', null, trashed),
    collection(TRASHED.subCollection, 'Abandoned ideas', TRASHED.collection, trashed),
  ];
  const last = new Map<number | 'root', string | null>();
  for (const row of rows) {
    const home = row.parent_id ?? 'root';
    row.sort_key = keyBetween(last.get(home) ?? null, null);
    last.set(home, row.sort_key);
  }
  return new Map(rows.map((row) => [row.id, row]));
}

/* ----------------------------------------
   Sort keys
   ---------------------------------------- */

/** Base-62 digits in byte order, as the API's keys compare (`ascii_bin`). */
const KEY_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function midpoint(low: string, high: string | null): string {
  if (high !== null) {
    let shared = 0;
    while ((low[shared] ?? '0') === high[shared]) shared += 1;
    if (shared > 0) return high.slice(0, shared) + midpoint(low.slice(shared), high.slice(shared));
  }
  const lowDigit = low ? KEY_DIGITS.indexOf(low[0] as string) : 0;
  const highDigit = high !== null ? KEY_DIGITS.indexOf(high[0] as string) : KEY_DIGITS.length;
  if (highDigit - lowDigit > 1) return KEY_DIGITS[Math.round((lowDigit + highDigit) / 2)] as string;
  if (high !== null && high.length > 1) return high.slice(0, 1);
  return (KEY_DIGITS[lowDigit] as string) + midpoint(low.slice(1), null);
}

/**
 * A fractional key strictly between two neighbours (`null` for an open end),
 * the way the server chooses one (`ColWrite-api/src/collections/sort_keys.py`).
 */
export function keyBetween(before: string | null, after: string | null): string {
  return midpoint(before ?? '', after);
}

/** Byte order, then the id: two items placed into one gap at once can share a key. */
export function byKey<T extends { sort_key: string }>(id: (item: T) => string | number) {
  return (a: T, b: T) => (a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : compareIds(id(a), id(b)));
}

function compareIds(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Case- and accent-insensitive, ties by id, as `utf8mb4_0900_ai_ci` orders names. */
export function byName<T extends { name: string }>(id: (item: T) => string | number) {
  return (a: T, b: T) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || compareIds(id(a), id(b));
}

/** The page's content, as `DocumentContent` holds it. */
export function contentOf(doc: StoredDocument): DocumentContentOutput {
  return {
    schema_version: 1,
    name: doc.name,
    tags: doc.tags,
    blocks: doc.blocks,
    sources: doc.sources ?? null,
    citationStyle: doc.citationStyle ?? null,
  };
}

/** A page as a list shows it. */
export function summaryOf(doc: StoredDocument, activity = false): DocumentSummaryResponse {
  return {
    id: doc._id, name: doc.name, collection_id: doc.collection_id, sort_key: doc.sort_key, placement_etag: placementEtagOf(doc),
    tags: doc.tags, created_at: doc.created_at, updated_at: doc.updated_at,
    activity: activity ? { saves: 30, chats: chatsOf(doc._id).length, assistant_runs: 5, pdfs: pdfsOn(doc._id).length } : null,
  };
}

/** The strong `ETag` of the page's head (`cw:{serializer}:{schema}:{head_seq}:{content_hash}`). */
export function etagOf(doc: StoredDocument): string {
  return `"cw:${SERIALIZER}:1:${doc.head_seq}:preview"`;
}

/** Where the page lives has an ETag of its own; a move never touches the content one. */
export function placementEtagOf(doc: StoredDocument): string {
  return `"cwp:${doc.placement_seq}"`;
}

/** A live page, or `undefined` for one that does not exist or is in the Trash. */
export function liveDocument(id: string): StoredDocument | undefined {
  const doc = fixtures.documents.get(id);
  return doc && !doc.deleted_at ? doc : undefined;
}

/** A live page of the workspace; a page of another workspace is not found, as in the API. */
export function workspaceDocument(workspaceId: string, id: string): StoredDocument | undefined {
  const doc = liveDocument(id);
  return doc?.workspace_id === workspaceId ? doc : undefined;
}

/** The live pages of a workspace. */
export function documentsIn(workspaceId: string): StoredDocument[] {
  return [...fixtures.documents.values()].filter((doc) => !doc.deleted_at && doc.workspace_id === workspaceId);
}

/* ----------------------------------------
   Version trees
   ---------------------------------------- */

const SEEDED_REVISIONS: RevisionMetadataResponse[] = [
  { revision_id: 'rev-3', revision_no: 3, parent_revision_id: 'rev-2', kind: 'save', actor_type: 'human', origin: 'human', created_at: '2026-09-20T14:32:00Z', byte_size: 5120, content_hash: 'h3', summary: 'Edited Method', schema_version: 1, serializer_version: SERIALIZER, through_seq: 3, restored_from_revision_id: null },
  { revision_id: 'rev-2', revision_no: 2, parent_revision_id: 'rev-1', kind: 'change_set_accept', actor_type: 'agent', origin: 'agent', created_at: '2026-09-19T09:12:00Z', byte_size: 4980, content_hash: 'h2', summary: 'Accepted 2 AI suggestions', schema_version: 1, serializer_version: SERIALIZER, through_seq: 2, restored_from_revision_id: null },
  { revision_id: 'rev-1', revision_no: 1, parent_revision_id: null, kind: 'create', actor_type: 'human', origin: 'human', created_at: '2026-09-18T17:40:00Z', byte_size: 1200, content_hash: 'h1', summary: 'Created', schema_version: 1, serializer_version: SERIALIZER, through_seq: 1, restored_from_revision_id: null },
];

/**
 * What each seeded revision held, derived from the live fixture: v2 → v3
 * reworded the Method paragraph; v1 → v2 (the accepted AI suggestions)
 * rewrote the claim in the introduction, added a contribution and changed a
 * citation's sources.
 */
const OLD_METHOD = 'The objective adds an auxiliary balance term to the task loss: <span data-child-id="e-3" contenteditable="false"></span>';
const OLD_CLAIM = 'We show that sparse routing scales <strong>sublinearly</strong> in compute. Each token <span data-child-id="e-1" contenteditable="false"></span> goes to expert <span data-child-id="e-2" contenteditable="false"></span> through a gate.';

function revisionContent(content: DocumentContentOutput, revisionNo: number): DocumentContentOutput {
  if (revisionNo >= 3) return content;
  const blocks = (content.blocks ?? []).flatMap((block): WireBlock[] => {
    if (block.type !== 'paragraph') return [block];
    if (block.id === 'p-3') return [{ ...block, html: OLD_METHOD }];
    if (revisionNo >= 2) return [block];
    if (block.id === 'p-2') return [{ ...block, html: OLD_CLAIM }];
    if (block.id === 'li-4') return [];
    if (block.id === 'p-1') {
      const children = (block.children ?? []).map((child) =>
        child.id === 'c-1' && child.type === 'citation' ? { ...child, keys: ['2101.03961'] } : child,
      );
      return [{ ...block, children }];
    }
    return [block];
  });
  return { ...content, blocks };
}

/** A diff entry with the positions it does not name left null, as the API answers. */
function diffEntry(entry: Pick<SemanticDiffEntry, 'entity' | 'change' | 'entity_id' | 'entity_type' | 'fields'> & Partial<SemanticDiffEntry>): SemanticDiffEntry {
  return { from_index: null, to_index: null, parent_id: null, previous_parent_id: null, ...entry };
}

const METHOD_CHANGE = diffEntry({ entity: 'block', change: 'changed', entity_id: 'p-3', entity_type: 'paragraph', fields: ['html'] });
const AI_CHANGES: SemanticDiffEntry[] = [
  diffEntry({ entity: 'block', change: 'changed', entity_id: 'p-2', entity_type: 'paragraph', fields: ['html'] }),
  diffEntry({ entity: 'block', change: 'inserted', entity_id: 'li-4', entity_type: 'paragraph', to_index: 7, fields: [] }),
  diffEntry({ entity: 'child', change: 'changed', entity_id: 'c-1', entity_type: 'citation', parent_id: 'p-1', fields: ['keys', 'sources'] }),
];

export const isSeededRevision = (id: string) => SEEDED_REVISIONS.some((revision) => revision.revision_id === id);

/** The written-out changes between two seeded revisions (a citation's sources among them). */
export function seededChanges(base: string, against: string): SemanticDiffEntry[] {
  const rank = (id: string) => Number(id.replace('rev-', '')) || 3;
  const from = rank(base);
  const to = rank(against);
  const changes: SemanticDiffEntry[] = [];
  if (from < 2 && to >= 2) changes.push(...AI_CHANGES);
  if (from < 3 && to >= 3) changes.push(METHOD_CHANGE);
  return changes;
}

/**
 * Each document's version tree, as the API keeps it (ColWrite-api
 * `docs/document-history-api.md`): a save writes a revision under the one the
 * document sits on, and a restore moves that pointer without writing one.
 */
export type History = {
  /** Newest first, as the API lists them. */
  revisions: RevisionMetadataResponse[];
  /** What each revision held. */
  contents: Map<string, DocumentContentOutput>;
  /** The revision the document sits on. */
  pointer: string;
};

export function historyOf(doc: StoredDocument): History {
  const existing = fixtures.histories.get(doc._id);
  if (existing) return existing;
  const content = structuredClone(contentOf(doc));
  const seeded = doc._id === FIXTURE_DOCUMENT_ID && doc.head_seq === SEEDED_REVISIONS[0]?.revision_no;
  const revisions: RevisionMetadataResponse[] = seeded
    ? SEEDED_REVISIONS.map((revision) => ({ ...revision }))
    : [{
        revision_id: `rev-${doc.head_seq}`, revision_no: doc.head_seq, parent_revision_id: null, kind: 'save', actor_type: 'human',
        origin: 'human', created_at: doc.updated_at, byte_size: 1200, content_hash: `h${doc.head_seq}`, summary: null,
        schema_version: 1, serializer_version: SERIALIZER, through_seq: doc.head_seq, restored_from_revision_id: null,
      }];
  const contents = new Map(revisions.map((revision) => [
    revision.revision_id,
    seeded ? revisionContent(content, revision.revision_no) : content,
  ]));
  const created: History = { revisions, contents, pointer: revisions[0]?.revision_id ?? `rev-${doc.head_seq}` };
  fixtures.histories.set(doc._id, created);
  return created;
}

/** Record a write as a new revision under the current one, and move onto it. */
export function recordRevision(doc: StoredDocument, summary: string | null = null): void {
  const history = historyOf(doc);
  const revisionNo = Math.max(...history.revisions.map((revision) => revision.revision_no)) + 1;
  const revisionId = `rev-${revisionNo}`;
  const content = structuredClone(contentOf(doc));
  history.revisions.unshift({
    revision_id: revisionId,
    revision_no: revisionNo,
    parent_revision_id: history.pointer,
    kind: 'save',
    actor_type: 'human',
    origin: 'human',
    created_at: new Date().toISOString(),
    byte_size: JSON.stringify(content).length,
    content_hash: `h${revisionNo}`,
    summary,
    schema_version: 1,
    serializer_version: SERIALIZER,
    through_seq: doc.head_seq,
    restored_from_revision_id: null,
  });
  history.contents.set(revisionId, content);
  history.pointer = revisionId;
}

/** The head of a page (`DocumentStateResponse`). */
export function headOf(doc: StoredDocument): DocumentStateResponse {
  const history = historyOf(doc);
  const current = history.revisions.find((revision) => revision.revision_id === history.pointer);
  return {
    document_id: doc._id,
    workspace_id: doc.workspace_id,
    collection_id: doc.collection_id,
    sort_key: doc.sort_key,
    placement_etag: placementEtagOf(doc),
    head_seq: doc.head_seq,
    revision_no: current?.revision_no ?? doc.head_seq,
    revision_id: history.pointer,
    current_revision_id: history.pointer,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    deleted_at: doc.deleted_at,
    purge_after: purgeAfterOf(doc.deleted_at),
    trash_root: doc.deleted_at ? (doc.trash_root ?? { kind: 'document', id: doc._id }) : null,
    duplicate: false,
    content: contentOf(doc),
  };
}

/** Block-level changes between two stored states, by stable id as the API does. */
export function blockChanges(base: DocumentContentOutput, target: DocumentContentOutput): SemanticDiffEntry[] {
  const before = new Map((base.blocks ?? []).map((block, index) => [block.id, { block, index }]));
  const after = new Map((target.blocks ?? []).map((block, index) => [block.id, { block, index }]));
  const changes: SemanticDiffEntry[] = [];
  for (const [id, { block, index }] of before) {
    if (!after.has(id)) changes.push(diffEntry({ entity: 'block', change: 'deleted', entity_id: id, entity_type: block.type, from_index: index, fields: [] }));
  }
  for (const [id, { block, index }] of after) {
    const previous = before.get(id);
    if (!previous) {
      changes.push(diffEntry({ entity: 'block', change: 'inserted', entity_id: id, entity_type: block.type, to_index: index, fields: [] }));
      continue;
    }
    const was = previous.block as Json;
    const now = block as Json;
    const fields = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(
      (field) => JSON.stringify(was[field]) !== JSON.stringify(now[field]),
    );
    if (fields.length > 0) changes.push(diffEntry({ entity: 'block', change: 'changed', entity_id: id, entity_type: block.type, fields }));
  }
  return changes;
}

/**
 * Write the page as another tab would, for trying the save-conflict flow: the
 * open page's next autosave is refused, and it asks which version to keep.
 */
export function editElsewhere(id: string): boolean {
  const doc = liveDocument(id);
  if (!doc) return false;
  historyOf(doc);
  const blocks = [...doc.blocks];
  const index = blocks.findIndex((block) => block.type === 'paragraph');
  const paragraph = blocks[index];
  if (paragraph?.type === 'paragraph') {
    blocks[index] = { ...paragraph, html: `${paragraph.html ?? ''} (Edited in another tab.)` };
  }
  const edited: StoredDocument = { ...doc, blocks, head_seq: doc.head_seq + 1, updated_at: new Date().toISOString() };
  fixtures.documents.set(id, edited);
  recordRevision(edited, 'Edited in another tab');
  return true;
}

/**
 * Move the page to the Trash as another tab would: it is no longer listed,
 * and a read or a save of it is 409 `document_in_trash`, so the open page
 * shows that it is in the Trash, with Restore.
 */
export function trashElsewhere(id: string): boolean {
  const doc = liveDocument(id);
  if (!doc) return false;
  trashPage(doc);
  return true;
}

/**
 * Move a page as another tab would: to `collectionId` (`null` is the top
 * level), at the end of its pages. `tree_version` moves, so the tree reads its
 * open branches again, and a move this tab started from the old placement is
 * refused with 412 `stale_placement`. The content ETag stays, so the open
 * page keeps saving.
 */
export function moveElsewhere(id: string, collectionId: number | null = null): boolean {
  const doc = liveDocument(id);
  if (!doc) return false;
  if (collectionId !== null && !workspaceCollection(doc.workspace_id, collectionId)) return false;
  placeDocument(doc, collectionId, 'last');
  return true;
}

/** Where a new or moved item goes among its new siblings. */
export type Position = 'last' | { after_id: string | number } | { before_id: string | number } | null | undefined;

/**
 * The key for `position` among `ordered` (already in key order, without the
 * item being placed), or `null` for an anchor that is not one of them. Keys
 * that leave no room between two neighbours are given fresh ones first.
 */
export function keyAt<T extends { sort_key: string }>(
  ordered: T[],
  position: Position,
  idOf: (item: T) => string | number,
): string | null {
  const index = (anchor: string | number) => ordered.findIndex((item) => idOf(item) === anchor);
  let before: T | undefined;
  let after: T | undefined;
  if (!position || position === 'last') {
    before = ordered.at(-1);
  } else if ('after_id' in position) {
    const at = index(position.after_id);
    if (at < 0) return null;
    before = ordered[at];
    after = ordered[at + 1];
  } else {
    const at = index(position.before_id);
    if (at < 0) return null;
    before = ordered[at - 1];
    after = ordered[at];
  }
  if (before && after && before.sort_key >= after.sort_key) {
    // Two neighbours share a key: that home's items get fresh keys in their order.
    let previous: string | null = null;
    for (const item of ordered) {
      item.sort_key = keyBetween(previous, null);
      previous = item.sort_key;
    }
  }
  return keyBetween(before?.sort_key ?? null, after?.sort_key ?? null);
}

/** The pages of a home in custom order. */
export function pagesHomedIn(workspaceId: string, collectionId: number | null): StoredDocument[] {
  return documentsIn(workspaceId)
    .filter((doc) => doc.collection_id === collectionId)
    .sort(byKey((doc) => doc._id));
}

/**
 * Give a page a new home and place, as `sp_document_placement_apply` does:
 * the placement counter and `tree_version` move, and the `setting` grant
 * follows the new home. Returns `false` for an anchor that is not a page of
 * that home.
 */
export function placeDocument(doc: StoredDocument, collectionId: number | null, position: Position): boolean {
  const siblings = pagesHomedIn(doc.workspace_id, collectionId).filter((item) => item._id !== doc._id);
  const key = keyAt(siblings, position, (item) => item._id);
  if (key === null) return false;
  const moved: StoredDocument = { ...doc, collection_id: collectionId, sort_key: key, placement_seq: doc.placement_seq + 1 };
  fixtures.documents.set(doc._id, moved);
  syncSettingGrant(moved);
  bumpTree(doc.workspace_id);
  return true;
}

/**
 * "Pages here can use these PDFs": a page inside the subtree of a collection
 * with `grant_new_pages` has one `setting` grant, on the outermost such
 * collection, and loses it when it leaves. Grants added by hand stay.
 */
export function syncSettingGrant(doc: StoredDocument): void {
  const path = doc.collection_id === null ? [] : collectionPath(doc.collection_id);
  const flagged = path.find((collection) => collection.grant_new_pages) ?? null;
  for (const collection of fixtures.collections.values()) {
    if (collection.workspace_id !== doc.workspace_id || collection === flagged) continue;
    if (collection.grants.get(doc._id) === 'setting') collection.grants.delete(doc._id);
  }
  if (flagged && !flagged.grants.has(doc._id)) flagged.grants.set(doc._id, 'setting');
}

/** A structural change: the workspace's `tree_version` advances. */
export function bumpTree(workspaceId: string): number {
  const workspace = fixtures.workspaces.get(workspaceId);
  if (!workspace) return 0;
  workspace.tree_version += 1;
  return workspace.tree_version;
}

/** The workspace's tree version, as collection reads and page moves report it. */
export function treeVersionOf(workspaceId: string): number {
  return fixtures.workspaces.get(workspaceId)?.tree_version ?? 0;
}

/* ----------------------------------------
   Stored change sets (durable proposals)
   ---------------------------------------- */

/**
 * A stand-in for the API's block digest. Like the real one it is only ever
 * compared with another digest from the same function, and it ignores how a
 * block is shown. It reads the fields the preview's paragraphs and headings
 * have, so the defaults the editor adds on a save do not count as an edit.
 */
function mockFingerprint(block: Json): string {
  const text = JSON.stringify([
    block.type ?? '', block.html ?? '', block.text ?? '', block.variant ?? '', block.level ?? 0, block.checked ?? false,
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return `preview-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

type Target = { block_id: string; fingerprint: string };

/** A stored change set: its row, the target each operation found, and the review so far. */
export type StoredChangeSet = Omit<ChangeSetResponse, 'operation_targets' | 'operation_decisions' | 'compared_head_seq' | 'duplicate'> & {
  /** The target block as each rewrite or deletion found it; `null` for the rest. */
  targets: Array<Target | null>;
  decisions: ChangeSetOperationDecisionResponse[];
};

function changeSetRow(
  documentId: string,
  fields: Pick<StoredChangeSet, 'change_set_id' | 'operations' | 'targets' | 'decisions' | 'proposed_at' | 'summary' | 'apply_policy'>,
): StoredChangeSet {
  return {
    document_id: documentId,
    status: 'pending',
    expires_at: '2099-01-01T00:00:00Z',
    decided_at: null,
    decided_by: null,
    conflict_reason: null,
    rejection_reason: null,
    tool_call_id: 'call_edit',
    auto_blocked_reason: null,
    base_head_seq: 2,
    base_content_hash: 'h2',
    base_etag: `"cw:${SERIALIZER}:1:2:preview"`,
    base_revision_id: 'rev-2',
    proposer_id: 'preview-agent',
    proposer_type: 'agent',
    origin: 'agent',
    depends_on_change_set_id: null,
    run_uuid: 'preview-run',
    accepted_revision_id: null,
    accepted_head_seq: null,
    ...fields,
  };
}

function seededChangeSet(documents: Map<string, StoredDocument>): StoredChangeSet {
  const blocks = new Map((documents.get(REVIEW_DOCUMENT_ID)?.blocks ?? []).map((block) => [block.id, block as Json]));
  const found = (id: string, html?: string): Target => ({
    block_id: id,
    fingerprint: mockFingerprint(html === undefined ? blocks.get(id) ?? {} : { ...blocks.get(id), html }),
  });
  return changeSetRow(REVIEW_DOCUMENT_ID, {
    change_set_id: REVIEW_CHANGE_SET_ID,
    operations: [
      {
        op: 'replace_block',
        block_id: 'cr-abstract',
        block: { html: 'We study sparse routing at context lengths of up to 128k tokens and find that its compute cost grows <strong>sublinearly</strong>.' },
      },
      { op: 'insert_block_after', reference_id: 'cr-setup', block: reviewParagraph('cr-seeds', 'Each configuration is run with three seeds, and we report the mean.') },
      { op: 'replace_block', block_id: 'cr-results', block: { html: 'Sparse routing matches the dense baseline at 40% of the compute.' } },
      { op: 'delete_block', block_id: 'cr-thanks' },
      { op: 'append_block', block: reviewParagraph('cr-future', 'Future work will extend the evaluation beyond 128k tokens.') },
    ],
    targets: [found('cr-abstract'), null, found('cr-results', RESULTS_AS_PROPOSED), found('cr-thanks'), null],
    decisions: [
      { index: 1, decision: 'accepted', decided_at: '2026-09-20T13:10:00Z', decided_by: 'preview', origin: 'manual' },
      { index: 3, decision: 'rejected', decided_at: '2026-09-20T13:11:00Z', decided_by: 'preview', origin: 'manual' },
    ],
    proposed_at: '2026-09-20T13:05:00Z',
    summary: 'Tighten the abstract and the results for the camera-ready version.',
    apply_policy: 'review',
  });
}

/**
 * A change set an editor's assistant left on the viewer workspace's page: a
 * viewer sees it, and cannot accept or reject it.
 */
function viewerChangeSet(documents: Map<string, StoredDocument>): StoredChangeSet {
  const paragraph = documents.get(VIEWER_DOCUMENT_ID)?.blocks.find((block) => block.id === `${VIEWER_DOCUMENT_ID}-p`);
  return changeSetRow(VIEWER_DOCUMENT_ID, {
    change_set_id: '2c4e6a8b-0d1f-4a3c-9e5b-7d9f1b3d5f70',
    operations: [
      {
        op: 'replace_block',
        block_id: `${VIEWER_DOCUMENT_ID}-p`,
        block: { html: 'Multi-head latent attention (MLA) compresses the keys and values into one low-rank latent vector per token, which shrinks the KV cache.' },
      },
    ],
    targets: [{ block_id: `${VIEWER_DOCUMENT_ID}-p`, fingerprint: mockFingerprint((paragraph ?? {}) as Json) }],
    decisions: [],
    proposed_at: '2026-08-20T09:00:00Z',
    summary: 'Explain what MLA compresses.',
    apply_policy: 'review',
  });
}

/**
 * A change set as the API returns it, compared with the saved document. A
 * reject response is not compared: its targets carry no `head_fingerprint`.
 */
export function changeSetResponse(changeSet: StoredChangeSet, options: { duplicate?: boolean; compared?: boolean } = {}): ChangeSetResponse {
  const { duplicate = false, compared = true } = options;
  const doc = compared ? liveDocument(changeSet.document_id) : undefined;
  const saved = new Map((doc?.blocks ?? []).map((block) => [block.id, block as Json]));
  const { targets, decisions, ...row } = changeSet;
  return {
    ...row,
    duplicate,
    operation_targets: targets.map((target) => {
      if (!target) return null;
      const block = saved.get(target.block_id);
      return { ...target, head_fingerprint: block ? mockFingerprint(block) : null };
    }),
    compared_head_seq: doc?.head_seq ?? null,
    operation_decisions: decisions,
  };
}

export function changeSetsOf(documentId: string): StoredChangeSet[] {
  return fixtures.changeSets.get(documentId) ?? [];
}

/**
 * The edits the preview agent proposes when asked to improve the text: a
 * rewrite, an addition and a deletion, stored as a change set as `doc_edit`
 * stores them, so the review flow (pill, rows, accept/reject) and Auto can be
 * seen without a backend. Its policy follows the turn's `apply_mode`.
 */
export function storeProposedEdits(documentId: string, applyPolicy: 'auto' | 'review'): StoredChangeSet {
  const saved = new Map((liveDocument(documentId)?.blocks ?? []).map((block) => [block.id, block as Json]));
  const target = (id: string): Target | null => {
    const block = saved.get(id);
    return block ? { block_id: id, fingerprint: mockFingerprint(block) } : null;
  };
  const changeSet = changeSetRow(documentId, {
    change_set_id: uid(),
    operations: [
      {
        op: 'replace_block',
        block_id: 'p-2',
        block: {
          id: 'p-2',
          type: 'paragraph',
          html: 'In this paper, we show that sparse routing lets models scale <strong>sublinearly</strong> in compute while keeping quality. A learned gate assigns each token to one expert.',
          children: [],
        },
      },
      {
        op: 'insert_block_after',
        reference_id: 'li-4',
        block: { id: 'li-5', type: 'paragraph', variant: 'bullet', html: 'A study of routing collapse under long contexts.', children: [] },
      },
      { op: 'delete_block', block_id: 'q-1' },
    ],
    targets: [target('p-2'), null, target('q-1')],
    decisions: [],
    proposed_at: new Date().toISOString(),
    summary: 'Tighten the introduction.',
    apply_policy: applyPolicy,
  });
  fixtures.changeSets.set(documentId, [...changeSetsOf(documentId), changeSet]);
  return changeSet;
}

/* ----------------------------------------
   Chats
   ---------------------------------------- */

/** A stored message: the messages of a chat form a tree through `parent_id`. */
export type StoredMessage = ChatMessage;

/** A stored conversation: its row and its messages, oldest first. */
export type StoredChat = Omit<ChatSummary, 'last_message_id'> & {
  messages: StoredMessage[];
};

function message(
  id: number,
  parentId: number | null,
  role: ChatMessage['role'],
  content: string,
  createdAt: string,
  runId: string | null = null,
): StoredMessage {
  return { id, parent_id: parentId, role, content, attachments: [], run_id: runId, created_at: createdAt };
}

/*
 * As the API stores a turn: the question when its run starts, the answer
 * when it ends, both with the run's id, so the transcript can say how long
 * each reply took.
 */
function seededChats(): Map<string, StoredChat[]> {
  return new Map([[
    FIXTURE_DOCUMENT_ID,
    [
      {
        id: 'chat-method',
        title: 'Tighten the method section',
        created_at: '2026-09-20T13:04:41Z',
        updated_at: '2026-09-20T13:05:00Z',
        messages: [
          message(1, null, 'user', 'Tighten the method section without losing the load-balancing detail.', '2026-09-20T13:04:41Z', 'run-seed-method'),
          message(2, 1, 'assistant', 'I shortened the gating paragraph and kept the auxiliary loss definition. The change is waiting in the page for you to review.', '2026-09-20T13:05:00Z', 'run-seed-method'),
        ],
      },
      {
        id: 'chat-related',
        title: 'Related work on expert routing',
        created_at: '2026-09-18T09:39:52Z',
        updated_at: '2026-09-18T09:40:00Z',
        messages: [
          message(3, null, 'user', 'Which routing papers should the related work cite?', '2026-09-18T09:39:52Z', 'run-seed-related'),
          message(4, 3, 'assistant', 'Switch Transformers and ST-MoE are the two closest; both study top-1 routing at scale.', '2026-09-18T09:40:00Z', 'run-seed-related'),
        ],
      },
    ],
  ]]);
}

export function chatsOf(documentId: string): StoredChat[] {
  return fixtures.chats.get(documentId) ?? [];
}

/** The newest message of a chat, the leaf a read without `leaf` answers. */
export function newestMessage(chat: StoredChat): StoredMessage | undefined {
  return chat.messages.reduce<StoredMessage | undefined>((newest, item) => (!newest || item.id > newest.id ? item : newest), undefined);
}

/** A chat as `GET …/chats` lists it. */
export function chatSummary(chat: StoredChat): ChatSummary {
  const { messages: _messages, ...row } = chat;
  return { ...row, last_message_id: newestMessage(chat)?.id ?? null };
}

/** The chain of messages from the root to `leaf`, oldest first. */
export function messageChain(chat: StoredChat, leaf: number): StoredMessage[] {
  const byId = new Map(chat.messages.map((item) => [item.id, item]));
  const chain: StoredMessage[] = [];
  for (let current = byId.get(leaf); current; current = current.parent_id === null ? undefined : byId.get(current.parent_id)) {
    chain.unshift(current);
  }
  return chain;
}

/**
 * Keep a turn with its chat, starting one when the request names none. The
 * question continues from `leafId` (the chat's newest message without one).
 * Returns the chat and the answer's id, the chat's new leaf.
 */
export function recordTurn(
  documentId: string,
  chatId: string | null,
  leafId: number | null,
  text: string,
  attachments: Array<MessageImage | MessagePdf> = [],
): { chatId: string; messageId: number } {
  const list = chatsOf(documentId);
  let chat = chatId ? list.find((item) => item.id === chatId) : undefined;
  const now = new Date().toISOString();
  if (!chat) {
    chat = { id: `chat-preview-${list.length + 1}`, title: null, created_at: now, updated_at: now, messages: [] };
    fixtures.chats.set(documentId, [chat, ...list]);
  }
  const parent = leafId ?? newestMessage(chat)?.id ?? null;
  const question = { ...message(fixtures.nextMessageId++, parent, 'user', text, now), attachments };
  const answer = message(fixtures.nextMessageId++, question.id, 'assistant', `Here is what I found about "${text.slice(0, 60)}".`, now);
  chat.messages.push(question, answer);
  chat.updated_at = now;
  return { chatId: chat.id, messageId: answer.id };
}

/* ----------------------------------------
   PDFs, chat images and the Library
   ---------------------------------------- */

/** A PDF as the mock stores it: its workspace, where it is, and its row's other fields. */
export type StoredPdf = Omit<ResourceItem, 'location'> & {
  workspace_id: string;
  document_id: string | null;
  collection_id: number | null;
  /** When it went to the Trash, on its own or with its page or collection; it keeps its location there. */
  trashed_at?: string | null;
  trash_root?: { kind: 'resource' | 'document' | 'collection'; id: string } | null;
  trashed_by?: string | null;
};

/** An uploaded PDF, so Research → My PDFs and the Library have something to show. */
export function pdfRow(
  id: number,
  filename: string,
  title: string,
  createdAt = NOW,
  workspaceId = PERSONAL_WORKSPACE_ID,
): StoredPdf {
  return {
    id, workspace_id: workspaceId, filename, title, content_type: 'application/pdf', byte_size: 1_840_000 + id * 1000,
    checksum_sha256: `sha-${id}`,
    extraction: { status: 'ready', provider: 'jina', chars: 48_000, pages: 14, error: null, extracted_at: createdAt },
    document_id: null, collection_id: null, created_at: createdAt, updated_at: createdAt,
  };
}

/** A stored PDF as the API answers it: where it is, with the names of the page or collection. */
export function pdfItem(pdf: StoredPdf): ResourceItem {
  const { workspace_id: _workspace, document_id: documentId, collection_id: collectionId, ...row } = pdf;
  if (documentId) {
    return { ...row, location: { kind: 'document', document_id: documentId, document_name: liveDocument(documentId)?.name ?? null } };
  }
  if (collectionId !== null) {
    return { ...row, location: { kind: 'collection', collection_id: collectionId, collection_name: fixtures.collections.get(collectionId)?.name ?? null } };
  }
  return { ...row, location: { kind: 'unfiled' } };
}

/** Every PDF that is not in the Trash. */
export function livePdfs(): StoredPdf[] {
  return fixtures.pdfs.filter((pdf) => !pdf.trashed_at);
}

/** The PDFs of a workspace that are not in the Trash. */
export function pdfsIn(workspaceId: string): StoredPdf[] {
  return livePdfs().filter((pdf) => pdf.workspace_id === workspaceId);
}

/** The PDFs on a page. */
export function pdfsOn(documentId: string): StoredPdf[] {
  return livePdfs().filter((pdf) => pdf.document_id === documentId);
}

function seededPdfs(): StoredPdf[] {
  const inCollection = (pdf: StoredPdf, collectionId: number): StoredPdf => ({ ...pdf, collection_id: collectionId });
  return [
    pdfRow(42, 'st-moe.pdf', 'ST-MoE: Designing Stable and Transferable Sparse Expert Models', '2026-09-14T10:00:00Z'),
    pdfRow(41, 'switch-transformers.pdf', 'Switch Transformers: Scaling to Trillion Parameter Models', '2026-09-10T10:00:00Z'),
    pdfRow(51, 'cluster-budget.pdf', 'Cluster budget 2026', '2026-09-11T10:00:00Z', LAB_WORKSPACE_ID),
    // Reading notes holds PDFs and nothing else; Chapter 2 holds the paper its pages are written against.
    inCollection(pdfRow(61, 'gshard.pdf', 'GShard: Scaling Giant Models with Conditional Computation', '2026-05-03T10:00:00Z'), TREE.readingNotes),
    inCollection(pdfRow(62, 'glam.pdf', 'GLaM: Efficient Scaling of Language Models with Mixture-of-Experts', '2026-05-02T10:00:00Z'), TREE.readingNotes),
    inCollection(pdfRow(63, 'mixtral.pdf', 'Mixtral of Experts', '2026-05-01T10:00:00Z'), TREE.readingNotes),
    inCollection(pdfRow(64, 'routing-survey.pdf', 'A Survey of Routing in Sparse Expert Models', '2026-05-04T10:00:00Z'), TREE.chapter2),
    // In the Trash with Old drafts.
    {
      ...inCollection(pdfRow(TRASHED.collectionPdf, 'old-survey.pdf', 'An older survey of expert routing', '2026-04-02T10:00:00Z'), TRASHED.collection),
      trashed_at: daysAgo(3),
      trash_root: { kind: 'collection', id: String(TRASHED.collection) },
      trashed_by: PREVIEW_USER_ID,
    },
  ];
}

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** A grant's origin: added by hand, or by the collection's "Pages here can use these PDFs". */
export type GrantOrigin = 'manual' | 'setting';

/** A collection of a workspace's tree, with its parent, its order and the pages that use its PDFs. */
export type StoredCollection = {
  id: number;
  workspace_id: string;
  name: string;
  description: string | null;
  parent_id: number | null;
  /** Its place among its siblings in custom order. */
  sort_key: string;
  /** How its children are ordered. */
  sort_mode: SortMode;
  /** "Pages here can use these PDFs". */
  grant_new_pages: boolean;
  /** The counter in its ETag (`"cwc:{row_version}"`). */
  row_version: number;
  /** The pages granted this collection's PDFs ("Use on this page"), and how each grant came about. */
  grants: Map<string, GrantOrigin>;
  created_at: string;
  updated_at: string;
  /** When it went to the Trash; it keeps its place, its order and its grants there. */
  trashed_at: string | null;
  /** The collection whose move to the Trash took it there: itself for a trash root. */
  trash_root_id: number | null;
  trashed_by: string | null;
};

export const collectionEtagOf = (collection: StoredCollection) => `"cwc:${collection.row_version}"`;
export const workspaceEtagOf = (workspace: StoredWorkspace) => `"cww:${workspace.row_version}"`;

/** How a home orders its children: a collection's own mode, or the workspace's for the top level. */
export function sortModeOf(workspaceId: string, parentId: number | null): SortMode {
  if (parentId === null) return fixtures.workspaces.get(workspaceId)?.root_sort_mode ?? 'name';
  return fixtures.collections.get(parentId)?.sort_mode ?? 'name';
}

/** A home's collections in its order: by hand in `custom`, by name otherwise. */
export function orderedCollections(workspaceId: string, parentId: number | null): StoredCollection[] {
  const rows = collectionChildren(workspaceId, parentId);
  return rows.sort(sortModeOf(workspaceId, parentId) === 'custom' ? byKey((row) => row.id) : byName((row) => row.id));
}

/**
 * A collection of the workspace, or `undefined`: another workspace's
 * collection, and one in the Trash, is not found.
 */
export function workspaceCollection(workspaceId: string, id: number): StoredCollection | undefined {
  const collection = fixtures.collections.get(id);
  return collection?.workspace_id === workspaceId && !collection.trashed_at ? collection : undefined;
}

/** The collections of a workspace that are not in the Trash. */
export function liveCollections(workspaceId: string): StoredCollection[] {
  return [...fixtures.collections.values()].filter((collection) => collection.workspace_id === workspaceId && !collection.trashed_at);
}

export function collectionChildren(workspaceId: string, parentId: number | null): StoredCollection[] {
  return liveCollections(workspaceId).filter((collection) => collection.parent_id === parentId);
}

/** The collection and every collection under it that is not in the Trash (its active subtree). */
export function collectionSubtree(id: number): StoredCollection[] {
  const root = fixtures.collections.get(id);
  if (!root) return [];
  return [root, ...collectionChildren(root.workspace_id, id).flatMap((child) => collectionSubtree(child.id))];
}

export function collectionPath(id: number): StoredCollection[] {
  const path: StoredCollection[] = [];
  for (let current = fixtures.collections.get(id); current; current = current.parent_id === null ? undefined : fixtures.collections.get(current.parent_id)) {
    path.unshift(current);
  }
  return path;
}

/** A page's grant state on a collection: granted there, or on a collection above it. */
export function grantStateOf(collection: StoredCollection, documentId: string): CollectionGrantState {
  const nearest = [...collectionPath(collection.id)].reverse().find((item) => item.grants.has(documentId));
  return {
    direct: collection.grants.has(documentId),
    effective: nearest !== undefined,
    via_collection_id: nearest?.id ?? null,
    via_collection_name: nearest?.name ?? null,
  };
}

/** A collection as a listing shows it, with its counts and, when asked, a page's grant state. */
export function collectionSummary(collection: StoredCollection, grantStateFor: string | null = null): CollectionSummary {
  return {
    id: collection.id,
    name: collection.name,
    description: collection.description,
    parent_id: collection.parent_id,
    child_collection_count: collectionChildren(collection.workspace_id, collection.id).length,
    page_count: pagesHomedIn(collection.workspace_id, collection.id).length,
    pdf_count: livePdfs().filter((pdf) => pdf.collection_id === collection.id).length,
    grant_count: collection.grants.size,
    grant_state: grantStateFor ? grantStateOf(collection, grantStateFor) : null,
    sort_key: collection.sort_key,
    sort_mode: collection.sort_mode,
    grant_new_pages: collection.grant_new_pages,
    etag: collectionEtagOf(collection),
    created_at: collection.created_at,
    updated_at: collection.updated_at,
  };
}

/** A collection's detail: its path and its subtree counts. */
export function collectionDetail(collection: StoredCollection): CollectionDetail {
  const subtree = collectionSubtree(collection.id);
  const ids = new Set(subtree.map((item) => item.id));
  const path = collectionPath(collection.id);
  return {
    id: collection.id,
    name: collection.name,
    description: collection.description,
    parent_id: collection.parent_id,
    depth: path.length,
    child_collection_count: collectionChildren(collection.workspace_id, collection.id).length,
    descendant_collection_count: subtree.length - 1,
    pdf_count: livePdfs().filter((pdf) => pdf.collection_id === collection.id).length,
    subtree_pdf_count: livePdfs().filter((pdf) => pdf.collection_id !== null && ids.has(pdf.collection_id)).length,
    page_count: pagesHomedIn(collection.workspace_id, collection.id).length,
    grant_count: collection.grants.size,
    path: path.map((item) => ({ id: item.id, name: item.name })),
    sort_key: collection.sort_key,
    sort_mode: collection.sort_mode,
    grant_new_pages: collection.grant_new_pages,
    etag: collectionEtagOf(collection),
    tree_version: treeVersionOf(collection.workspace_id),
    created_at: collection.created_at,
    updated_at: collection.updated_at,
  };
}

/* ----------------------------------------
   The Trash (ColWrite-api docs/trash.md)
   ---------------------------------------- */

const now = () => new Date().toISOString();

/** The end of a home's custom order, for an item that comes back to the top level. */
function lastKeyOf(rows: Array<{ sort_key: string }>): string {
  const keys = rows.map((row) => row.sort_key).sort();
  return keyBetween(keys.at(-1) ?? null, null);
}

/**
 * Move a page to the Trash with its PDFs, as `trash_page` does: it keeps its
 * home, its history and its grants, and its content ETag does not change.
 */
export function trashPage(doc: StoredDocument, by: string = PREVIEW_USER_ID): StoredDocument {
  const at = now();
  const trashed: StoredDocument = { ...doc, deleted_at: at, trash_root: { kind: 'document', id: doc._id }, trashed_by: by };
  fixtures.documents.set(doc._id, trashed);
  for (const pdf of pdfsOn(doc._id)) Object.assign(pdf, { trashed_at: at, trash_root: { kind: 'document', id: doc._id }, trashed_by: by });
  bumpTree(doc.workspace_id);
  return trashed;
}

/**
 * Bring a page back with its PDFs, to its home or to the top level when the
 * home is gone. Its content ETag is the one it went with.
 */
export function restorePage(doc: StoredDocument): StoredDocument {
  const homeGone = doc.collection_id !== null && !workspaceCollection(doc.workspace_id, doc.collection_id);
  const restored: StoredDocument = {
    ...doc,
    deleted_at: null,
    trash_root: null,
    trashed_by: null,
    ...(homeGone
      ? { collection_id: null, sort_key: lastKeyOf(pagesHomedIn(doc.workspace_id, null)), placement_seq: doc.placement_seq + 1 }
      : {}),
  };
  fixtures.documents.set(doc._id, restored);
  for (const pdf of fixtures.pdfs) {
    if (pdf.trash_root?.kind === 'document' && pdf.trash_root.id === doc._id) Object.assign(pdf, { trashed_at: null, trash_root: null, trashed_by: null });
  }
  syncSettingGrant(restored);
  bumpTree(doc.workspace_id);
  return restored;
}

/**
 * What moving a collection to the Trash takes with it, as `trash-preview`
 * counts it: its active subtree, the pages homed there and the PDFs located
 * there.
 */
export function collectionTrashPreview(collection: StoredCollection): TrashCounts {
  const ids = new Set(collectionSubtree(collection.id).map((item) => item.id));
  const pdfs = pdfsIn(collection.workspace_id).filter((pdf) => pdf.collection_id !== null && ids.has(pdf.collection_id));
  return {
    collection_count: ids.size,
    page_count: documentsIn(collection.workspace_id).filter((doc) => doc.collection_id !== null && ids.has(doc.collection_id)).length,
    pdf_count: pdfs.length,
    pdf_bytes: pdfs.reduce((total, pdf) => total + pdf.byte_size, 0),
  };
}

/**
 * Move a collection and its active subtree to the Trash as one root: the
 * collections, the pages homed there (and their PDFs) and the PDFs located
 * there all record it. Something already in the Trash keeps its own root.
 */
export function trashCollectionTree(collection: StoredCollection, by: string = PREVIEW_USER_ID): TrashCounts {
  const counts = collectionTrashPreview(collection);
  const at = now();
  const root = { kind: 'collection' as const, id: String(collection.id) };
  const subtree = collectionSubtree(collection.id);
  const ids = new Set(subtree.map((item) => item.id));
  for (const doc of documentsIn(collection.workspace_id)) {
    if (doc.collection_id === null || !ids.has(doc.collection_id)) continue;
    for (const pdf of pdfsOn(doc._id)) Object.assign(pdf, { trashed_at: at, trash_root: root, trashed_by: by });
    fixtures.documents.set(doc._id, { ...doc, deleted_at: at, trash_root: root, trashed_by: by });
  }
  for (const pdf of pdfsIn(collection.workspace_id)) {
    if (pdf.collection_id !== null && ids.has(pdf.collection_id)) Object.assign(pdf, { trashed_at: at, trash_root: root, trashed_by: by });
  }
  for (const item of subtree) Object.assign(item, { trashed_at: at, trash_root_id: collection.id, trashed_by: by });
  bumpTree(collection.workspace_id);
  return counts;
}

/** The collections a collection trash root holds, itself among them. */
export function trashSet(rootId: number): StoredCollection[] {
  return [...fixtures.collections.values()].filter((item) => item.trash_root_id === rootId);
}

/** The pages that went to the Trash with a collection root. */
function pagesWithRoot(kind: 'document' | 'collection', id: string): StoredDocument[] {
  return [...fixtures.documents.values()].filter((doc) => doc.deleted_at && doc.trash_root?.kind === kind && doc.trash_root.id === id);
}

/**
 * Bring a collection root back with everything it held, to its place, or to
 * the top level when its parent is gone (`moved_to_root`).
 */
export function restoreCollectionTree(collection: StoredCollection): { movedToRoot: boolean; pageCount: number } {
  const set = trashSet(collection.id);
  const parentGone = collection.parent_id !== null && !workspaceCollection(collection.workspace_id, collection.parent_id);
  for (const item of set) Object.assign(item, { trashed_at: null, trash_root_id: null, trashed_by: null });
  if (parentGone) {
    collection.parent_id = null;
    collection.sort_key = lastKeyOf(collectionChildren(collection.workspace_id, null).filter((row) => row.id !== collection.id));
  }
  collection.row_version += 1;
  const id = String(collection.id);
  const pages = pagesWithRoot('collection', id);
  for (const doc of pages) {
    const restored: StoredDocument = { ...doc, deleted_at: null, trash_root: null, trashed_by: null };
    fixtures.documents.set(doc._id, restored);
    syncSettingGrant(restored);
  }
  for (const pdf of fixtures.pdfs) {
    if (pdf.trash_root?.kind === 'collection' && pdf.trash_root.id === id) Object.assign(pdf, { trashed_at: null, trash_root: null, trashed_by: null });
  }
  bumpTree(collection.workspace_id);
  return { movedToRoot: parentGone, pageCount: pages.length };
}

/** Move a PDF to the Trash on its own; it keeps its location. */
export function trashPdf(pdf: StoredPdf, by: string = PREVIEW_USER_ID): StoredPdf {
  Object.assign(pdf, { trashed_at: now(), trash_root: { kind: 'resource', id: String(pdf.id) }, trashed_by: by });
  return pdf;
}

/** Bring a PDF back to its location, or to Unfiled when that page or collection is gone. */
export function restorePdf(pdf: StoredPdf): StoredPdf {
  const placeGone = (pdf.document_id !== null && !workspaceDocument(pdf.workspace_id, pdf.document_id))
    || (pdf.collection_id !== null && !workspaceCollection(pdf.workspace_id, pdf.collection_id));
  Object.assign(pdf, { trashed_at: null, trash_root: null, trashed_by: null, ...(placeGone ? { document_id: null, collection_id: null } : {}) });
  pdf.updated_at = now();
  return pdf;
}

/** From the top level down to a collection, as a trash row's `original_path` names it. */
function originalPath(parentId: number | null): TrashItem['original_path'] {
  return parentId === null ? [] : collectionPath(parentId).map((item) => ({ id: item.id, name: item.name }));
}

/** A collection root's contents, as the Trash shows them and "Delete forever" expects them. */
export function trashRootCounts(rootId: number): TrashCounts {
  const set = trashSet(rootId);
  const ids = new Set(set.map((item) => item.id));
  const pdfs = fixtures.pdfs.filter((pdf) => pdf.trashed_at && pdf.collection_id !== null && ids.has(pdf.collection_id));
  return {
    collection_count: set.length,
    page_count: pagesWithRoot('collection', String(rootId)).length,
    pdf_count: pdfs.length,
    pdf_bytes: pdfs.reduce((total, pdf) => total + pdf.byte_size, 0),
  };
}

/** A workspace's trash roots, newest first, as `GET /trash` lists them. */
export function trashRoots(workspaceId: string): TrashItem[] {
  const pages: TrashItem[] = [...fixtures.documents.values()]
    .filter((doc) => doc.workspace_id === workspaceId && doc.deleted_at && (doc.trash_root?.kind ?? 'document') === 'document')
    .map((doc) => ({
      kind: 'document', id: doc._id, name: doc.name, original_path: originalPath(doc.collection_id),
      trashed_at: doc.deleted_at as string, trashed_by: doc.trashed_by ?? null, purge_after: purgeAfterOf(doc.deleted_at) as string, counts: null,
    }));
  const collections: TrashItem[] = [...fixtures.collections.values()]
    .filter((item) => item.workspace_id === workspaceId && item.trashed_at && item.trash_root_id === item.id)
    .map((item) => ({
      kind: 'collection', id: String(item.id), name: item.name, original_path: originalPath(item.parent_id),
      trashed_at: item.trashed_at as string, trashed_by: item.trashed_by, purge_after: purgeAfterOf(item.trashed_at) as string,
      counts: trashRootCounts(item.id),
    }));
  const pdfs: TrashItem[] = fixtures.pdfs
    .filter((pdf) => pdf.workspace_id === workspaceId && pdf.trashed_at && pdf.trash_root?.kind === 'resource')
    .map((pdf) => ({
      kind: 'resource', id: String(pdf.id), name: pdf.title || pdf.filename, original_path: originalPath(pdf.collection_id),
      trashed_at: pdf.trashed_at as string, trashed_by: pdf.trashed_by ?? null, purge_after: purgeAfterOf(pdf.trashed_at) as string, counts: null,
    }));
  return [...pages, ...collections, ...pdfs].sort((a, b) =>
    b.trashed_at.localeCompare(a.trashed_at) || b.kind.localeCompare(a.kind) || b.id.localeCompare(a.id));
}

/** Delete a page for good: its history, change sets and chats go; its PDFs move to Unfiled, live again. */
function purgePage(doc: StoredDocument): void {
  fixtures.documents.delete(doc._id);
  fixtures.histories.delete(doc._id);
  fixtures.changeSets.delete(doc._id);
  fixtures.chats.delete(doc._id);
  for (const collection of fixtures.collections.values()) collection.grants.delete(doc._id);
  for (const pdf of fixtures.pdfs) {
    if (pdf.document_id === doc._id) Object.assign(pdf, { document_id: null, trashed_at: null, trash_root: null, trashed_by: null });
  }
}

/**
 * Purge one trash root, as the purge jobs do with `COLWRITE_TRASH_PURGE=on`:
 * a collection root takes its collections, the PDFs located there and its
 * pages; a page takes its history and chats, and its PDFs move to Unfiled;
 * a PDF goes on its own.
 */
export function purgeRoot(item: Pick<TrashItem, 'kind' | 'id'>): void {
  if (item.kind === 'document') {
    const doc = fixtures.documents.get(item.id);
    if (doc) purgePage(doc);
    return;
  }
  if (item.kind === 'resource') {
    fixtures.pdfs = fixtures.pdfs.filter((pdf) => String(pdf.id) !== item.id);
    return;
  }
  const rootId = Number(item.id);
  for (const doc of pagesWithRoot('collection', item.id)) purgePage(doc);
  const ids = new Set(trashSet(rootId).map((collection) => collection.id));
  fixtures.pdfs = fixtures.pdfs.filter((pdf) => !(pdf.trashed_at && pdf.collection_id !== null && ids.has(pdf.collection_id)));
  for (const id of ids) fixtures.collections.delete(id);
}

/* ----------------------------------------
   Workspace jobs
   ---------------------------------------- */

/** A job as the mock keeps it: it reaches `done` `duration` ms after it started, its progress rising on the way. */
export type StoredJob = {
  id: number;
  workspace_id: string;
  kind: WorkspaceJob['kind'];
  total: number;
  started: number;
  duration: number;
  created_at: string;
  /** What a copy or an export made, reported once the job is done. */
  result: JobResult | null;
};

/**
 * Start a job of `total` steps (pages to move, roots to purge). The work
 * itself is done at once, so what the job hides is already hidden; the job
 * only takes its time to report done, so the progress can be seen.
 */
export function startJob(workspaceId: string, kind: WorkspaceJob['kind'], total: number, result: JobResult | null = null): StoredJob {
  const job: StoredJob = {
    id: fixtures.nextJobId++, workspace_id: workspaceId, kind, total, started: Date.now(), duration: fixtures.jobDurationMs, created_at: now(), result,
  };
  fixtures.jobs.set(job.id, job);
  return job;
}

/** A job as `GET /jobs/{id}` answers: running until its time is up, then done, with what it made. */
export function jobState(job: StoredJob): WorkspaceJob {
  const elapsed = Date.now() - job.started;
  const finished = elapsed >= job.duration;
  const done = finished ? job.total : Math.min(job.total, Math.floor((job.total * elapsed) / Math.max(1, job.duration)));
  return {
    id: job.id,
    kind: job.kind,
    status: finished ? 'done' : elapsed < 150 ? 'pending' : 'running',
    progress: { done, total: job.total, dry_run: null, items: null, result: finished ? job.result : null },
    last_error: null,
    created_at: job.created_at,
    updated_at: finished ? new Date(job.started + job.duration).toISOString() : now(),
  };
}

/** A result of nothing but the fields a job kind fills. */
export const jobResult = (fields: Partial<JobResult>): JobResult => ({
  document_id: null, page_count: null, pdf_count: null, byte_size: null, expires_at: null, ...fields,
});

/**
 * Export a workspace as the API's `workspace_export` job does: every live
 * page (and with `includePdfs` every live PDF) in a zip kept seven days. The
 * mock keeps only what the job reports.
 */
export function exportWorkspace(workspace: StoredWorkspace, includePdfs: boolean): StoredJob {
  const pages = documentsIn(workspace.id);
  const pdfs = includePdfs ? pdfsIn(workspace.id) : [];
  const stamp = new Date().toISOString().slice(0, 10);
  const made: StoredExport = {
    filename: `${workspace.name} ${stamp}.zip`,
    include_pdfs: includePdfs,
    page_count: pages.length,
    pdf_count: pdfs.length,
    byte_size: 4096 + pages.length * 2_400 + pdfs.reduce((total, pdf) => total + pdf.byte_size, 0),
    expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(),
  };
  workspace.export = made;
  return startJob(workspace.id, 'workspace_export', Math.max(1, pages.length), jobResult({
    page_count: made.page_count, pdf_count: made.pdf_count, byte_size: made.byte_size, expires_at: made.expires_at,
  }));
}

/**
 * Copy a page into another workspace, as the API's `workspace_copy` job does
 * (D11): its content, and the PDFs chosen as new PDFs of the target located
 * on the copy. History, review, chats and PDF grants stay behind. The copy is
 * made at once; the job reports it when it is done.
 */
export function copyPage(
  source: StoredDocument,
  target: StoredWorkspace,
  collectionId: number | null,
  includePdfs: 'none' | 'located' | 'located_and_granted',
): StoredJob {
  const id = `66f0c0ffee0000000000${String(fixtures.nextDocumentNumber++).padStart(4, '0')}`;
  const at = now();
  const siblings = pagesHomedIn(target.id, collectionId);
  const copy: StoredDocument = {
    _id: id, workspace_id: target.id, collection_id: collectionId, sort_key: lastKeyOf(siblings), placement_seq: 1,
    name: source.name, head_seq: 1, tags: [...source.tags], blocks: structuredClone(source.blocks),
    sources: source.sources ? structuredClone(source.sources) : null, citationStyle: source.citationStyle ?? null,
    created_at: at, updated_at: at, deleted_at: null,
  };
  fixtures.documents.set(id, copy);
  const located = includePdfs === 'none' ? [] : pdfsOn(source._id);
  const granted = includePdfs === 'located_and_granted'
    ? liveCollections(source.workspace_id)
        .filter((collection) => collection.grants.has(source._id))
        .flatMap((collection) => collectionSubtree(collection.id))
        .flatMap((collection) => pdfsIn(source.workspace_id).filter((pdf) => pdf.collection_id === collection.id))
    : [];
  const pdfs = [...new Map([...located, ...granted].map((pdf) => [pdf.id, pdf])).values()];
  for (const pdf of pdfs) {
    const nextId = Math.max(0, ...fixtures.pdfs.map((item) => item.id)) + 1;
    fixtures.pdfs.push({
      ...structuredClone(pdf), id: nextId, workspace_id: target.id, document_id: id, collection_id: null,
      trashed_at: null, trash_root: null, created_at: at, updated_at: at,
    });
  }
  bumpTree(target.id);
  return startJob(target.id, 'workspace_copy', 1 + pdfs.length, jobResult({ document_id: id, pdf_count: pdfs.length }));
}

/* ----------------------------------------
   Research
   ---------------------------------------- */

export const PAPERS = [
  { id: '2101.03961', title: 'Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity', authors: 'William Fedus, Barret Zoph, Noam Shazeer', year: 2021, venue: 'JMLR', cites: 2841, abstract: 'We simplify the MoE routing algorithm and design intuitive improved models with reduced communication and computational costs, training models up to a trillion parameters.' },
  { id: '2202.08906', title: 'ST-MoE: Designing Stable and Transferable Sparse Expert Models', authors: 'Barret Zoph, Irwan Bello, Sameer Kumar, Nan Du', year: 2022, venue: 'arXiv', cites: 512, abstract: 'We design a 269B sparse model with the router z-loss, which resolves training instabilities while keeping quality.' },
  { id: '2006.16668', title: 'GShard: Scaling Giant Models with Conditional Computation and Automatic Sharding', authors: 'Dmitry Lepikhin, HyoukJoong Lee, Yuanzhong Xu', year: 2020, venue: 'ICLR', cites: 1630, abstract: 'GShard enables scaling a multilingual translation Transformer with Sparsely-Gated Mixture-of-Experts beyond 600 billion parameters.' },
  { id: '2112.06905', title: 'GLaM: Efficient Scaling of Language Models with Mixture-of-Experts', authors: 'Nan Du, Yanping Huang, Andrew M. Dai', year: 2022, venue: 'ICML', cites: 690, abstract: 'GLaM uses a sparsely activated mixture-of-experts architecture to scale capacity while incurring substantially less training cost than dense variants.' },
  { id: '2401.04088', title: 'Mixtral of Experts', authors: 'Albert Q. Jiang, Alexandre Sablayrolles, Antoine Roux', year: 2024, venue: 'arXiv', cites: 1450, abstract: 'Mixtral 8x7B is a sparse mixture of experts language model where each layer is composed of 8 feed-forward blocks.' },
] as const;
type Paper = (typeof PAPERS)[number];

export function s2Paper(paper: Paper): PaperPayload {
  return {
    provider: 'semantic_scholar',
    paper_id: `s2-${paper.id}`,
    portable_key: `arxiv:${paper.id}`,
    corpus_id: 1000 + paper.cites,
    external_ids: { ArXiv: paper.id },
    title: paper.title,
    abstract: paper.abstract,
    url: `https://www.semanticscholar.org/paper/s2-${paper.id}`,
    authors: paper.authors.split(', ').map((name, index) => ({ author_id: `a${index}`, name })),
    year: paper.year,
    venue: paper.venue,
    citation_count: paper.cites,
    influential_citation_count: Math.round(paper.cites / 12),
    reference_count: 60,
    is_open_access: true,
    tldr: `${paper.abstract.split('.')[0]}.`,
    publication_types: ['JournalArticle'],
    fields_of_study: ['Computer Science'],
    bibtex: null,
    evidence: [],
    journal_name: paper.venue,
    journal_pages: null,
    journal_volume: null,
    open_access_pdf: null,
    pdf_url: `https://arxiv.org/pdf/${paper.id}`,
    provenance: [{ provider: 'semantic_scholar', endpoint: 'paper/search', provider_id: `s2-${paper.id}` }],
    publication_date: `${paper.year}-01-15`,
    relevance_score: null,
  };
}

/** Papers citing (or cited by) the one asked about, with citation contexts. */
export function semanticScholarGraph(paperId: string, direction: 'citations' | 'references'): PaperGraphResponse {
  const others = PAPERS.filter((paper) => `s2-${paper.id}` !== paperId);
  const contexts = direction === 'citations'
    ? [
        'Following Switch Transformers, we route each token to a single expert and keep the capacity factor at 1.25.',
        'Top-1 routing (Fedus et al.) reduces communication cost relative to top-2 gating.',
        'We adopt the load-balancing auxiliary loss introduced for sparse expert models.',
        'Sparse expert layers scale parameter count without a matching increase in compute.',
      ]
    : [
        'Mixture-of-experts layers were first shown to scale in machine translation.',
        'Conditional computation activates only part of the network per example.',
        'Expert parallelism shards experts across devices.',
        'Dense Transformers remain the baseline for quality per FLOP.',
      ];
  return {
    provider: 'semantic_scholar',
    paper_id: paperId,
    direction,
    offset: 0,
    next_offset: null,
    data: others.map((paper, index) => ({
      contexts: [contexts[index % contexts.length] ?? ''],
      intents: index === 0 ? ['methodology'] : index === 1 ? ['background', 'result'] : ['background'],
      is_influential: index < 2,
      evidence: [],
      paper: s2Paper(paper),
    })),
  };
}

/** A worked "check a claim" answer: a verdict, evidence both ways, limits. */
export function claimAssessment(claim: string): ClaimAssessment {
  const [fedus, stmoe, gshard, glam] = PAPERS;
  const finding = (
    paper: Paper,
    id: string,
    stance: ClaimEvidenceFinding['stance'],
    kind: ClaimEvidenceFinding['kind'],
    excerpt: string,
    explanation: string,
    score: number,
  ): ClaimEvidenceFinding => ({
    evidence_id: id,
    stance,
    explanation,
    excerpt,
    kind,
    paper_id: `s2-${paper.id}`,
    corpus_id: 1000 + paper.cites,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    url: `https://www.semanticscholar.org/paper/s2-${paper.id}`,
    score,
    license: 'CC BY 4.0',
    open_access_status: 'GREEN',
    disclaimer: null,
    provenance: [{ provider: 'semantic_scholar', endpoint: 'snippet/search', provider_id: `s2-${paper.id}` }],
  });
  return {
    claim,
    verdict: 'mixed',
    confidence: 0.64,
    rationale:
      'Several large-scale studies report that sparse expert models reach dense-model quality at lower training cost, but at least one reports instabilities and quality loss at small scale, so support depends on model size and routing choices.',
    evidence: [
      finding(fedus, 'E1', 'supports', 'abstract', 'We achieve up to 7x increases in pre-training speed with the same computational resources.', 'Reports a large speed-up at equal compute for a sparse model.', 0.91),
      finding(glam, 'E2', 'supports', 'abstract', 'GLaM consumes only 1/3 of the energy used to train GPT-3 while achieving better overall zero-shot performance.', 'Lower training cost at better quality than a dense baseline.', 0.86),
      finding(stmoe, 'E3', 'contradicts', 'body', 'Sparse models are prone to training instabilities, and at smaller scales we observe quality degradation relative to dense baselines.', 'Finds quality loss and instability, weakening the claim at small scale.', 0.72),
      finding(gshard, 'E4', 'context', 'citation_context', 'Conditional computation lets model capacity grow without a proportional increase in computation.', 'Background on why sparse routing can scale sublinearly.', 0.55),
    ],
    limitations: [
      'Only abstracts and open-access snippets were searched.',
      'Results at under 1B parameters are sparse.',
    ],
    provider: 'semantic_scholar',
    disclaimer: 'Automated assessment from literature snippets. Read the papers before relying on it.',
  };
}

/** The public arXiv text search (`VITE_ARZ_API`), which is not ColWrite-api. */
export function arxivSearch(): unknown[] {
  return PAPERS.map((paper, index) => ({
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    date: `${paper.year}-01-15`,
    abstract: paper.abstract,
    doi: null,
    score: 0.92 - index * 0.07,
  }));
}

/** The public ColPali page search (`VITE_COLPALI_BASE`), which is not ColWrite-api. */
export function colpaliSearch(): Json {
  return {
    data: PAPERS.slice(0, 3).map((paper, index) => ({
      page: index + 3,
      id: paper.id,
      doi: null,
      date: `${paper.year}-01-15`,
      title: paper.title,
      authors: paper.authors,
      abstract: paper.abstract,
      url: `https://arxiv.org/abs/${paper.id}`,
      version: 'v1',
      page_image: null,
    })),
  };
}

/* ----------------------------------------
   The account
   ---------------------------------------- */

/** The signed-in person, as `GET /users/me` answers. */
export function me(): UserMeResponse {
  return {
    identity: { user_id: 'u-preview', username: 'Ada Author', user_type: 'user', email: 'ada@example.org' },
    profile: {
      user_id: 'u-preview', username: 'Ada Author', display_name: 'Ada Author', headline: 'PhD student, efficient ML', affiliation: 'Example University',
      bio: null, locale: 'en', timezone: 'UTC', avatar_url: null, preferences: {}, last_seen_at: NOW, created_at: '2026-01-10T10:00:00Z', updated_at: NOW,
      ...fixtures.profile,
    },
  };
}

/** A workspace as `GET /workspaces/{w}` answers, with its counts. */
export function workspaceDetail(workspace: StoredWorkspace): WorkspaceDetailResponse {
  return {
    ...workspaceSummary(workspace),
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
    root_sort_mode: workspace.root_sort_mode,
    tree_version: workspace.tree_version,
    policy: { ...workspace.policy },
    etag: workspaceEtagOf(workspace),
    counts: {
      pages: documentsIn(workspace.id).length,
      collections: liveCollections(workspace.id).length,
      pdfs: pdfsIn(workspace.id).length,
      trash: trashRoots(workspace.id).length,
      members: membersOf(workspace.id).length,
    },
    ownership_transfer: transferOf(workspace.id),
  };
}

/** A workspace's usage (`GET /workspaces/{w}/usage`). */
export function usageOf(workspaceId: string, days: number): WorkspaceUsageResponse {
  const series = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 7, 22 + index)).toISOString().slice(0, 10);
    return { day, document_events: (index * 7) % 5, agent_run_events: (index * 3) % 4, resource_events: index % 6 === 0 ? 1 : 0 };
  });
  const documents = documentsIn(workspaceId);
  const pdfs = pdfsIn(workspaceId);
  const deleted = [...fixtures.documents.values()].filter((doc) => doc.workspace_id === workspaceId && doc.deleted_at).length;
  return {
    days,
    summary: {
      documents_active: documents.length, documents_deleted: deleted + 1,
      first_document_at: '2026-02-01T10:00:00Z', last_document_at: NOW, document_saves: 412,
      chats_total: 18, chat_messages_total: 240, agent_runs_total: 96, agent_runs_completed: 91, agent_runs_failed: 5, last_agent_run_at: NOW,
      tokens_input: 1_240_000, tokens_output: 98_000, llm_calls_total: 310, tool_calls_total: 520, tool_calls_failed: 12,
      resources_active: pdfs.length, resources_bytes: pdfs.reduce((total, pdf) => total + pdf.byte_size, 0),
      last_resource_at: NOW, resources_extracted: pdfs.filter((pdf) => pdf.extraction.status === 'ready').length,
      collections_active: liveCollections(workspaceId).length,
    },
    activity: series.slice(-days),
    tools: [
      { tool_name: 'doc_edit', call_count: 140, error_count: 3, avg_duration_ms: 420, last_used_at: NOW },
      { tool_name: 'semantic_scholar_search', call_count: 88, error_count: 2, avg_duration_ms: 900, last_used_at: NOW },
      { tool_name: 'cite_sources', call_count: 41, error_count: 0, avg_duration_ms: 610, last_used_at: NOW },
    ],
    pages: documents
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 8)
      .map((doc) => ({
        id: doc._id, name: doc.name, updated_at: doc.updated_at,
        chats: chatsOf(doc._id).length, assistant_runs: 5, saves: 30, pdfs: pdfsOn(doc._id).length,
      })),
    storage: { pdfs: pdfs.length, pdf_bytes: pdfs.reduce((total, pdf) => total + pdf.byte_size, 0) },
  };
}

/**
 * The account's usage across every workspace it can open
 * (`GET /users/me/usage`): the counters and the days summed, the most used
 * tools over all of them, and each workspace's share.
 */
export function accountUsageOf(days: number): AccountUsageResponse {
  const workspaces = [...fixtures.workspaces.values()].filter((workspace) => liveWorkspace(workspace.id));
  const each = workspaces.map((workspace) => ({ workspace, usage: usageOf(workspace.id, days) }));
  const summary = { ...(each[0]?.usage.summary ?? usageOf(PERSONAL_WORKSPACE_ID, days).summary) };
  const counters = [
    'documents_active', 'documents_deleted', 'document_saves', 'chats_total', 'chat_messages_total', 'agent_runs_total',
    'agent_runs_completed', 'agent_runs_failed', 'tokens_input', 'tokens_output', 'llm_calls_total', 'tool_calls_total',
    'tool_calls_failed', 'resources_active', 'resources_bytes', 'resources_extracted', 'collections_active',
  ] as const;
  for (const counter of counters) {
    summary[counter] = each.reduce((total, { usage }) => total + (usage.summary[counter] ?? 0), 0);
  }
  const activity = new Map<string, AccountUsageResponse['activity'][number]>();
  for (const { usage } of each) {
    for (const day of usage.activity) {
      const sum = activity.get(day.day) ?? { day: day.day, document_events: 0, agent_run_events: 0, resource_events: 0 };
      sum.document_events += day.document_events;
      sum.agent_run_events += day.agent_run_events;
      sum.resource_events += day.resource_events;
      activity.set(day.day, sum);
    }
  }
  const shares: WorkspaceUsageShare[] = each.map(({ workspace, usage }) => ({
    id: workspace.id, name: workspace.name, kind: workspace.kind, summary: usage.summary, storage: usage.storage,
  }));
  return {
    days,
    summary,
    activity: [...activity.values()].sort((a, b) => a.day.localeCompare(b.day)),
    tools: each[0]?.usage.tools ?? [],
    storage: {
      pdfs: shares.reduce((total, share) => total + share.storage.pdfs, 0),
      pdf_bytes: shares.reduce((total, share) => total + share.storage.pdf_bytes, 0),
    },
    workspaces: shares,
  };
}

type AgentSettings = Required<Pick<AgentToolSettingsResponse, 'version' | 'sources' | 'categories' | 'skills' | 'features'>>;

/**
 * Save the agent tool switches and resolve what each one makes effective,
 * exactly as the API catalog does: sources, then tool dependencies, then
 * skills and features.
 */
export function updateAgentSettings(changes: { sources?: Record<string, boolean> | null; tools?: Record<string, boolean> | null; skills?: Record<string, boolean> | null; features?: Record<string, boolean> | null }): AgentSettings {
  const settings = fixtures.agentSettings;
  const tools = settings.categories.flatMap((category) => category.tools ?? []);
  for (const [key, options] of [
    ['sources', settings.sources], ['tools', tools], ['skills', settings.skills], ['features', settings.features],
  ] as const) {
    const wanted = changes[key];
    for (const option of options) {
      if (typeof wanted?.[option.id] === 'boolean') option.enabled = wanted[option.id] as boolean;
    }
  }
  for (const source of settings.sources) source.effective_enabled = source.enabled && source.available;
  for (let pass = 0; pass < tools.length; pass += 1) {
    for (const tool of tools) {
      const dependencies = (tool.requires_sources ?? []).map((id) => settings.sources.find((source) => source.id === id)?.effective_enabled === true);
      const sourcesReady = dependencies.length === 0 || (tool.source_policy === 'any' ? dependencies.some(Boolean) : dependencies.every(Boolean));
      tool.effective_enabled = tool.enabled && tool.available && sourcesReady
        && (tool.requires_tools ?? []).every((id) => tools.find((candidate) => candidate.id === id)?.effective_enabled);
    }
  }
  for (const item of [...settings.skills, ...settings.features]) {
    item.effective_enabled = item.enabled && item.available
      && (item.requires_tools ?? []).every((id) => tools.find((tool) => tool.id === id)?.effective_enabled);
  }
  return settings;
}

/** The features a run of the preview agent has on. */
export function enabledFeatures(): string[] {
  return fixtures.agentSettings.features.filter((feature) => feature.effective_enabled).map((feature) => feature.id);
}

/**
 * The engines as a *local* API reports them: Claude Code signed in and Codex
 * waiting for `codex login`. "Check again" on Codex then reports it signed
 * in, as if the author had run the command. A deployed API reports
 * `runtime: "deployed"` and only `gateway`; see ColWrite-api/docs/agent-engines.md.
 */
function seededEngines(): Record<'gateway' | 'claude' | 'codex', EngineStatusResponse> {
  return {
    gateway: { engine: 'gateway', name: 'ColWrite model gateway', state: 'ready', available: true, message: 'Magic LLM through the configured model gateway.' },
    claude: {
      engine: 'claude', name: 'Claude Code', state: 'ready', available: true,
      message: 'Signed in to Claude Code with your account.', auth_method: 'claude.ai', plan: 'max',
      version: '2.1.280 (Claude Code)', checked_at: 1790290000,
    },
    codex: {
      engine: 'codex', name: 'Codex', state: 'unauthenticated', available: false,
      message: 'Codex is not signed in. Run `codex login` in your terminal and sign in with your own ChatGPT account, then check again.',
      login_command: 'codex login', version: 'codex-cli 0.156.1', checked_at: 1790290000,
    },
  };
}

export const GATEWAY_MODELS = {
  main: ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5', 'google/gemini-4-hydrogen'],
  lite: ['openai/gpt-6-luna', 'anthropic/claude-haiku-5.5', 'google/gemini-4-hydrogen'],
};

/* ----------------------------------------
   The size fixture (for measuring the tree)
   ---------------------------------------- */

/**
 * A workspace the size the tree is planned for (05 §7): 300 collections up
 * to eight deep, 2,000 pages and 1,500 PDFs, added to the personal
 * workspace. The default preview stays light; `dev-preview.html?fixture=size`
 * seeds this before the app starts.
 */
export function seedSizeFixture(workspaceId = PERSONAL_WORKSPACE_ID): void {
  const at = '2026-04-01T10:00:00Z';
  const created: StoredCollection[] = [];
  const depthOf = new Map<number, number>();
  const lastKey = new Map<number | 'root', string | null>();
  const nextKey = (home: number | 'root') => {
    const key = keyBetween(lastKey.get(home) ?? null, null);
    lastKey.set(home, key);
    return key;
  };
  for (const row of fixtures.collections.values()) {
    if (row.workspace_id === workspaceId) lastKey.set(row.parent_id ?? 'root', row.sort_key);
  }
  for (let index = 0; index < 300; index += 1) {
    const id = 1000 + index;
    // Twenty areas at the top, then each collection under an earlier one
    // that is not yet eight deep, spread so some chains reach the limit.
    let parent: StoredCollection | null = null;
    if (index >= 20) {
      for (let step = 0; step < created.length; step += 1) {
        const candidate = created[(index * 7 + step * 13) % created.length] as StoredCollection;
        if ((depthOf.get(candidate.id) ?? 1) < 8) {
          parent = candidate;
          break;
        }
      }
    }
    const row: StoredCollection = {
      id, workspace_id: workspaceId, name: parent ? `Topic ${index}` : `Area ${index + 1}`, description: null,
      parent_id: parent?.id ?? null, sort_key: nextKey(parent?.id ?? 'root'), sort_mode: index % 5 === 0 ? 'custom' : 'name',
      grant_new_pages: false, row_version: 1, grants: new Map(), created_at: at, updated_at: at,
      trashed_at: null, trash_root_id: null, trashed_by: null,
    };
    depthOf.set(id, parent ? (depthOf.get(parent.id) ?? 1) + 1 : 1);
    created.push(row);
    fixtures.collections.set(id, row);
  }
  fixtures.nextCollectionId = Math.max(fixtures.nextCollectionId, 1300);
  for (let index = 0; index < 2000; index += 1) {
    const home = index % 10 === 0 ? null : (created[index % created.length] as StoredCollection);
    const id = `66f0c0ffee00000000${(0xa00000 + index).toString(16)}`;
    const day = String(1 + (index % 28)).padStart(2, '0');
    const doc = simpleDocument(id, `Note ${index + 1}`, 1, `Size fixture page ${index + 1}.`, `2026-02-${day}T09:00:00Z`, workspaceId, home?.id ?? null);
    fixtures.documents.set(id, { ...doc, sort_key: nextKey(home?.id ?? 'root') });
  }
  for (let index = 0; index < 1500; index += 1) {
    const home = created[(index * 3) % created.length] as StoredCollection;
    fixtures.pdfs.push({ ...pdfRow(10_000 + index, `paper-${index + 1}.pdf`, `Paper ${index + 1}`, at, workspaceId), collection_id: home.id });
  }
  bumpTree(workspaceId);
}

/* ----------------------------------------
   The state, and putting it back
   ---------------------------------------- */

function createFixtures() {
  const documents = seededDocuments();
  return {
    workspaces: seededWorkspaces(),
    /** Who is in each workspace, with which role; the account's own row is its role there. */
    members: seededMembers(),
    /** Invitations by id; the token is kept here only so the mock can find one. */
    invitations: seededInvitations(),
    /** The invitations `POST …/invitations` created, by `Idempotency-Key`, so a replay answers the same one. */
    createdInvitations: new Map<string, { request: string; id: string }>(),
    /** The pending ownership transfer of each workspace that has one. */
    transfers: seededTransfers(),
    /** What `PUT /users/me/last-workspace` last stored; null for an account that never chose. */
    lastWorkspaceId: null as string | null,
    /** The workspaces `POST /workspaces` created, by `Idempotency-Key`, so a replay gets the same one. */
    createdWorkspaces: new Map<string, { name: string; id: string }>(),
    /** The copies `POST …/copy` started, by `Idempotency-Key`, so a replay answers the same job. */
    copies: new Map<string, { request: string; jobId: number }>(),
    documents,
    histories: new Map<string, History>(),
    changeSets: new Map<string, StoredChangeSet[]>([
      [REVIEW_DOCUMENT_ID, [seededChangeSet(documents)]],
      [VIEWER_DOCUMENT_ID, [viewerChangeSet(documents)]],
    ]),
    chats: seededChats(),
    nextMessageId: 100,
    pdfs: seededPdfs(),
    /** The bytes of a PDF uploaded in this session; the seeded ones have metadata only. */
    pdfFiles: new Map<number, Blob>(),
    images: new Map<string, { workspaceId: string; image: ChatImageItem; file: Blob }>(),
    collections: seededCollections(),
    nextCollectionId: 13,
    /** The number in the next created page's id; purged pages leave the map, so its size is not one. */
    nextDocumentNumber: documents.size + 10,
    /** Trash and purge jobs, by id. */
    jobs: new Map<number, StoredJob>(),
    nextJobId: 1,
    /** How long a job takes to report done: long enough in the preview to see its progress. */
    jobDurationMs: 2400,
    agentSettings: structuredClone(agentTools) as AgentSettings,
    engines: seededEngines(),
    profile: {} as Partial<UserProfileModel>,
    /** What a page write answered, by its `Idempotency-Key`, so a replay gets the same answer. */
    idempotency: new Map<string, { request: string; head: DocumentStateResponse; etag: string }>(),
  };
}

export type Fixtures = ReturnType<typeof createFixtures>;

/** The mock API's state. The handlers read and write it; `resetFixtures()` restores it. */
export const fixtures: Fixtures = createFixtures();

export function resetFixtures(): void {
  Object.assign(fixtures, createFixtures());
}
