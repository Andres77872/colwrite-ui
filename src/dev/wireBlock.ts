import type { DocumentContentOutput } from '@/api/schema';

export type WireBlock = NonNullable<DocumentContentOutput['blocks']>[number];
type Json = Record<string, unknown>;
type WireChild = NonNullable<Extract<WireBlock, { type: 'paragraph' }>['children']>[number];

/** A child with the fields its model defaults filled in, as the API serializes it. */
function wireChild(value: Json): WireChild {
  switch (value.type) {
    case 'citation': return { style: 'nlm-citation-sequence-brackets', sources: [], ...value } as unknown as WireChild;
    case 'equation': return { display: false, numbered: false, ...value } as WireChild;
    case 'table': return { header: false, ...value } as WireChild;
    case 'aiBeat': return { collapsed: false, message: '', prompt: '', output: null, ...value } as WireChild;
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
