import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCollection } from '@/data/__tests__/resourceFixtures';
import { CollectionAttachmentLabel } from '../CollectionAttachmentLabel';
import { CollectionBreadcrumbs } from '../CollectionBreadcrumbs';
import { CollectionEditorDialog } from '../CollectionDialogs';
import { CollectionFolderHeader } from '../CollectionFolderHeader';
import { CollectionChildren } from '../LibraryResources';
import {
  COLLECTION_DRAG_MIME,
  DOCUMENT_DRAG_MIME,
  RESOURCE_DRAG_MIME,
  isExternalFileDrag,
  readLibraryDragPayload,
  setLibraryDragPayload,
} from '../collectionDnd';

function dataTransfer(files: File[] = []) {
  const values = new Map<string, string>();
  const fileList = {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    ...Object.fromEntries(files.map((file, index) => [index, file])),
  } as unknown as FileList;
  return {
    files: fileList,
    get types() {
      return [...values.keys(), ...(files.length > 0 ? ['Files'] : [])];
    },
    effectAllowed: 'all',
    dropEffect: 'none',
    setData(type: string, value: string) {
      values.set(type, value);
    },
    getData(type: string) {
      return values.get(type) ?? '';
    },
  } as unknown as DataTransfer;
}

afterEach(cleanup);

describe('Browse rows', () => {
  it('moves a dragged PDF or collection onto a collection row, and ignores anything else', () => {
    const target = makeCollection({ id: 4, name: 'Target' });
    const onDrop = vi.fn();
    render(
      <CollectionChildren
        collections={[target]}
        heading="Collections"
        parentEffective={false}
        onOpen={() => undefined}
        onDrop={onDrop}
      />,
    );
    const row = screen.getByRole('button', { name: /Target/ }).closest('li') as HTMLElement;

    const resourceDrag = dataTransfer();
    setLibraryDragPayload(resourceDrag, { kind: 'resource', id: 19 });
    fireEvent.drop(row, { dataTransfer: resourceDrag });
    expect(onDrop).toHaveBeenCalledWith({ kind: 'resource', id: 19 }, 4);

    const folderDrag = dataTransfer();
    setLibraryDragPayload(folderDrag, { kind: 'collection', id: 8 });
    fireEvent.drop(row, { dataTransfer: folderDrag });
    expect(onDrop).toHaveBeenCalledWith({ kind: 'collection', id: 8 }, 4);

    const invalid = dataTransfer();
    invalid.setData(COLLECTION_DRAG_MIME, '{"version":1,"id":"not-a-number"}');
    fireEvent.drop(row, { dataTransfer: invalid });

    const file = dataTransfer([new File(['%PDF-1.7'], 'paper.pdf', { type: 'application/pdf' })]);
    fireEvent.drop(row, { dataTransfer: file });
    expect(onDrop).toHaveBeenCalledTimes(2);
  });

  it('shows the grant state of each row and keeps the heading when there are none', () => {
    const view = render(
      <CollectionChildren
        collections={[
          makeCollection({
            id: 4,
            name: 'Reading',
            grant_state: { direct: true, effective: true, via_collection_id: 4, via_collection_name: 'Reading' },
          }),
        ]}
        heading="Collections"
        parentEffective={false}
        onOpen={() => undefined}
        onDrop={() => undefined}
      />,
    );
    expect(screen.getByText('Used here')).toBeTruthy();

    view.rerender(
      <CollectionChildren
        collections={[]}
        heading="Collections"
        emptyText="No collections yet."
        parentEffective={false}
        onOpen={() => undefined}
        onDrop={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Collections' })).toBeTruthy();
    expect(screen.getByText('No collections yet.')).toBeTruthy();
  });
});

describe('Collection navigation and attachment labels', () => {
  it('renders labeled breadcrumbs and navigates root and ancestors', () => {
    const root = vi.fn();
    const select = vi.fn();
    render(
      <CollectionBreadcrumbs
        path={[
          { id: 1, name: 'Research' },
          { id: 2, name: 'Methods' },
        ]}
        onSelectRoot={root}
        onSelectCollection={select}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Collection breadcrumbs' });
    expect(nav.className).toContain('overflow-x-auto');
    expect(within(nav).getByText('Methods').getAttribute('aria-current')).toBe('page');
    // The Library is the root. Unfiled is a view beside the collections, not
    // the place they seem to live inside (U-13).
    fireEvent.click(within(nav).getByRole('button', { name: 'Library' }));
    fireEvent.click(within(nav).getByRole('button', { name: 'Research' }));
    expect(root).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith(1);
    expect(within(nav).queryByText('Unfiled')).toBeNull();
  });

  it('shows Unfiled as a view under the Library, and the Library alone as the current place', () => {
    const view = render(<CollectionBreadcrumbs path={[]} view="Unfiled" onSelectRoot={vi.fn()} onSelectCollection={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Library' })).toBeTruthy();
    expect(screen.getByText('Unfiled').getAttribute('aria-current')).toBe('page');

    view.rerender(<CollectionBreadcrumbs path={[]} onSelectRoot={vi.fn()} onSelectCollection={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Library' })).toBeNull();
    expect(screen.getByText('Library').getAttribute('aria-current')).toBe('page');
  });

  it('clearly distinguishes direct, inherited, and direct-plus-inherited access', () => {
    const direct = {
      direct: true,
      effective: true,
      via_collection_id: 2,
      via_collection_name: 'Methods',
    };
    const inherited = {
      direct: false,
      effective: true,
      via_collection_id: 1,
      via_collection_name: 'Research',
    };
    render(
      <div>
        <CollectionAttachmentLabel attachment={direct} />
        <CollectionAttachmentLabel attachment={inherited} />
        <CollectionAttachmentLabel attachment={direct} inheritedFromAncestor />
      </div>,
    );
    expect(screen.getByText('Used here')).toBeTruthy();
    expect(screen.getByText('Used via Research')).toBeTruthy();
    expect(screen.getByText('Used here and via a parent')).toBeTruthy();
    // The short label goes in the badge; the sentence goes in the title, so a
    // 380px panel row stays scannable without losing the explanation.
    expect(screen.getByText('Used here').getAttribute('title')).toBe(
      'The assistant on this page can read the PDFs in this collection and the collections inside it.',
    );
    expect(screen.getByText('Used via Research').getAttribute('title')).toBe(
      'This page uses Research, which contains this collection.',
    );
  });

  it('offers the grant as one "Use on this page" toggle, never as "Attach"', () => {
    const toggle = vi.fn();
    const header = (direct: boolean) => (
      <CollectionFolderHeader
        collection={makeCollection({ id: 2, name: 'Methods' })}
        loading={false}
        attachment={
          direct
            ? { direct: true, effective: true, via_collection_id: 2, via_collection_name: 'Methods' }
            : null
        }
        inheritedFromAncestor={false}
        attachmentBusy={false}
        actionButtonRef={{ current: null }}
        onCreateChild={vi.fn()}
        onEdit={vi.fn()}
        onMove={vi.fn()}
        onTrash={vi.fn()}
        onToggleAttachment={toggle}
      />
    );
    const view = render(header(false));
    const off = screen.getByRole('button', { name: 'Use on this page' });
    expect(off.getAttribute('aria-pressed')).toBe('false');
    expect(off.getAttribute('title')).toContain('can read the PDFs in this collection');
    fireEvent.click(off);
    expect(toggle).toHaveBeenCalledTimes(1);

    view.rerender(header(true));
    expect(screen.getByRole('button', { name: 'Use on this page' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Used here')).toBeTruthy();
    // One rule for unsaved pages (U-17): the toggle saves the page first, so
    // it is never disabled with a "save first" reason.
    expect(screen.getByRole('button', { name: 'Use on this page' }).hasAttribute('disabled')).toBe(false);
    expect(document.body.textContent).not.toMatch(/attach|save this page/i);
  });
});

describe('Collection editor dialog', () => {
  it('enforces the backend collection field ceilings in the editor', () => {
    render(
      <CollectionEditorDialog
        open
        mode="create"
        onOpenChange={() => undefined}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Name').getAttribute('maxlength')).toBe('191');
    expect(screen.getByLabelText('Description').getAttribute('maxlength')).toBe('1000');
  });
});

describe('Row drags', () => {
  it('carries a page with its placement ETag, which uploads never mistake for a file', () => {
    const drag = dataTransfer([new File(['x'], 'shadow.pdf', { type: 'application/pdf' })]);
    setLibraryDragPayload(drag, { kind: 'document', id: 'page-1', placementEtag: '"cwp:3"' });

    expect(drag.types).toContain(DOCUMENT_DRAG_MIME);
    expect(JSON.parse(drag.getData(DOCUMENT_DRAG_MIME))).toEqual({ version: 1, id: 'page-1', placementEtag: '"cwp:3"' });
    expect(readLibraryDragPayload(drag)).toEqual({ kind: 'document', id: 'page-1', placementEtag: '"cwp:3"' });
    // A row drag is not an upload, even when the browser adds files to it.
    expect(isExternalFileDrag(drag)).toBe(false);
    expect(isExternalFileDrag(dataTransfer([new File(['x'], 'paper.pdf', { type: 'application/pdf' })]))).toBe(true);
  });

  it('reads one payload only, and a collection’s ETag when the tree sent one', () => {
    const collection = dataTransfer();
    setLibraryDragPayload(collection, { kind: 'collection', id: 4, etag: '"cwc:2"' });
    expect(readLibraryDragPayload(collection)).toEqual({ kind: 'collection', id: 4, etag: '"cwc:2"' });

    const both = dataTransfer();
    setLibraryDragPayload(both, { kind: 'resource', id: 3 });
    both.setData(COLLECTION_DRAG_MIME, JSON.stringify({ version: 1, id: 4 }));
    expect(both.types).toEqual([RESOURCE_DRAG_MIME, COLLECTION_DRAG_MIME]);
    expect(readLibraryDragPayload(both)).toBeNull();
  });
});
