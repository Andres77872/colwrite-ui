import { describe, it, expect, beforeEach } from 'vitest';
import type { Doc } from '../types';
import { clearUserStorage } from '@/lib/storageKeys';
import {
  loadDoc,
  loadDocumentId,
  saveDoc,
  saveDocumentId,
  clearUnsavedDraft,
  loadUnsavedDraft,
  saveUnsavedDraft,
} from '../storage';

const WS = 'wsp-6f1c0f5e-8a8b-4c4d-9e2f-1a2b3c4d5e6f';
const OTHER = 'wsp-2b7e9d10-4c3a-4f1e-8b2d-9a0c1e2f3a4b';

const docFor = (name: string): Doc => ({
  name,
  blocks: [{ id: 'b1', type: 'paragraph', html: `<p>${name}</p>`, children: [] }],
});

beforeEach(() => {
  localStorage.clear();
});

describe('draft cache', () => {
  it('keeps drafts for different documents apart', () => {
    saveDoc(WS, docFor('one'), 'doc-1', '"cw:1"');
    saveDoc(WS, docFor('two'), 'doc-2', '"cw:2"');

    expect(loadDoc(WS, 'doc-1')).toEqual({ documentId: 'doc-1', doc: docFor('one'), etag: '"cw:1"' });
    expect(loadDoc(WS, 'doc-2')?.doc.name).toBe('two');
  });

  it('keeps each workspace’s drafts under its own keys', () => {
    saveDoc(WS, docFor('one'), 'doc-1', null);
    expect(localStorage.getItem(`colwrite:ws:${WS}:draft:doc-1`)).not.toBeNull();
    expect(loadDoc(OTHER, 'doc-1')).toBeNull();
  });

  it('never hands back a draft cached under another document', () => {
    // The single-slot cache made this possible, and the recovered body would
    // then be saved over whatever the other document actually held.
    saveDoc(WS, docFor('one'), 'doc-1', null);
    expect(loadDoc(WS, 'doc-2')).toBeNull();
  });

  it('rejects a record whose embedded id disagrees with its key', () => {
    localStorage.setItem(
      `colwrite:ws:${WS}:draft:doc-1`,
      JSON.stringify({ documentId: 'doc-9', doc: docFor('mismatched'), etag: null }),
    );
    expect(loadDoc(WS, 'doc-1')).toBeNull();
  });

  it('caches the not-yet-saved local draft under its own key, with no ETag', () => {
    saveDoc(WS, docFor('local'), null, '"cw:9"');
    expect(localStorage.getItem(`colwrite:ws:${WS}:doc:local`)).not.toBeNull();
    expect(loadDoc(WS, null)).toEqual({ documentId: null, doc: docFor('local'), etag: null });
    expect(loadDoc(WS, 'doc-1')).toBeNull();
  });

  it('round-trips the pointer to the workspace’s last open document', () => {
    saveDocumentId(WS, 'doc-7');
    expect(localStorage.getItem(`colwrite:ws:${WS}:lastDocId`)).toBe('doc-7');
    expect(loadDocumentId(WS)).toBe('doc-7');
    expect(loadDocumentId(OTHER)).toBeNull();
    saveDocumentId(WS, null);
    expect(loadDocumentId(WS)).toBeNull();
  });

  it('ignores malformed JSON rather than throwing', () => {
    localStorage.setItem(`colwrite:ws:${WS}:draft:doc-1`, '{not json');
    expect(loadDoc(WS, 'doc-1')).toBeNull();
  });

  it('clears every workspace’s drafts with the account on sign-out', () => {
    saveDoc(WS, docFor('one'), 'doc-1', null);
    saveDoc(OTHER, docFor('two'), 'doc-2', null);
    saveDocumentId(WS, 'doc-1');

    clearUserStorage();

    expect(loadDoc(WS, 'doc-1')).toBeNull();
    expect(loadDoc(OTHER, 'doc-2')).toBeNull();
    expect(loadDocumentId(WS)).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

describe('edits that never reached the server', () => {
  it('are kept per document with the time they were taken', () => {
    saveUnsavedDraft(WS, 'doc-1', docFor('mine'), 1234);
    expect(loadUnsavedDraft(WS, 'doc-1')).toEqual({ documentId: 'doc-1', doc: docFor('mine'), savedAt: 1234 });
    expect(loadUnsavedDraft(WS, 'doc-2')).toBeNull();
    expect(loadUnsavedDraft(OTHER, 'doc-1')).toBeNull();
  });

  it('are not read back for another document or from damaged storage', () => {
    localStorage.setItem(`colwrite:ws:${WS}:unsaved:doc-2`, JSON.stringify({ documentId: 'doc-1', doc: docFor('x'), savedAt: 1 }));
    expect(loadUnsavedDraft(WS, 'doc-2')).toBeNull();
    localStorage.setItem(`colwrite:ws:${WS}:unsaved:doc-3`, '{not json');
    expect(loadUnsavedDraft(WS, 'doc-3')).toBeNull();
  });

  it('are gone once cleared', () => {
    saveUnsavedDraft(WS, 'doc-1', docFor('mine'));
    clearUnsavedDraft(WS, 'doc-1');
    expect(loadUnsavedDraft(WS, 'doc-1')).toBeNull();
  });
});
