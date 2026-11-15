import type { Block, CitationSource, Doc, ParagraphChild } from './types';
import { clampIndent, continuationOf, convertBlock, isListItem } from './blockKinds';
import { canonicalCitationKey } from './citations';
import { placeholderIds, withoutOrphanChildren } from './docOps';
import { uid } from '../lib/uid';
import type { BlockActions } from './editorContextState';

/**
 * An empty block of the given type.
 *
 * The same three-way expression was written out in each insertion helper, so a
 * new block type — or a change to a paragraph's defaults — had to be made in
 * every one of them or the block came out shaped differently depending on
 * which affordance created it.
 */
function blankBlock(id: string, type: Block['type']): Block {
  if (type === 'paragraph') return { id, type: 'paragraph', html: '', children: [], columns: 1 };
  if (type === 'heading') return { id, type: 'heading', level: 2, html: '' };
  if (type === 'code') return { id, type: 'code', text: '' };
  return { id, type: 'divider' };
}

/**
 * A copy of `block` under a new id, safe to sit next to the original.
 *
 * Inline widget ids get fresh values as well (with their placeholders
 * rewritten), and an equation's cross-reference label is dropped: labels are
 * unique across the document and the export rejects a duplicate.
 */
function duplicateOf(block: Block, id: string): Block {
  const copy = structuredClone(block) as Block;
  copy.id = id;
  if (copy.type !== 'paragraph' || !copy.children?.length) return copy;
  let html = copy.html;
  copy.children = copy.children.map((child) => {
    const childId = uid();
    html = html.split(`data-child-id="${child.id}"`).join(`data-child-id="${childId}"`);
    const next = { ...child, id: childId } as ParagraphChild;
    if (next.type === 'equation') delete next.labelId;
    return next;
  });
  copy.html = html;
  return copy;
}

/**
 * Every edit of the body's blocks and library, written against the session's
 * `editDoc`. Each one is an edit: it arms autosave and is journaled for undo
 * (`coalesceKey` merges a typing burst into one step).
 *
 * Built once per editor: the functions close over `editDoc` and `readDoc`
 * only, so they never change identity and an actions-only consumer does not
 * re-render on a keystroke.
 */
export function createBlockActions(
  editDoc: (updater: (prev: Doc) => Doc, coalesceKey?: string | null) => void,
  readDoc: () => Doc,
): BlockActions {
  const setBlocks = (updater: (prev: Block[]) => Block[], coalesceKey?: string) =>
    editDoc(d => ({ ...d, blocks: updater(d.blocks) }), coalesceKey ?? null);

  const setDocMeta = (meta: Partial<Doc>) => editDoc(prev => ({ ...prev, ...meta }));

  const insertAt = (index: (prev: Block[]) => number, type: Block['type']): string => {
    const newId = uid();
    setBlocks(prev => {
      const out = [...prev];
      out.splice(index(prev), 0, blankBlock(newId, type));
      return out;
    });
    return newId;
  };

  // Generic helper to toggle a boolean meta key on any block
  const toggleMeta = (id: string, key: 'aiHidden' | 'locked' | 'collapsed') => setBlocks(prev => prev.map(b => (
    b.id === id ? ({ ...b, [key]: !(b[key] ?? false) }) : b
  )));

  return {
    setDocMeta,
    setDocName: (name: string) => setDocMeta({ name }),

    addBlockAtStart: (type) => insertAt(() => 0, type),
    addBlockAfter: (afterId, type) => insertAt(prev => prev.findIndex(b => b.id === afterId) + 1, type),
    /**
     * Insert above a given block.
     *
     * The gutter menu could only ever insert below, so nothing could be put in
     * front of the first block: `addBlockAtStart` reached the same place but was
     * surfaced only on the empty-document screen.
     */
    addBlockBefore: (beforeId, type) => insertAt(prev => {
      const idx = prev.findIndex(b => b.id === beforeId);
      return idx === -1 ? 0 : idx;
    }, type),

    // --- Exact placement helpers (preserve provided id and full block data) ---
    insertBlockAtStartExact: (block) => setBlocks(prev => [block, ...prev]),
    appendBlockExact: (block) => setBlocks(prev => [...prev, block]),
    insertBlockAfterExact: (afterId, block) => setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === afterId);
      const out = [...prev];
      if (idx === -1) out.push(block);
      else out.splice(idx + 1, 0, block);
      return out;
    }),
    insertBlockBeforeExact: (beforeId, block) => setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === beforeId);
      const out = [...prev];
      if (idx === -1) out.unshift(block);
      else out.splice(idx, 0, block);
      return out;
    }),

    moveBlock: (id, dir) => setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      if (idx < 0) return prev;
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const out = [...prev];
      const [blk] = out.splice(idx, 1);
      if (!blk) return prev;
      out.splice(j, 0, blk);
      return out;
    }),

    /**
     * Split a text block at the caret (Enter): `beforeHtml` stays in the block,
     * `afterHtml` becomes a new paragraph below it. Inline widgets travel with
     * whichever half holds their placeholder span.
     */
    splitBlock: (id, beforeHtml, afterHtml) => {
      const newId = uid();
      setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === id && 'html' in b);
        const b = prev[idx];
        if (!b) return prev;
        const children = b.type === 'paragraph' ? b.children ?? [] : [];
        const afterIds = placeholderIds(afterHtml);
        const before: Block = (b.type === 'paragraph'
          ? withoutOrphanChildren({
              ...b,
              html: beforeHtml,
              children: children.filter(c => !afterIds.has(c.id)),
            } as Block)
          : ({ ...b, html: beforeHtml } as Block));
        // A new line under a list item continues the list at its depth; after
        // anything else it is body text.
        const continuation = continuationOf(b, newId, afterHtml);
        const after = withoutOrphanChildren({
          ...continuation,
          children: children.filter(c => afterIds.has(c.id)),
          columns: b.type === 'paragraph' && !isListItem(b) ? b.columns ?? 1 : 1,
        } as Block);
        const out = [...prev];
        out.splice(idx, 1, before, after);
        return out;
      });
      return newId;
    },

    /**
     * Merge a block into the one above it (Backspace at the start of a block).
     * Returns the surviving block id and the caret's text offset at the
     * junction, or null when there is nothing to merge with.
     */
    mergeWithPrevious: (id) => {
      const list = readDoc().blocks;
      const idx = list.findIndex(b => b.id === id);
      const current = list[idx];
      const prev = list[idx - 1];
      if (!current || !prev) return null;
      if (current.type !== 'paragraph' && current.type !== 'heading') return null;
      // A locked block above is protected from being merged into, and a code
      // block holds plain text that inline html cannot be folded into.
      if (prev.locked || prev.type === 'code') return null;
      if (prev.type === 'divider') {
        // The block after a divider backspaces the divider away rather than
        // into it — a divider has no text to merge with.
        setBlocks(blocks => blocks.filter(b => b.id !== prev.id));
        return { targetId: id, caretOffset: 0 };
      }
      if (prev.type === 'heading' && current.type === 'paragraph' && (current.children ?? []).length > 0) {
        // A heading does not render children; merging a widget-bearing
        // paragraph into it would orphan the widgets' placeholders.
        return null;
      }
      // Text length of the survivor's own content: where the caret belongs.
      const caretOffset = prev.html.replace(/<[^>]*>/g, '').length;
      const mergedHtml = prev.html + current.html;
      const merged: Block = prev.type === 'paragraph'
        ? {
            ...prev,
            html: mergedHtml,
            children: [
              ...(prev.children ?? []),
              ...(current.type === 'paragraph' ? current.children ?? [] : []),
            ],
          }
        : ({ ...prev, html: mergedHtml } as Block);
      setBlocks(blocks => {
        const i = blocks.findIndex(b => b.id === id);
        if (i <= 0) return blocks;
        const out = [...blocks];
        out.splice(i - 1, 2, merged);
        return out;
      });
      return { targetId: prev.id, caretOffset };
    },

    reorderBlock: (id, toIndex) => setBlocks(prev => {
      const fromIndex = prev.findIndex(b => b.id === id);
      if (fromIndex < 0) return prev;
      const out = [...prev];
      const [blk] = out.splice(fromIndex, 1);
      if (!blk) return prev;
      const clamped = Math.max(0, Math.min(toIndex, out.length));
      out.splice(clamped, 0, blk);
      return out;
    }),

    removeBlock: (id) => setBlocks(prev => prev.filter(b => b.id !== id)),

    updateHtml: (id, html) => setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id && 'html' in b);
      const b = prev[idx];
      if (!b || (b.type !== 'paragraph' && b.type !== 'heading')) return prev;
      if (b.html === html) return prev;
      const out = prev.slice();
      // Deleting an inline widget removes its placeholder span from the html but
      // left the child in `children`. That orphan is invisible in the editor and
      // used to make every subsequent AI edit of the document fail validation.
      out[idx] = withoutOrphanChildren({ ...b, html } as Block);
      return out;
    }, `html:${id}`),

    setParagraphColumns: (id, columns) => setBlocks(prev => prev.map(b => (
      b.id === id && b.type === 'paragraph'
        ? ({ ...b, columns: Math.max(1, Math.min(6, Math.floor(columns || 1))) })
        : b
    ))),

    toggleAiHidden: (id) => toggleMeta(id, 'aiHidden'),
    toggleLocked: (id) => toggleMeta(id, 'locked'),
    toggleCollapsed: (id) => toggleMeta(id, 'collapsed'),

    addParagraphChild: (blockId, child) => {
      setBlocks(prev => prev.map(b => {
        if (b.id !== blockId || b.type !== 'paragraph') return b;
        const children = Array.isArray(b.children) ? b.children.slice() : [];
        const exists = children.find(c => c.id === child.id);
        if (!exists) children.push(child);
        return { ...b, children } as Block;
        // The html write that places the widget joins this step (see `journal`).
      }), `child:${blockId}`);
      return child.id;
    },

    updateParagraphChild: (blockId, childId, next) => setBlocks(prev => {
      const bIndex = prev.findIndex(b => b.id === blockId && b.type === 'paragraph');
      const blk = prev[bIndex];
      if (blk?.type !== 'paragraph') return prev;
      const children: ParagraphChild[] = Array.isArray(blk.children) ? blk.children : [];
      const cIndex = children.findIndex((c: ParagraphChild) => c.id === childId);
      const cur = children[cIndex];
      if (!cur) return prev;
      const merged: ParagraphChild = { ...cur, ...next } as ParagraphChild;
      const equal = JSON.stringify(cur) === JSON.stringify(merged);
      if (equal) return prev;
      const nextChildren = children.slice();
      nextChildren[cIndex] = merged;
      const out = prev.slice();
      out[bIndex] = { ...blk, children: nextChildren } as Block;
      return out;
    }),

    removeParagraphChild: (blockId, childId) => setBlocks(prev => prev.map(b => {
      if (b.id !== blockId || b.type !== 'paragraph') return b;
      const existing = b.children || [];
      const filtered = existing.filter(c => c.id !== childId);
      if (filtered.length === existing.length) return b;
      return { ...b, children: filtered };
    })),

    setHeadingLevel: (id, level) => setBlocks(prev => prev.map(b => (
      b.id === id && b.type === 'heading' ? ({ ...b, level }) : b
    ))),

    /**
     * Turn a block into another kind in place ("Turn into", markdown shortcuts).
     *
     * `html` replaces the text in the same step — a markdown shortcut removes
     * the `## ` it was typed as — so the conversion is one undo entry rather
     * than an edit followed by a conversion.
     */
    setBlockKind: (id, kind, options) => setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      let source = prev[idx];
      if (!source || source.locked) return prev;
      if (options?.html !== undefined && (source.type === 'paragraph' || source.type === 'heading')) {
        source = withoutOrphanChildren({ ...source, html: options.html } as Block);
      }
      const out = prev.slice();
      out[idx] = convertBlock(source, kind);
      return out;
    }),

    getBlock: (id) => readDoc().blocks.find(b => b.id === id),

    /**
     * Block order at call time, for event handlers that need it without
     * subscribing to `blocks` (an editable's arrow-key neighbour walk).
     */
    getBlockIds: () => readDoc().blocks.map(b => b.id),

    /**
     * Add sources to the document's library, or refresh ones already there.
     *
     * Matched by canonical key, so a DOI written two ways is one entry. An
     * incoming record's non-empty fields replace the stored ones — this is
     * how "Add to library" upgrades an entry typed by hand — while fields it
     * lacks are kept.
     */
    upsertSources: (incoming: readonly CitationSource[]) => {
      if (incoming.length === 0) return;
      editDoc(prev => {
        const library = [...(prev.sources ?? [])];
        const index = new Map(library.map((source, i) => [canonicalCitationKey(source.key), i]));
        for (const source of incoming) {
          const key = canonicalCitationKey(source.key);
          if (!key) continue;
          const clean = Object.fromEntries(
            Object.entries(source).filter(([, value]) => value !== undefined && value !== null && value !== ''),
          ) as CitationSource;
          const at = index.get(key);
          const existing = at === undefined ? undefined : library[at];
          if (at === undefined || !existing) {
            index.set(key, library.length);
            library.push({ ...clean, key: source.key });
          } else {
            library[at] = { ...existing, ...clean, key: existing.key };
          }
        }
        return { ...prev, sources: library };
      });
    },

    /** Edit one library entry; an emptied field is removed. */
    updateSource: (key, patch) => {
      const target = canonicalCitationKey(key);
      editDoc(prev => {
        const library = prev.sources ?? [];
        const at = library.findIndex(source => canonicalCitationKey(source.key) === target);
        const existing = library[at];
        if (!existing) return prev;
        const next = { ...existing, ...patch, key: existing.key } as Record<string, unknown>;
        for (const [field, value] of Object.entries(next)) {
          if (value === undefined || value === null || value === '') delete next[field];
        }
        const out = library.slice();
        out[at] = next as CitationSource;
        return { ...prev, sources: out };
      });
    },

    /** Drop an entry from the library. Citations keep their own copy of it. */
    removeSource: (key) => {
      const target = canonicalCitationKey(key);
      editDoc(prev => {
        const library = prev.sources ?? [];
        const out = library.filter(source => canonicalCitationKey(source.key) !== target);
        if (out.length === library.length) return prev;
        const { sources: _sources, ...rest } = prev;
        return out.length ? { ...prev, sources: out } : rest;
      });
    },

    setCitationStyle: (style) => {
      editDoc(prev => {
        if ((prev.citationStyle ?? null) === style) return prev;
        const { citationStyle: _style, ...rest } = prev;
        return style ? { ...rest, citationStyle: style } : rest;
      });
    },

    setChecked: (id, checked) => setBlocks(prev => prev.map(b => (
      b.id === id && b.type === 'paragraph' && b.variant === 'todo' && !b.locked
        ? { ...b, checked }
        : b
    ))),

    /**
     * Nest or un-nest a list item (Tab / Shift+Tab).
     *
     * An item can sit at most one level deeper than the item above it, the way
     * an outline works: indenting the first item of a list would otherwise
     * produce a sub-list with no parent. Returns whether anything changed, so
     * the key handler knows whether it consumed the key.
     */
    indentBlock: (id, delta) => {
      const list = readDoc().blocks;
      const idx = list.findIndex(b => b.id === id);
      const block = list[idx];
      if (!block || block.type !== 'paragraph' || !isListItem(block) || block.locked) return false;
      const current = block.indent ?? 0;
      const above = list[idx - 1];
      const ceiling = above && above.type === 'paragraph' && isListItem(above) ? (above.indent ?? 0) + 1 : 0;
      const next = delta > 0 ? Math.min(clampIndent(current + 1), ceiling) : clampIndent(current - 1);
      if (next === current) return false;
      setBlocks(prev => prev.map(b => {
        if (b.id !== id || b.type !== 'paragraph') return b;
        const { indent: _indent, ...rest } = b;
        return next > 0 ? { ...rest, indent: next } : rest;
      }));
      return true;
    },

    updateCodeText: (id, text) => setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      const b = prev[idx];
      if (!b || b.type !== 'code' || b.text === text) return prev;
      const out = prev.slice();
      out[idx] = { ...b, text };
      return out;
    }, `code:${id}`),

    setCodeLanguage: (id, language) => setBlocks(prev => prev.map(b => {
      if (b.id !== id || b.type !== 'code') return b;
      const { language: _language, ...rest } = b;
      return language ? { ...rest, language } : rest;
    })),

    duplicateBlock: (id) => {
      const source = readDoc().blocks.find(b => b.id === id);
      if (!source) return null;
      const newId = uid();
      const copy = duplicateOf(source, newId);
      setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === id);
        if (idx === -1) return prev;
        const out = prev.slice();
        out.splice(idx + 1, 0, copy);
        return out;
      });
      return newId;
    },

    /**
     * Swap blocks for others in one undo step — an AI result replacing the
     * passage it rewrote. The new blocks land where the first replaced block
     * stood. Locked blocks are never removed: they stay, after the new ones.
     * Returns the inserted ids.
     */
    replaceBlocks: (ids, incoming) => {
      const doomed = new Set(ids);
      const taken = new Set(readDoc().blocks.filter(b => !doomed.has(b.id)).map(b => b.id));
      const fresh = incoming.map(block => (taken.has(block.id) ? duplicateOf(block, uid()) : block));
      setBlocks(prev => {
        const first = prev.findIndex(b => doomed.has(b.id));
        if (first === -1) return fresh.length ? [...prev, ...fresh] : prev;
        // Everything before `first` survives, so it is also the insertion
        // index once the replaced blocks are gone.
        const out = prev.filter(b => !doomed.has(b.id) || b.locked);
        out.splice(first, 0, ...fresh);
        return out;
      });
      return fresh.map(block => block.id);
    },

    /** Remove several blocks as one undo step, skipping locked ones. */
    removeBlocks: (ids) => {
      const doomed = new Set(ids);
      setBlocks(prev => {
        const out = prev.filter(b => !doomed.has(b.id) || b.locked);
        return out.length === prev.length ? prev : out;
      });
    },

    /**
     * Insert several ready-made blocks after `afterId` (or at the start when it
     * is null) as one undo step — pasted markdown, an assistant answer.
     * Returns the ids actually inserted; an id already in use is replaced.
     */
    insertBlocksAfter: (afterId, incoming, options) => {
      const taken = new Set(readDoc().blocks.map(b => b.id));
      const fresh = incoming.map(block => (taken.has(block.id) ? duplicateOf(block, uid()) : block));
      if (fresh.length === 0) return [];
      setBlocks(prev => {
        const idx = afterId === null ? -1 : prev.findIndex(b => b.id === afterId);
        const out = prev.slice();
        // Replacing takes the anchor's place — pasting into a blank line should
        // not leave the blank line behind — unless the anchor is locked.
        if (options?.replaceAnchor && idx !== -1 && !prev[idx]?.locked) {
          out.splice(idx, 1, ...fresh);
        } else {
          out.splice(afterId === null ? 0 : idx === -1 ? out.length : idx + 1, 0, ...fresh);
        }
        return out;
      });
      return fresh.map(block => block.id);
    },
  };
}
