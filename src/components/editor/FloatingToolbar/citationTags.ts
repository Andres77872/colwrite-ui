import type { CitationChild, CitationSource } from '@/editor/types';
import { canonicalCitationKey, canonicalDoi } from '@/editor/citations';
import type { AiAction } from '@/config/aiActions';
import { uid } from '@/lib/uid';

type TextPart = {
  type: 'text';
  text: string;
};

type CitationPart = {
  type: 'citation';
  key: string;
  source: CitationSource;
  locator?: string;
};

export type CitationSuggestionPart = TextPart | CitationPart;

const CITATION_TAG = /<citation\b([^<>]*?)\/>/gi;
/** Any citation-shaped markup, well-formed or not. What must never reach text. */
const CITATION_MARKUP = /<\/?citation\b[^<>]*>?/gi;
const ATTRIBUTE = /([A-Za-z_][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ALLOWED_ATTRIBUTES = new Set([
  'title',
  'authors',
  'page',
  'url',
  'key',
  'id',
  'doi',
  'paper_id',
  'venue',
  'year',
]);

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt);/gi,
    (entity, body: string) => {
      const named: Record<string, string> = {
        amp: '&',
        quot: '"',
        apos: "'",
        lt: '<',
        gt: '>',
      };
      const lower = body.toLocaleLowerCase();
      if (named[lower]) return named[lower];
      const numeric = lower.startsWith('#x')
        ? Number.parseInt(lower.slice(2), 16)
        : Number.parseInt(lower.slice(1), 10);
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0x10ffff) {
        return entity;
      }
      try {
        return String.fromCodePoint(numeric);
      } catch {
        return entity;
      }
    },
  );
}

function parseAttributes(source: string): Record<string, string> | null {
  const attributes: Record<string, string> = {};
  let cursor = 0;
  ATTRIBUTE.lastIndex = 0;
  for (let match = ATTRIBUTE.exec(source); match; match = ATTRIBUTE.exec(source)) {
    if (source.slice(cursor, match.index).trim()) return null;
    const name = match[1].toLocaleLowerCase();
    if (!ALLOWED_ATTRIBUTES.has(name) || name in attributes) return null;
    attributes[name] = decodeXmlEntities(match[2] ?? match[3] ?? '').trim();
    cursor = ATTRIBUTE.lastIndex;
  }
  if (source.slice(cursor).trim()) return null;
  return attributes;
}

function httpUrl(value?: string): URL | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function arxivIdFromUrl(url: URL | null): string | undefined {
  if (!url || !/(^|\.)arxiv\.org$/i.test(url.hostname)) return undefined;
  const match = url.pathname.match(/^\/(?:abs|pdf)\/([^/?#]+)/i);
  return match?.[1]?.replace(/\.pdf$/i, '');
}

function semanticScholarIdFromUrl(url: URL | null): string | undefined {
  if (!url || !/(^|\.)semanticscholar\.org$/i.test(url.hostname)) return undefined;
  const parts = url.pathname.split('/').filter(Boolean);
  return parts.at(-1) || undefined;
}

function citationPart(rawAttributes: string): CitationPart | null {
  const attributes = parseAttributes(rawAttributes);
  if (!attributes?.title) return null;

  const parsedUrl = attributes.url ? httpUrl(attributes.url) : null;
  if (attributes.url && !parsedUrl) return null;

  const explicitKey = attributes.key?.trim();
  const doi =
    canonicalDoi(attributes.doi) ??
    canonicalDoi(explicitKey) ??
    (parsedUrl && /(^|\.)doi\.org$/i.test(parsedUrl.hostname)
      ? canonicalDoi(parsedUrl.toString())
      : undefined);
  const arxivId = arxivIdFromUrl(parsedUrl);
  const semanticScholarId =
    attributes.paper_id || semanticScholarIdFromUrl(parsedUrl);
  const explicitId = attributes.id?.trim();
  // DOI, then arXiv, then the Semantic Scholar id — the order the backend
  // pipeline, the research route and the citation popover all use. This path
  // used to prefer `S2:` over arXiv, so a paper carrying both was keyed one
  // way by the server and another way here, and the reference list showed it
  // twice.
  const key = canonicalCitationKey(
    doi ??
      arxivId ??
      (semanticScholarId ? `S2:${semanticScholarId}` : undefined) ??
      explicitKey ??
      explicitId ??
      parsedUrl?.toString() ??
      '',
  );
  if (!key) return null;

  const provider: CitationSource['provider'] = arxivId
    ? 'arxiv'
    : semanticScholarId
      ? 'semantic_scholar'
      : 'manual';
  const providerId = semanticScholarId ?? explicitId ?? arxivId;
  const year =
    attributes.year?.match(/\d{4}/)?.[0] ??
    attributes.authors?.match(/\((\d{4})\)/)?.[1];
  const externalIds: Record<string, string> = {};
  if (doi) externalIds.DOI = doi;
  if (arxivId) externalIds.ArXiv = arxivId;

  return {
    type: 'citation',
    key,
    locator: attributes.page
      ? /^(?:p|pp)\./i.test(attributes.page)
        ? attributes.page
        : `p. ${attributes.page}`
      : undefined,
    source: {
      key,
      title: attributes.title,
      authors: attributes.authors || undefined,
      year,
      venue:
        attributes.venue ||
        (provider === 'arxiv'
          ? 'arXiv'
          : provider === 'semantic_scholar'
            ? 'Semantic Scholar'
            : undefined),
      url: parsedUrl?.toString(),
      provider,
      providerId,
      doi,
      externalIds: Object.keys(externalIds).length ? externalIds : undefined,
    },
  };
}

/**
 * Remove every citation tag, well-formed or not.
 *
 * The safety net for text that is about to become document content. The
 * rewriter is a model emitting free-form markup, so "this does not parse" is a
 * routine outcome, and the one result that is never acceptable is the author's
 * paragraph acquiring a literal `<citation title="…" />`.
 */
export function stripCitationTags(text: string): string {
  return text.replace(CITATION_MARKUP, '');
}

function citationMarkupCount(text: string): number {
  return text.match(CITATION_MARKUP)?.length ?? 0;
}

export type CitationSuggestion = {
  parts: CitationSuggestionPart[];
  /** Tags that could not be read and were dropped rather than shown. */
  degraded: number;
};

/**
 * Parse the citation tag format produced by the backend citation rewriter.
 *
 * Degradation is per tag. It used to be all-or-nothing: one attribute outside
 * the allowlist discarded every citation in the response, and the caller's
 * fallback then pasted the raw markup into the document. A tag that cannot be
 * read is now dropped on its own and counted in `degraded`, so a rewrite that
 * found six sources and mangled one still delivers five.
 *
 * `null` means nothing readable was found at all. Non-citation text is never
 * parsed as HTML.
 */
export function parseCitationSuggestion(text: string): CitationSuggestion | null {
  const parts: CitationSuggestionPart[] = [];
  let cursor = 0;
  let citations = 0;
  let degraded = 0;

  // Stray markup is stripped rather than kept, and adjacent text is merged so
  // removing a tag does not leave two parts where the author sees one run.
  const pushText = (value: string) => {
    degraded += citationMarkupCount(value);
    const cleaned = stripCitationTags(value);
    if (!cleaned) return;
    const last = parts.at(-1);
    if (last?.type === 'text') last.text += cleaned;
    else parts.push({ type: 'text', text: cleaned });
  };

  CITATION_TAG.lastIndex = 0;
  for (let match = CITATION_TAG.exec(text); match; match = CITATION_TAG.exec(text)) {
    pushText(text.slice(cursor, match.index));

    const citation = citationPart(match[1]);
    if (citation) {
      parts.push(citation);
      citations += 1;
    } else {
      degraded += 1;
    }
    cursor = CITATION_TAG.lastIndex;
  }

  pushText(text.slice(cursor));
  return citations > 0 ? { parts, degraded } : null;
}

export type MaterializedCitationSuggestion = {
  fragment: DocumentFragment;
  children: CitationChild[];
  /** Tags that could not be read and were dropped rather than shown. */
  degraded: number;
};

/**
 * Commit both halves of a structured citation insertion in invariant-safe
 * order. `replaceWith` persists the editable HTML, so every child must already
 * be queued before its placeholder can become visible to editor state.
 */
export function commitMaterializedCitationSuggestion(
  blockId: string,
  materialized: MaterializedCitationSuggestion,
  addParagraphChild: (blockId: string, child: CitationChild) => string,
  replaceWith: (fragment: DocumentFragment) => void,
): void {
  for (const child of materialized.children) addParagraphChild(blockId, child);
  replaceWith(materialized.fragment);
}

/**
 * Build editor placeholders and citation children without ever interpreting
 * model output as HTML.
 */
export function materializeCitationSuggestion(
  text: string,
  idFactory: () => string = uid,
): MaterializedCitationSuggestion | null {
  const parsed = parseCitationSuggestion(text);
  if (!parsed) return null;

  const fragment = document.createDocumentFragment();
  const children: CitationChild[] = [];
  for (const part of parsed.parts) {
    if (part.type === 'text') {
      fragment.append(document.createTextNode(part.text));
      continue;
    }

    const id = idFactory();
    const placeholder = document.createElement('span');
    placeholder.setAttribute('data-child-id', id);
    placeholder.setAttribute('contenteditable', 'false');
    fragment.append(placeholder);
    children.push({
      id,
      type: 'citation',
      keys: [part.key],
      sources: [part.source],
      style: 'numeric',
      ...(part.locator ? { locator: part.locator } : {}),
    });
  }
  return { fragment, children, degraded: parsed.degraded };
}

/** The structured transform is intentionally unavailable to every other AI action. */
export function materializeCitationSuggestionForAction(
  action: AiAction,
  text: string,
  idFactory: () => string = uid,
): MaterializedCitationSuggestion | null {
  return action === 'search-for-references'
    ? materializeCitationSuggestion(text, idFactory)
    : null;
}
