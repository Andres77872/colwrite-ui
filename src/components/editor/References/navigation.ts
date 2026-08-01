import { referenceAnchorId, type BibliographyEntry, type CitationUsage } from '@/editor';
import { revealElement, revealSelector } from '@/lib/reveal';

/**
 * Both halves of the citation ↔ reference link, so the two components that
 * navigate between them agree on what they are looking for.
 *
 * Citations are found through the paragraph's placeholder rather than an `id`
 * of their own: the placeholder span is the one node that survives the
 * contenteditable being reserialized, and its `data-child-id` is already the
 * editor's identity for the widget.
 */

function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** Scroll to and flash the citation that a reference is cited from. */
export function revealCitationUsage(usage: Pick<CitationUsage, 'childId' | 'blockId'>): boolean {
  const placeholder = `[data-child-id="${escapeAttributeValue(usage.childId)}"]`;
  return (
    // The pill inside is the focusable part; the placeholder itself is not.
    revealSelector(`${placeholder} button`) ||
    revealSelector(placeholder) ||
    // A collapsed block renders a summary button instead of its prose, so the
    // citation has no node at all. Landing on the block is still an answer to
    // "where is this cited?", and the row it lands on is what expands it.
    revealSelector(`[data-block-id="${escapeAttributeValue(usage.blockId)}"]`)
  );
}

/** Scroll to and flash a row of the reference list. */
export function revealReferenceEntry(entry: Pick<BibliographyEntry, 'number'>): boolean {
  if (typeof document === 'undefined') return false;
  return revealElement(document.getElementById(referenceAnchorId(entry)));
}
