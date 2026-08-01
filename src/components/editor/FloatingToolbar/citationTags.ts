import type { CitationChild, CitationSource } from '@/editor/types';
import { canonicalDoi } from '@/editor/citations';
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
const CITATION_MARKER = /<\/?citation\b/i;
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
  const key =
    doi ??
    (semanticScholarId ? `S2:${semanticScholarId}` : undefined) ??
    explicitKey ??
    explicitId ??
    arxivId ??
    parsedUrl?.toString();
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
 * Parse the citation tag format produced by the backend citation rewriter.
 *
 * A malformed/unknown citation tag invalidates the structured transform and
 * returns `null`; callers then retain the original response as plain text.
 * Non-citation text is never parsed as HTML.
 */
export function parseCitationSuggestion(text: string): CitationSuggestionPart[] | null {
  const parts: CitationSuggestionPart[] = [];
  let cursor = 0;
  let citations = 0;
  CITATION_TAG.lastIndex = 0;

  for (let match = CITATION_TAG.exec(text); match; match = CITATION_TAG.exec(text)) {
    const before = text.slice(cursor, match.index);
    if (CITATION_MARKER.test(before)) return null;
    if (before) parts.push({ type: 'text', text: before });

    const citation = citationPart(match[1]);
    if (!citation) return null;
    parts.push(citation);
    citations += 1;
    cursor = CITATION_TAG.lastIndex;
  }

  const tail = text.slice(cursor);
  if (CITATION_MARKER.test(tail)) return null;
  if (tail) parts.push({ type: 'text', text: tail });
  return citations > 0 ? parts : null;
}

export type MaterializedCitationSuggestion = {
  fragment: DocumentFragment;
  children: CitationChild[];
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
  const parts = parseCitationSuggestion(text);
  if (!parts) return null;

  const fragment = document.createDocumentFragment();
  const children: CitationChild[] = [];
  for (const part of parts) {
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
  return { fragment, children };
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
