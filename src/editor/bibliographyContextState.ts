import { createContext, useContext } from 'react';
import { EMPTY_BIBLIOGRAPHY, type Bibliography } from './citations';

export const BibliographyContext = createContext<Bibliography | null>(null);

/**
 * The document's bibliography, built once per block change.
 *
 * Every citation needs the whole document to know its own number, so each of
 * them scanning the blocks itself is quadratic in the number of citations — the
 * cost lands on the widget that a long paper has the most of. One memo above
 * them all, shared by the reference list too, keeps a single answer on screen.
 *
 * Falls back to an empty bibliography rather than throwing: a citation rendered
 * outside an editor (a design-system preview) should degrade to `[?]`, not
 * crash the page around it.
 */
export function useBibliography(): Bibliography {
  return useContext(BibliographyContext) ?? EMPTY_BIBLIOGRAPHY;
}
