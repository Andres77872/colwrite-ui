import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toEditorDoc, toWireContent } from '../content';
import type { DocumentContentOutput } from '../schema';
import { STORED_OPERATION_NAMES, normalizeChangeSetOperation } from '@/data/documentHistory';
import { applyOperations, reconcileBlocks } from '@/editor/docOps';
import type { Doc, ToolOperation } from '@/editor/types';
import { sanitizeEditableHtml } from '@/export/sanitize';
import { CITATION_STYLES } from '@/editor/csl/styles';
import { buildBibliography } from '@/editor/citations';

/**
 * The shared document-contract corpus, from the API repository
 * (`ColWrite-api/tests/fixtures/document_contract/`), through the editor: the
 * round trip a page makes through `toEditorDoc` and `toWireContent`, and the
 * operations of a stored change set as the review applies them. The API's
 * own verifier (`verify_canonical.mjs`) checks the canonical bytes and the
 * operation names; this is the editor half it leaves to the front end.
 *
 * The corpus is read where `npm run api:sync` finds the API: `COLWRITE_API_REPO`,
 * or `../ColWrite-api`. Where it is not checked out (a CI job of this
 * repository alone) the suite is skipped, not failed.
 */

const API_REPO = resolve(process.cwd(), process.env.COLWRITE_API_REPO ?? '../ColWrite-api');
const CORPUS = resolve(API_REPO, 'tests/fixtures/document_contract');
const present = existsSync(resolve(CORPUS, 'manifest.json'));

type Case = {
  id: string;
  pipeline: string;
  input: string;
  outcome: 'editable' | 'read_only' | 'rejected';
  node_canonical?: boolean;
  expected: Record<string, unknown>;
};
type Manifest = { serializer_version: string; operation_names: string[]; citation_styles: string[]; cases: Case[] };

const read = (path: string): unknown => JSON.parse(readFileSync(resolve(CORPUS, path), 'utf8'));
const manifest = (present ? read('manifest.json') : { serializer_version: '', operation_names: [], citation_styles: [], cases: [] }) as Manifest;
const cases = (pipeline: string, outcome?: Case['outcome']) =>
  manifest.cases.filter((entry) => entry.pipeline === pipeline && (outcome === undefined || entry.outcome === outcome));

/* The corpus's canonical JSON (`colwrite-json-v1`), as its verifier writes it. */
function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const b = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return a.length - b.length;
}
function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return '0';
    return JSON.stringify(value).replace(/e([+-])(\d)$/u, 'e$10$2');
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== null && record[key] !== undefined).sort(compareCodePoints);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  throw new Error(`unsupported canonical value: ${typeof value}`);
}
const sha256 = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

/** A page as the editor loads it (`DocumentSession`): converted, then repaired. */
function load(content: Record<string, unknown>): Doc {
  const doc = toEditorDoc(content as DocumentContentOutput);
  return { ...doc, blocks: reconcileBlocks(doc.blocks) };
}

/**
 * What a save sends for the page, as the content the server stores: the
 * editor's own fields, and the page's `tags`, which the editor does not hold
 * and a save leaves as they are.
 */
function saved(doc: Doc, tags: unknown): string {
  return canonical({ ...toWireContent(doc), tags });
}

type RawPage = Record<string, unknown> & { blocks: Array<Record<string, unknown>> };

/**
 * The page as the server holds and returns it. Where the corpus pins the
 * server's normalized html for the first block, that is what a read gives;
 * the server's other defaults are the ones `toWireContent` writes.
 */
function asStored(raw: RawPage, entry: Case): RawPage {
  const html = entry.expected.normalized_html;
  if (typeof html !== 'string') return raw;
  const [first, ...rest] = raw.blocks;
  return { ...raw, blocks: [{ ...first, html }, ...rest] };
}


describe.skipIf(!present)('the shared document-contract corpus, through the editor', () => {
  it('is the serializer this editor writes', () => {
    expect(manifest.serializer_version).toBe('colwrite-json-v1');
  });

  it('lists the CSL style ids the editor renders, no more and no fewer', () => {
    expect(CITATION_STYLES.map((style) => style.id).sort()).toEqual([...manifest.citation_styles].sort());
  });

  describe('a page’s round trip, toEditorDoc then toWireContent', () => {
    const editable = cases('document', 'editable');

    it('covers every editable page of the corpus', () => {
      expect(editable.length).toBeGreaterThan(0);
    });

    for (const entry of editable) {
      it(`${entry.id}: loads and saves the content the server holds unchanged`, () => {
        const raw = read(entry.input) as RawPage;
        const text = saved(load(asStored(raw, entry)), raw.tags ?? []);
        expect(sha256(text)).toBe(entry.expected.canonical_sha256);
        expect(Buffer.byteLength(text, 'utf8')).toBe(entry.expected.canonical_utf8_bytes);
      });

      it(`${entry.id}: loads the raw page as the server would store it`, () => {
        const raw = read(entry.input) as RawPage;
        expect(sha256(saved(load(raw), raw.tags ?? []))).toBe(entry.expected.canonical_sha256);
      });

      it(`${entry.id}: renders its citations and references in its style`, () => {
        const doc = load(read(entry.input) as RawPage);
        const bibliography = buildBibliography(doc.blocks, { library: doc.sources, style: doc.citationStyle ?? null });
        // Every work cited has its entry, and every entry is rendered.
        expect(bibliography.entries.every((item) => item.formatted.length > 0)).toBe(true);
      });
    }

    const normalized = editable.filter((entry) => typeof entry.expected.normalized_html === 'string');
    for (const entry of normalized) {
      const html = String((read(entry.input) as RawPage).blocks[0]?.html ?? '');
      it(`${entry.id}: sanitizes the raw html as the server does`, () => {
        expect(sanitizeEditableHtml(html)).toBe(entry.expected.normalized_html);
      });
    }
  });

  describe('the operations of a stored change set', () => {
    it('are the seven the editor maps, no more and no fewer', () => {
      expect([...STORED_OPERATION_NAMES].sort()).toEqual([...manifest.operation_names].sort());
    });

    for (const entry of cases('operation', 'editable')) {
      it(`${entry.id}: maps every stored operation and applies them as the server does`, () => {
        const { snapshot, operations } = read(entry.input) as { snapshot: Record<string, unknown>; operations: Record<string, unknown>[] };
        const mapped = operations.map(normalizeChangeSetOperation);
        expect(mapped.every((operation) => operation !== null)).toBe(true);
        const ops = mapped as ToolOperation[];
        expect(ops.map((operation) => operation.op)).toEqual(entry.expected.operation_order);
        expect(ops.map((operation) => operation.newInformation)).toEqual(entry.expected.new_information);

        const applied = applyOperations(load(snapshot), ops);
        expect(applied.desynced).toEqual([]);
        expect(applied.doc.blocks.map((block) => block.id)).toEqual(entry.expected.result_block_ids);
        const result = canonical({ ...toWireContent(applied.doc), tags: snapshot.tags ?? [] });
        expect(sha256(result)).toBe(entry.expected.result_content_hash);
      });
    }

    for (const entry of [...cases('operation', 'rejected'), ...cases('operation', 'read_only')]) {
      it(`${entry.id}: maps none of its operations, so the set is not staged`, () => {
        const { operations } = read(entry.input) as { operations: Record<string, unknown>[] };
        expect(operations.length).toBeGreaterThan(0);
        for (const operation of operations) {
          expect(normalizeChangeSetOperation(operation), String(operation.op)).toBeNull();
        }
      });
    }
  });
});
