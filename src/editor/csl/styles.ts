import type { CitationStyle } from '../types';
import sources from '@/vendor/csl/SOURCES.json';

/* ----------------------------------------
   The citation styles a page can use (tooling plan 09 §9)

   Exactly the API's short list of CSL style ids. Each renders with its CSL
   file from the Citation Style Language project, vendored unmodified with its
   licence and authors by `scripts/vendor-csl.mjs` (`src/vendor/csl/`,
   `SOURCES.json` records the repository, commit and hash of each). A style's
   id is its file's name in the CSL repository; `name` is what the picker
   shows.
   ---------------------------------------- */

export type CitationStyleInfo = {
  id: CitationStyle;
  /** What the picker shows. */
  name: string;
  /** The style's own title, from its CSL file. */
  cslTitle: string;
  /** How an in-text citation looks in it. */
  example: string;
  /** How its reference list is ordered, for the note under the list. */
  order: 'citation' | 'author';
};

const TITLES = new Map(sources.files.map((file) => [file.path, file.title ?? '']));
const titleOf = (id: CitationStyle) => TITLES.get(`styles/${id}.csl`) ?? id;

const style = (id: CitationStyle, name: string, example: string, order: CitationStyleInfo['order']): CitationStyleInfo => ({
  id,
  name,
  cslTitle: titleOf(id),
  example,
  order,
});

/** In the order the picker offers them. */
export const CITATION_STYLES: readonly CitationStyleInfo[] = [
  style('nlm-citation-sequence-brackets', 'Vancouver (brackets)', '[1–3]', 'citation'),
  style('nlm-citation-sequence', 'Vancouver', '(1–3)', 'citation'),
  style('ieee', 'IEEE', '[1], [2]', 'citation'),
  style('apa', 'APA 7th edition', '(Smith, 2020)', 'author'),
  style('chicago-author-date', 'Chicago author-date', '(Smith 2020)', 'author'),
  style('american-medical-association', 'AMA 11th edition', '¹⁻³', 'citation'),
  style('nature', 'Nature', '¹⁻³', 'citation'),
  style('association-for-computing-machinery', 'ACM', '[1, 2]', 'author'),
];

/** What a citation the page has no style for is written in (the API's default). */
export const DEFAULT_CITATION_STYLE: CitationStyle = 'nlm-citation-sequence-brackets';

const BY_ID = new Map(CITATION_STYLES.map((info) => [info.id, info]));

export function citationStyleInfo(id: CitationStyle): CitationStyleInfo {
  return BY_ID.get(id) ?? (BY_ID.get(DEFAULT_CITATION_STYLE) as CitationStyleInfo);
}

/** Whether a value is one of the page's style ids. */
export function isCitationStyle(value: unknown): value is CitationStyle {
  return typeof value === 'string' && BY_ID.has(value as CitationStyle);
}

/**
 * What the style picker credits (09 §9, decision #8 of 17): the processor,
 * taken under the CPAL-1.0 with its attribution notice, and the CSL project,
 * whose styles are CC BY-SA 3.0 and ship unmodified.
 */
export const CITATION_CREDITS = {
  citeproc: {
    notice: 'Citations are formatted by citeproc-js, copyright © 2009–2019 Frank Bennett, used under the Common Public Attribution License 1.0 (CPAL-1.0).',
    source: 'https://github.com/Juris-M/citeproc-js',
    license: 'https://opensource.org/license/cpal_1-0',
  },
  csl: {
    notice: 'Styles from the Citation Style Language project, unmodified, under CC BY-SA 3.0.',
    link: 'https://citationstyles.org/',
    license: 'https://creativecommons.org/licenses/by-sa/3.0/',
  },
} as const;
