import { describe, it, expect, beforeEach } from 'vitest';
import type { Doc } from '../types';
import {
  ID_STORAGE_KEY,
  STORAGE_KEY,
  clearCachedDocs,
  loadDoc,
  loadDocumentId,
  saveDoc,
  saveDocumentId,
  clearUnsavedDraft,
  loadUnsavedDraft,
  saveUnsavedDraft,
} from '../storage';

const docFor = (name: string): Doc => ({
  version: 1,
  name,
  blocks: [{ id: 'b1', type: 'paragraph', html: `<p>${name}</p>`, children: [] }],
});

beforeEach(() => {
  localStorage.clear();
});

describe('draft cache', () => {
  it('keeps drafts for different documents apart', () => {
    saveDoc(docFor('one'), 'doc-1');
    saveDoc(docFor('two'), 'doc-2');

    expect(loadDoc('doc-1')?.name).toBe('one');
    expect(loadDoc('doc-2')?.name).toBe('two');
  });

  it('never hands back a draft cached under another document', () => {
    // The single-slot cache made this possible, and the recovered body would
    // then be saved over whatever the other document actually held.
    saveDoc(docFor('one'), 'doc-1');
    expect(loadDoc('doc-2')).toBeNull();
  });

  it('rejects a record whose embedded id disagrees with its key', () => {
    localStorage.setItem(
      'colwrite:doc:doc-1',
      JSON.stringify({ documentId: 'doc-9', doc: docFor('mismatched') }),
    );
    expect(loadDoc('doc-1')).toBeNull();
  });

  it('caches the not-yet-saved local draft under its own key', () => {
    saveDoc(docFor('local'), null);
    expect(loadDoc(null)?.name).toBe('local');
    expect(loadDoc('doc-1')).toBeNull();
  });

  it('round-trips the pointer to the last open document', () => {
    saveDocumentId('doc-7');
    expect(loadDocumentId()).toBe('doc-7');
    saveDocumentId(null);
    expect(loadDocumentId()).toBeNull();
  });

  it('ignores malformed JSON rather than throwing', () => {
    localStorage.setItem('colwrite:doc:doc-1', '{not json');
    expect(loadDoc('doc-1')).toBeNull();
  });

  it('clears every cached draft on sign-out', () => {
    saveDoc(docFor('one'), 'doc-1');
    saveDoc(docFor('two'), 'doc-2');
    saveDocumentId('doc-1');

    clearCachedDocs();

    expect(loadDoc('doc-1')).toBeNull();
    expect(loadDoc('doc-2')).toBeNull();
    expect(loadDocumentId()).toBeNull();
  });

  it('clears kept edits and review records with them, and leaves other keys alone', () => {
    saveUnsavedDraft('doc-1', docFor('never saved'), 5);
    localStorage.setItem('colwrite:review:v1:doc-1:cs-1', '{}');
    localStorage.setItem('colwrite:agent-engine:v1', 'legacy');

    clearCachedDocs();

    expect(loadUnsavedDraft('doc-1')).toBeNull();
    expect(localStorage.getItem('colwrite:review:v1:doc-1:cs-1')).toBeNull();
    expect(localStorage.getItem('colwrite:agent-engine:v1')).toBe('legacy');
  });
});

describe('edits that never reached the server', () => {
  it('are kept per document with the time they were taken', () => {
    saveUnsavedDraft('doc-1', docFor('mine'), 1234);
    expect(loadUnsavedDraft('doc-1')).toEqual({ documentId: 'doc-1', doc: docFor('mine'), savedAt: 1234 });
    expect(loadUnsavedDraft('doc-2')).toBeNull();
  });

  it('are not read back for another document or from damaged storage', () => {
    localStorage.setItem('colwrite:unsaved:doc-2', JSON.stringify({ documentId: 'doc-1', doc: docFor('x'), savedAt: 1 }));
    expect(loadUnsavedDraft('doc-2')).toBeNull();
    localStorage.setItem('colwrite:unsaved:doc-3', '{not json');
    expect(loadUnsavedDraft('doc-3')).toBeNull();
  });

  it('are gone once cleared', () => {
    saveUnsavedDraft('doc-1', docFor('mine'));
    clearUnsavedDraft('doc-1');
    expect(loadUnsavedDraft('doc-1')).toBeNull();
  });
});

describe('migration from the single-slot cache', () => {
  it('adopts a legacy draft when its id slot still agrees', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docFor('legacy')));
    localStorage.setItem(ID_STORAGE_KEY, 'doc-1');

    expect(loadDoc('doc-1')?.name).toBe('legacy');
  });

  it('refuses a legacy draft belonging to a different document', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docFor('legacy')));
    localStorage.setItem(ID_STORAGE_KEY, 'doc-9');

    expect(loadDoc('doc-1')).toBeNull();
  });

  it('drops the legacy slot once a keyed record exists', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docFor('legacy')));
    saveDoc(docFor('current'), 'doc-1');

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadDoc('doc-1')?.name).toBe('current');
  });
});
