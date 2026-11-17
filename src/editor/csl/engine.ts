import CSL, { type CiteprocCitation, type Engine } from 'citeproc';
import type { CitationStyle, CslItem } from '../types';
import { localeXml, styleXml } from './styleFiles';
import { parseCslEntry, parseCslHtml, type CslNode } from './markup';

/* ----------------------------------------
   The citation processor

   citeproc-js (CPAL-1.0) renders a page's citations and its reference list
   from the CSL-JSON items, in one of the vendored CSL styles. An engine is
   built once per style (building APA or Chicago takes a few hundred
   milliseconds) and reset before each render, which takes a few. This
   module, citeproc and the styles are one chunk, loaded on first need
   (`./processor`); once loaded, rendering is synchronous.
   ---------------------------------------- */

/** One work cited at one point, with the words around it. */
export type CslCiteItem = { id: string; prefix?: string; suffix?: string };
/** One in-text citation: the works it names, in the order it names them. */
export type CslCite = { id: string; items: readonly CslCiteItem[] };

export type CslEntry = {
  /** The item's id, which is the reference's key. */
  id: string;
  /** The style's label in the margin (`[1]`, `1.`), or `null` for an author-date list. */
  marker: string | null;
  body: CslNode[];
};

export type CslRendering = {
  /** Each citation as the style prints it in the text, by its id. */
  citations: ReadonlyMap<string, CslNode[]>;
  /** The reference list, in the style's order. */
  entries: readonly CslEntry[];
  /** The style sets its entries with a hanging indent (APA, Chicago). */
  hangingIndent: boolean;
};

type Session = { engine: Engine; items: ReadonlyMap<string, CslItem> };

const sessions = new Map<CitationStyle, Session>();

function sessionFor(style: CitationStyle): Session {
  const existing = sessions.get(style);
  if (existing) return existing;
  const session = { items: new Map() } as unknown as Session;
  const engine = new CSL.Engine(
    {
      retrieveLocale: (lang) => localeXml(lang),
      // The processor copies what it is given, so the page's records are never changed.
      retrieveItem: (id) => session.items.get(id),
    },
    styleXml(style),
  );
  // A DOI or URL a style prints becomes a link (to http(s) only, by `parseCslHtml`).
  engine.opt.development_extensions.wrap_url_and_doi = true;
  session.engine = engine;
  sessions.set(style, session);
  return session;
}

/**
 * Every citation and the reference list of one page, in one style.
 *
 * `cites` are in reading order, which is what numbers a citation-order
 * style. Every item a cite names must be in `items`.
 */
export function renderCitations(
  style: CitationStyle,
  items: ReadonlyMap<string, CslItem>,
  cites: readonly CslCite[],
): CslRendering {
  if (cites.length === 0) return { citations: new Map(), entries: [], hangingIndent: false };
  const session = sessionFor(style);
  session.items = items;
  session.engine.restoreProcessorState();
  const citations: CiteprocCitation[] = cites.map((cite) => ({
    citationID: cite.id,
    citationItems: cite.items.map((item) => ({
      id: item.id,
      ...(item.prefix ? { prefix: item.prefix } : {}),
      ...(item.suffix ? { suffix: item.suffix } : {}),
    })),
    properties: { noteIndex: 0 },
  }));
  const rendered = session.engine.rebuildProcessorState(citations, 'html');
  const byId = new Map<string, CslNode[]>();
  for (const [id, , html] of rendered) byId.set(id, parseCslHtml(html));

  const bibliography = session.engine.makeBibliography();
  if (!bibliography) return { citations: byId, entries: [], hangingIndent: false };
  const [params, html] = bibliography;
  const entries = html.map((entry, index): CslEntry => ({
    id: params.entry_ids[index]?.[0] ?? '',
    ...parseCslEntry(entry),
  }));
  return { citations: byId, entries, hangingIndent: Boolean(params.hangingindent) };
}
