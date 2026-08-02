import { describe, it, expect, vi, afterEach } from 'vitest';
import { deleteDocument, documentTransforms } from '../documents';
import type { Block, Doc } from '../../editor/types';

afterEach(() => {
  vi.restoreAllMocks();
});

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

  // 3. Doc input with name → carries name only. Canonical content forbids
  // unknown fields, so the legacy `title` alias must never be sent — it used
  // to fail every save of a named document with a 422.
  it('3. includes name and never the legacy title alias', () => {
    const result = toBackendDocument(sampleDoc);
    expect(result.name).toBe('My Doc');
    expect('title' in result).toBe(false);
  });

  // 4. When both are given, name wins and title is dropped
  it('4. prefers explicit name and drops title', () => {
    const doc = { version: 2, blocks: sampleBlocks, name: 'Paper', title: 'Research Paper' };
    const result = toBackendDocument(doc);
    expect(result.name).toBe('Paper');
    expect('title' in result).toBe(false);
  });

  // 5. Empty object fallback → { version: 1, blocks: [] }
  it('5. returns fallback { version:1, blocks:[] } for empty object', () => {
    const result = toBackendDocument({});
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual([]);
  });

  // 6. Primitive fallback (number) → { version: 1, blocks: [] }
  it('6. returns fallback { version:1, blocks:[] } for non-array, non-object input', () => {
    const result = toBackendDocument(42);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual([]);
  });

  // 7. null/undefined fallback
  it('7. returns fallback { version:1, blocks:[] } for null', () => {
    const result = toBackendDocument(null);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual([]);
  });

  // 8. Doc with version:0 preserves 0 (edge case — though unusual)
  it('8. preserves version:0 when explicitly passed', () => {
    const doc = { version: 0, blocks: [] };
    const result = toBackendDocument(doc);
    expect(result.version).toBe(0);
  });

  // 9. Only fields the server models survive: tags pass, unknown extras
  // are dropped rather than tripping the canonical extra=forbid validation.
  it('9. keeps tags and drops unknown extra fields', () => {
    const doc = { version: 3, blocks: sampleBlocks, extraField: 'value', tags: ['a', 'b'] };
    const result = toBackendDocument(doc);
    expect(result.version).toBe(3);
    expect('extraField' in result).toBe(false);
    expect(result.tags).toEqual(['a', 'b']);
  });

  // 10. Array with zero blocks → still returns blocks
  it('10. empty blocks array returns version:1 and empty blocks', () => {
    const result = toBackendDocument([]);
    expect(result.version).toBe(1);
    expect(result.blocks).toEqual([]);
  });

  // 11. Title-only input → the alias becomes the name
  it('11. title-only input is sent as the name', () => {
    const doc = { version: 2, blocks: sampleBlocks, title: 'The Title' };
    const result = toBackendDocument(doc);
    expect(result.name).toBe('The Title');
    expect('title' in result).toBe(false);
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

  // 15. null payload is a malformed successful response
  it('15. rejects null rather than turning it into an empty document', () => {
    expect(() => toEditorDoc(null)).toThrow(/invalid document/i);
  });

  // 16. undefined payload is malformed too
  it('16. rejects undefined rather than turning it into an empty document', () => {
    expect(() => toEditorDoc(undefined)).toThrow(/invalid document/i);
  });

  // 17. Payload with blocks array but version as string → coerces to 1
  it('17. recovers from version-as-string by defaulting to 1', () => {
    const payload = { blocks: sampleBlocks, version: '3' };
    const result = toEditorDoc(payload);
    expect(result.version).toBe(1);
  });

  // 18. Payload with name from title field
  it('18. extracts name from title field when name is absent', () => {
    const payload = { blocks: sampleBlocks, version: 2, title: 'Via Title' };
    const result = toEditorDoc(payload);
    expect(result.name).toBe('Via Title');
  });

  // 19. This transform receives the inner document, so another wrapper is malformed.
  it('19. rejects a nested document wrapper', () => {
    const payload = { document: { blocks: sampleBlocks, version: 3 } };
    expect(() => toEditorDoc(payload)).toThrow(/invalid document/i);
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

describe('malformed document normalization', () => {
  it('drops unknown blocks and repairs a recoverable paragraph', () => {
    const result = toEditorDoc({
      version: 7,
      blocks: [
        { id: 'bad', type: 'video', src: 'unexpected' },
        { id: 'recovered', type: 'paragraph', html: 42 },
        null,
      ],
    });

    expect(result).toEqual({
      version: 7,
      blocks: [
        {
          id: 'recovered',
          type: 'paragraph',
          html: '',
          columns: 1,
          children: [],
        },
      ],
      name: undefined,
    });
  });
});

// ── deleteDocument ──

describe('deleteDocument preconditions', () => {
  // The server rejects an unconditioned delete: it must be told which head
  // the caller believes it is deleting.
  it('sends the known version as a query parameter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', message: '' }), { status: 200 }),
    );

    await deleteDocument('doc-1', { version: 7 });

    expect(String(fetchSpy.mock.calls[0][0])).toBe('/api/document/delete/doc-1?version=7');
  });

  it('fetches the current ETag and presents If-Match when no version is known', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), init });
      if (String(input).includes('/v2/documents/')) {
        return new Response(JSON.stringify({ document_id: 'doc-1' }), {
          status: 200,
          headers: { ETag: 'cw:v1:1:7:abc' },
        });
      }
      return new Response(JSON.stringify({ status: 'ok', message: '' }), { status: 200 });
    });

    await deleteDocument('doc-1');

    expect(calls.map((call) => call.url)).toEqual([
      '/api/v2/documents/doc-1',
      '/api/document/delete/doc-1',
    ]);
    expect((calls[1].init?.headers as Record<string, string>)['If-Match']).toBe('cw:v1:1:7:abc');
  });
});
