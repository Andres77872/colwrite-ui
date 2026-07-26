import { describe, it, expect } from 'vitest';
import { documentTransforms } from '../documents';
import type { Block, Doc } from '../../editor/types';

const { toBackendDocument, toEditorDoc } = documentTransforms;

// ── Helpers ──

const sampleBlocks: Block[] = [
  { id: 'b1', type: 'paragraph', html: '<p>Hello</p>' },
  { id: 'b2', type: 'heading', level: 2, html: '<h2>World</h2>' },
  { id: 'b3', type: 'divider' },
];

const sampleDoc: Doc = { version: 5, blocks: sampleBlocks, name: 'My Doc' };

// ── toBackendDocument ──

describe('toBackendDocument', () => {
  // 1. Array input → { version: 1, blocks: input } — creation path
  it('1. returns version:1 with blocks array when input is Block[]', () => {
    const result = toBackendDocument(sampleBlocks);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual(sampleBlocks);
  });

  // 2. Doc input with explicit version → preserves version (NO hardcoded 1)
  it('2. preserves explicit version from Doc input', () => {
    const result = toBackendDocument(sampleDoc);
    expect(result.version).toBe(5);
    expect(result.blocks).toEqual(sampleBlocks);
  });

  // 3. Doc input with name → carries name AND title
  it('3. includes name and title from Doc input', () => {
    const result = toBackendDocument(sampleDoc);
    expect(result.name).toBe('My Doc');
    expect(result.title).toBe('My Doc');
  });

  // 4. Doc input with explicit name different from title → both preserved
  it('4. preserves explicit name and title when both provided', () => {
    const doc = { version: 2, blocks: sampleBlocks, name: 'Paper', title: 'Research Paper' };
    const result = toBackendDocument(doc);
    expect(result.name).toBe('Paper');
    expect(result.title).toBe('Research Paper');
  });

  // 5. Empty object fallback → { version: 1, blocks: [] }
  it('5. returns fallback { version:1, blocks:[] } for empty object', () => {
    const result = toBackendDocument({});
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual([]);
  });

  // 6. Primitive fallback (number) → { version: 1, blocks: [] }
  it('6. returns fallback { version:1, blocks:[] } for non-array, non-object input', () => {
    const result = toBackendDocument(42 as any);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual([]);
  });

  // 7. null/undefined fallback
  it('7. returns fallback { version:1, blocks:[] } for null', () => {
    const result = toBackendDocument(null as any);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual([]);
  });

  // 8. Doc with version:0 preserves 0 (edge case — though unusual)
  it('8. preserves version:0 when explicitly passed', () => {
    const doc = { version: 0, blocks: [] };
    const result = toBackendDocument(doc);
    expect(result.version).toBe(0);
  });

  // 9. Doc with extra metadata fields — preserved via rest spread
  it('9. includes extra metadata fields from input', () => {
    const doc = { version: 3, blocks: sampleBlocks, extraField: 'value', tags: ['a', 'b'] };
    const result = toBackendDocument(doc as any);
    expect(result.version).toBe(3);
    expect(result.extraField).toBe('value');
    expect(result.tags).toEqual(['a', 'b']);
  });

  // 10. Array with zero blocks → still returns blocks
  it('10. empty blocks array returns version:1 and empty blocks', () => {
    const result = toBackendDocument([]);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual([]);
  });

  // 11. Backend payload with title but no name → title is present, name stays undefined
  it('11. title-only input carries title but does not set name', () => {
    const doc = { version: 2, blocks: sampleBlocks, title: 'The Title' };
    const result = toBackendDocument(doc);
    expect(result.title).toBe('The Title');
    expect(result.name).toBeUndefined();
  });
});

// ── toEditorDoc ──

describe('toEditorDoc', () => {
  // 12. Full backend payload with version, blocks, name
  it('12. converts full backend payload to Doc with version', () => {
    const payload = { blocks: sampleBlocks, version: 3, name: 'X' };
    const result = toEditorDoc(payload);
    expect(result.version).toBe(3);
    expect(result.blocks).toEqual(sampleBlocks);
    expect(result.name).toBe('X');
  });

  // 13. Backend payload missing version → defaults to 1
  it('13. defaults version to 1 when missing from payload', () => {
    const payload = { blocks: sampleBlocks };
    const result = toEditorDoc(payload);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual(sampleBlocks);
  });

  // 14. Backend returns raw array → wrapped as version:1
  it('14. wraps raw array as { version:1, blocks: [...] }', () => {
    const result = toEditorDoc(sampleBlocks);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual(sampleBlocks);
  });

  // 15. null payload → fallback empty doc
  it('15. returns fallback { version:1, blocks:[] } for null', () => {
    const result = toEditorDoc(null);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual([]);
  });

  // 16. undefined payload → fallback empty doc
  it('16. returns fallback { version:1, blocks:[] } for undefined', () => {
    const result = toEditorDoc(undefined);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual([]);
  });

  // 17. Payload with blocks array but version as string → coerces to 1
  it('17. recovers from version-as-string by defaulting to 1', () => {
    const payload = { blocks: sampleBlocks, version: '3' as any };
    const result = toEditorDoc(payload);
    expect(result.version).toBe(1);
  });

  // 18. Payload with name from title field
  it('18. extracts name from title field when name is absent', () => {
    const payload = { blocks: sampleBlocks, version: 2, title: 'Via Title' };
    const result = toEditorDoc(payload);
    expect(result.name).toBe('Via Title');
  });

  // 19. Backend wrapper { document: { ... } } — current code does NOT unwrap
  it('19. { document: {...} } wrapper returns fallback (current behavior, no unwrapping)', () => {
    const payload = { document: { blocks: sampleBlocks, version: 3 } };
    const result = toEditorDoc(payload);
    // The code checks payload.blocks directly, not payload.document.blocks
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual([]);
  });

  // 20. Payload with empty blocks array
  it('20. handles empty blocks array', () => {
    const payload = { blocks: [], version: 1 };
    const result = toEditorDoc(payload);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual([]);
  });
});

// ── Round-trip tests ──

describe('round-trip: toEditorDoc ∘ toBackendDocument', () => {
  // 21. Full Doc round-trip preserves version
  it('21. preserves version through round-trip', () => {
    const doc: Doc = { version: 5, blocks: sampleBlocks, name: 'My Doc' };
    const backend = toBackendDocument(doc);
    const result = toEditorDoc(backend);
    expect(result.version).toBe(doc.version);
  });

  // 22. Version 1 round-trip
  it('22. preserves version:1 through round-trip', () => {
    const doc: Doc = { version: 1, blocks: [] };
    const backend = toBackendDocument(doc);
    const result = toEditorDoc(backend);
    expect(result.version).toBe(1);
  });

  // 23. Version 0 round-trip
  it('23. preserves version:0 through round-trip (edge case)', () => {
    const doc: Doc = { version: 0, blocks: [] };
    const backend = toBackendDocument(doc);
    const result = toEditorDoc(backend);
    expect(result.version).toBe(0);
  });

  // 24. Block[] round-trip — goes in as version:1, comes out as version:1
  it('24. blocks array round-trip is version:1', () => {
    const backend = toBackendDocument(sampleBlocks);
    const result = toEditorDoc(backend);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual(sampleBlocks);
  });
});
