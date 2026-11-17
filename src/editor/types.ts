import type {
  ChangeSetResponse,
  CitationPassage as WireCitationPassage,
  CslItem as WireCslItem,
  DocumentContentInput,
  ReferenceNotice as WireReferenceNotice,
  ReferenceRecordInput,
  ToolActionData,
} from '@/api/schema';

/** A generated draft is self-contained: durable citation keys and records,
 * not handles owned by an ephemeral assistant run. */
export type AssistantOutput = { text: string; sources: ReferenceRecord[] };

// Inline child components that can live inside a paragraph's HTML
export type AiBeatChild = {
  id: string;
  type: 'aiBeat';
  message: string;
  prompt: string;
  output: AssistantOutput | null;
  collapsed?: boolean;
};

export type TableAlign = 'left' | 'center' | 'right';

export type TableChild = {
  id: string;
  type: 'table';
  rows: number;
  cols: number;
  data: string[][]; // rows x cols
  header?: boolean; // first row as header
  /** Per-column alignment; a missing entry means left. */
  align?: TableAlign[];
  /** Figure caption rendered under the table. */
  caption?: string;
};

/* ----------------------------------------
   References (`ColWrite-api/docs/citations.md#the-data`)

   A reference is a CSL-JSON item with ColWrite's fields beside it, never
   inside it, so the item goes to the citation processor as it is. The
   editor holds the API's `ReferenceRecord` with absent fields left out
   rather than `null`; `src/api/content.ts` converts.
   ---------------------------------------- */

/** A CSL name: a family and given name, or a literal one (an organisation). */
export type CslName = {
  family?: string;
  given?: string;
  literal?: string;
  suffix?: string;
  'dropping-particle'?: string;
  'non-dropping-particle'?: string;
};
/** A CSL date: one or two `date-parts` (a range), or a literal. */
export type CslDate = { 'date-parts'?: number[][]; literal?: string; raw?: string };
/** CSL 1.0.2's item types. */
export type CslType = WireCslItem['type'];
/** The CSL 1.0.2 item, with the variables ColWrite keeps. `id` is the reference's key. */
export type CslItem = {
  id: string;
  type: CslType;
  title: string;
  'title-short'?: string;
  author?: CslName[];
  editor?: CslName[];
  issued?: CslDate;
  accessed?: CslDate;
  'container-title'?: string;
  'collection-title'?: string;
  'event-title'?: string;
  publisher?: string;
  'publisher-place'?: string;
  volume?: string;
  issue?: string;
  page?: string;
  number?: string;
  edition?: string;
  genre?: string;
  medium?: string;
  language?: string;
  note?: string;
  /** Bare and lower-cased. */
  DOI?: string;
  URL?: string;
  ISBN?: string;
  ISSN?: string;
  PMID?: string;
  PMCID?: string;
};
export type ReferenceKind = ReferenceRecordInput['kind'];
/** Where the record came from; `manual` is typed or imported by the author, and unverified. */
export type ReferenceProvider = ReferenceRecordInput['provider'];
/**
 * 09 §5: `verified` (resolved, and a second source agrees), `needs_review`
 * (fields differ, named in `differs`, or one registry has it), `not_found`
 * (no registry returned it), `unchecked` (never looked up).
 */
export type ReferenceState = ReferenceRecordInput['state'];
export type ReferenceFlag = ReferenceRecordInput['flags'][number];
/** A registry's update record about the work: a retraction, a correction. */
export type ReferenceNotice = {
  type: WireReferenceNotice['type'];
  date?: string;
  doi?: string;
  url?: string;
  source?: string;
};
/**
 * One work as the page's library, a citation, a conversation's evidence
 * store and the paper routes hold it. `key` is its identity (`doi:…`,
 * `arxiv:…`, `pmid:…`, `pmcid:…`, `openalex:W…`, `s2:…`, `corpusid:…`,
 * `url:…`, `resource:<id>`, `page:<id>`, or a key the author typed), and
 * `csl.id` repeats it.
 */
export type ReferenceRecord = {
  key: string;
  kind: ReferenceKind;
  provider: ReferenceProvider;
  state: ReferenceState;
  flags: ReferenceFlag[];
  /** The day (YYYY-MM-DD) it was last checked against the registries. */
  checked?: string;
  /** The CSL variables a second source disagreed on (`needs_review`). */
  differs?: string[];
  notices?: ReferenceNotice[];
  /** The version of record's DOI, for a preprint that has one. */
  published_doi?: string;
  csl: CslItem;
};

/** A CSL style id: the API's short list (`CitationStyle` in its domain model). */
export type CitationStyle = NonNullable<DocumentContentInput['citationStyle']>;

/**
 * The passage a citation's claim rests on (09 §4, step 6): `S3.2` in the
 * conversation `chat_id`, with how much of the work the server held.
 */
export type CitationPassage = {
  id: string;
  level: WireCitationPassage['level'];
  chat_id?: string;
};

export type CitationChild = {
  id: string;
  type: 'citation';
  /** The works cited, by reference key. */
  keys: string[];
  /** The page's `citationStyle`, when set, overrides it. */
  style?: CitationStyle;
  prefix?: string;                   // e.g., 'see', 'cf.'
  suffix?: string;                   // e.g., 'ch. 2', 'pp. 21–24'
  locator?: string;                  // page/section locator
  /** A copy of each cited work's reference; the library's record wins over it. */
  sources?: ReferenceRecord[];
  /** The passage the claim rests on; absent is "passage not recorded". */
  passage?: CitationPassage;
};

export type EquationChild = {
  id: string;
  type: 'equation';
  latex: string;               // LaTeX math without $ delimiters
  /** Render on its own centred line rather than in the run of text. */
  display?: boolean;
  numbered?: boolean;          // display equations only
  labelId?: string;            // optional anchor for cross-references
};

// Inline graph widget for small charts embedded in text
export type GraphChild = {
  id: string;
  type: 'graph';
  kind: 'bar' | 'line' | 'area' | 'pie';
  data: {
    values: number[];
    labels?: string[];
    colors?: string[];
  };
  title?: string;
  caption?: string;
  xLabel?: string;
  yLabel?: string;
};

export type ParagraphChild = AiBeatChild | TableChild | CitationChild | EquationChild | GraphChild;

// Common optional metadata for AI/UI behavior
type BlockMeta = {
  aiHidden?: boolean; // If true, hide this block from AI assistant
  locked?: boolean;   // If true, assistant should not modify this block
  collapsed?: boolean; // If true, collapse this block in the editor UI
};

/**
 * How a paragraph presents its text. Absent is plain body text.
 *
 * A role, not a separate block type: a list item or a quote is still prose
 * that can hold citations and equations, so every one of them keeps the
 * paragraph's html/children machinery and differs only in how it is drawn
 * and exported. Mirrors `ParagraphVariant` in the API's canonical model.
 */
export type ParagraphVariant = 'bullet' | 'numbered' | 'todo' | 'quote' | 'callout';

/** The name a page gets when it has none, here and on the server. Lists and exports show it. */
export const DEFAULT_DOCUMENT_TITLE = 'Untitled page';

/** Deepest list nesting the canonical model accepts (0 is top level). */
export const MAX_BLOCK_INDENT = 4;

export type ParagraphBlock = {
  id: string;
  type: 'paragraph';
  html: string;
  children?: ParagraphChild[];
  columns?: number;
  variant?: ParagraphVariant;
  /** To-do state. Only valid — and only ever sent — on `variant: 'todo'`. */
  checked?: boolean;
  /** Outline depth for list items. Omitted at the top level. */
  indent?: number;
} & BlockMeta;
export type HeadingBlock = { id: string; type: 'heading'; level: 1 | 2 | 3; html: string; instructions?: string } & BlockMeta;
export type DividerBlock = { id: string; type: 'divider' } & BlockMeta;
/**
 * Preformatted text: source code, pseudocode, program output. `text` is plain
 * text, never html — whitespace is significant and nothing in it is markup.
 */
export type CodeBlock = { id: string; type: 'code'; text: string; language?: string } & BlockMeta;

export type ImageBlock = {
  id: string;
  type: 'image';
  assetId: string;
  alt: string;
  caption?: string;
  width?: number;
  label?: string;
  /** The API always derives this from the asset, never from authored text. */
  origin: { kind: 'upload' } | { kind: 'generated'; generationId: string };
} & BlockMeta;

export type Block = ParagraphBlock | HeadingBlock | DividerBlock | CodeBlock | ImageBlock;
export type BlockType = Block['type'];
export type Doc = {
  blocks: Block[];
  name?: string;
  /**
   * The document's source library: every work it cites or keeps for later,
   * one entry per key. Its metadata wins over the copies citations carry.
   * Absent on documents that have none.
   */
  sources?: ReferenceRecord[];
  /** The document's CSL style; absent means "whatever its citations use". */
  citationStyle?: CitationStyle;
  instructions?: string;
  documentType?: NonNullable<DocumentContentInput['documentType']>;
};

// ── ToolAction types for agentic document tools (Phase 3) ──

/**
 * Where `write_blocks` puts its blocks: before or after `blockId`, in its
 * place (the first block keeps its id), or at the end of the page.
 */
export type WritePosition = 'before' | 'after' | 'replace' | 'append';

/**
 * What a stored operation rests on, and what the server noticed about it
 * (`ColWrite-api/docs/document-history-api.md#how-a-change-set-stores-its-operations`).
 * `basis` is `["author"]` (it only rewords the author's text) or the
 * citation keys of the sources it draws on; `newInformation` is set when it
 * adds a number, a source or words the page does not hold with no basis to
 * show for them.
 */
export type OperationBasis = { basis?: string[]; newInformation?: boolean };

/**
 * One operation of a stored change set, in the editor's shape: the seven of
 * the API's operation vocabulary, with the stored form's blocks (complete,
 * as the page will hold them), plus the `create_document` a `doc_create`
 * action announces. Accepting one applies exactly this, as an edit.
 */
export type ToolOperation = OperationBasis & (
  /** One exact run of a block's text replaced; `block` is the whole block after it. */
  | { op: 'replace_text'; blockId: string; find: string; replace: string; block: Record<string, unknown> }
  /** `blockId` is `null` exactly for `append`. */
  | { op: 'write_blocks'; position: WritePosition; blockId: string | null; blocks: Record<string, unknown>[] }
  | { op: 'delete_blocks'; blockIds: string[] }
  | { op: 'move_block'; blockId: string; position: 'before' | 'after'; targetBlockId: string }
  | { op: 'set_meta'; name?: string; citationStyle?: CitationStyle }
  /** Library records the server filled in, added without citing them. */
  | { op: 'add_sources'; sources: ReferenceRecord[] }
  /** Library entries removed, by key; one cited on the page cannot go. */
  | { op: 'remove_sources'; keys: string[] }
  /**
   * Library records replaced with newer ones, by key (the reference audit's
   * refresh: a retraction since, a state the registries now give
   * otherwise). Each key is in the library already.
   */
  | { op: 'update_sources'; sources: ReferenceRecord[] }
  | { op: 'create_document'; documentId: string }
);

/** Outcome of a single operation inside a `doc_edit` call. */
export type ToolOperationResult = {
  op: string;
  status: 'applied' | 'skipped' | 'error';
  message?: string;
};

/**
 * Who accepts a stored change set (D18): `review`, the author; `auto`, the
 * open editor at once, while the author has Auto on. The server decides it
 * per run.
 */
export type ApplyPolicy = ChangeSetResponse['apply_policy'];
/** Why a run that asked for Auto was given `review`. */
export type AutoBlockedReason = NonNullable<ChangeSetResponse['auto_blocked_reason']>;

export type ToolAction = {
  tool: string;
  toolCallId: string;
  actions: ToolOperation[];
  documentId: string;
  /**
   * `proposed` — a stored change set (`changeSetId`) for the author to
   * review; storage is unchanged.
   * `applied` — a page `doc_create` made, announced by its
   * `create_document` operation. `doc_edit` never commits by itself.
   */
  status: ToolActionData['status'];
  /** The stored set's policy; `null` when the action stores no set. */
  applyPolicy?: ApplyPolicy | null;
  autoBlockedReason?: AutoBlockedReason | null;
  message?: string;
  /**
   * Per-operation outcomes from the server. A batch can succeed overall while
   * individual operations are skipped or fail; without these the assistant
   * reported such a batch as a clean success.
   */
  operationResults?: ToolOperationResult[];
  /**
   * The change set a `proposed` action stored. The stream carries no
   * operations for it: they are read by this id, and each decision is
   * recorded against it.
   */
  changeSetId?: string | null;
  /** Operation count from the redacted proposal preview, for reporting. */
  proposalOperationCount?: number;
  /**
   * Where a page `doc_create` made lives: its source page's collection, or
   * `null` for the top level. The pages tree refreshes that branch.
   */
  collectionId?: number | null;
};
