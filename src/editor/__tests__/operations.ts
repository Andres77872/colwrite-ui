import type { ToolOperation } from '../types';

/**
 * Stored change-set operations in the editor's shape, for tests: the API's
 * seven (`ColWrite-api/src/documents/domain/operations.py`). A written block
 * is complete, as the stored form holds it.
 */

type Written = Record<string, unknown>;

export const writeAfter = (blockId: string, ...blocks: Written[]): ToolOperation =>
  ({ op: 'write_blocks', position: 'after', blockId, blocks });

export const writeBefore = (blockId: string, ...blocks: Written[]): ToolOperation =>
  ({ op: 'write_blocks', position: 'before', blockId, blocks });

export const append = (...blocks: Written[]): ToolOperation =>
  ({ op: 'write_blocks', position: 'append', blockId: null, blocks });

/** `blocks[0]` keeps `blockId`; its `id` is filled in when left out. */
export const rewrite = (blockId: string, first: Written, ...rest: Written[]): ToolOperation =>
  ({ op: 'write_blocks', position: 'replace', blockId, blocks: [{ ...first, id: blockId }, ...rest] });

export const replaceText = (blockId: string, find: string, replace: string, block: Written): ToolOperation =>
  ({ op: 'replace_text', blockId, find, replace, block: { ...block, id: blockId } });

export const deleteBlocks = (...blockIds: string[]): ToolOperation => ({ op: 'delete_blocks', blockIds });

export const moveBlock = (blockId: string, position: 'before' | 'after', targetBlockId: string): ToolOperation =>
  ({ op: 'move_block', blockId, position, targetBlockId });

export const setMeta = (fields: Omit<Extract<ToolOperation, { op: 'set_meta' }>, 'op'>): ToolOperation =>
  ({ op: 'set_meta', ...fields });

/** A complete paragraph block, as a stored `write_blocks` holds it. */
export const paragraph = (id: string, html = `<p>${id}</p>`, extra: Written = {}): Written =>
  ({ id, type: 'paragraph', html, children: [], ...extra });
