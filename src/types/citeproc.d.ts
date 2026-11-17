/**
 * The part of citeproc-js (`citeproc`, CPAL-1.0) the citation renderer uses.
 * The package ships no types; see https://citeproc-js.readthedocs.io.
 */
declare module 'citeproc' {
  export type CiteprocSys = {
    retrieveLocale: (lang: string) => string | null | undefined;
    retrieveItem: (id: string) => unknown;
  };
  export type CiteprocCitationItem = { id: string; prefix?: string; suffix?: string; locator?: string; label?: string };
  export type CiteprocCitation = {
    citationID: string;
    citationItems: CiteprocCitationItem[];
    properties: { noteIndex: number };
  };
  export type CiteprocBibliographyParams = {
    entry_ids: string[][];
    'second-field-align': string | false;
    hangingindent?: boolean | number;
    bibliography_errors: unknown[];
  };
  export class Engine {
    constructor(sys: CiteprocSys, style: string, lang?: string, forceLang?: boolean);
    opt: { development_extensions: Record<string, boolean> };
    restoreProcessorState(citations?: CiteprocCitation[]): unknown;
    rebuildProcessorState(citations: CiteprocCitation[], mode?: 'html' | 'text', uncited?: string[]): Array<[string, number, string]>;
    makeBibliography(): [CiteprocBibliographyParams, string[]] | false;
  }
  const CSL: { Engine: typeof Engine; PROCESSOR_VERSION: string };
  export default CSL;
}
