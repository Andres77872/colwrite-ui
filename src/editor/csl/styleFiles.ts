import type { CitationStyle } from '../types';
import nlmBrackets from '@/vendor/csl/styles/nlm-citation-sequence-brackets.csl?raw';
import apa from '@/vendor/csl/styles/apa.csl?raw';
import ieee from '@/vendor/csl/styles/ieee.csl?raw';
import ama from '@/vendor/csl/styles/american-medical-association.csl?raw';
import chicagoAuthorDate from '@/vendor/csl/styles/chicago-author-date.csl?raw';
import nlm from '@/vendor/csl/styles/nlm-citation-sequence.csl?raw';
import nature from '@/vendor/csl/styles/nature.csl?raw';
import acm from '@/vendor/csl/styles/association-for-computing-machinery.csl?raw';
import enUS from '@/vendor/csl/locales/locales-en-US.xml?raw';
import enGB from '@/vendor/csl/locales/locales-en-GB.xml?raw';

/* The vendored CSL files (`src/vendor/csl/`, unmodified), for the processor only: in its chunk (`./engine`). */

const STYLE_XML: Record<CitationStyle, string> = {
  'nlm-citation-sequence-brackets': nlmBrackets,
  apa,
  ieee,
  'american-medical-association': ama,
  'chicago-author-date': chicagoAuthorDate,
  'nlm-citation-sequence': nlm,
  nature,
  'association-for-computing-machinery': acm,
};

export function styleXml(id: CitationStyle): string {
  return STYLE_XML[id];
}

const LOCALES: Record<string, string> = { 'en-US': enUS, 'en-GB': enGB };

/** A CSL locale the vendored set holds (`en-US`, `en-GB`); any other falls back to `en-US`. */
export function localeXml(lang: string): string {
  return LOCALES[lang] ?? enUS;
}
