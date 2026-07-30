import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCollection } from '@/services/__tests__/resourceFixtures';
import type { CollectionItem } from '@/services/resources';
import { CollectionAttachmentLabel } from '../CollectionAttachmentLabel';
import { CollectionBreadcrumbs } from '../CollectionBreadcrumbs';
import { CollectionDeleteDialog, CollectionEditorDialog } from '../CollectionDialogs';
import { CollectionPickerDialog } from '../CollectionPickerDialog';
import { CollectionTree } from '../CollectionTree';
import { UploadDropZone } from '../LibraryResources';
import {
  COLLECTION_DRAG_MIME,
  setLibraryDragPayload,
} from '../collectionDnd';
import type {
  CollectionTreeBranch,
  CollectionTreeController,
} from '../useCollectionTree';

function branch(parentId: number | null, collections: CollectionItem[]): CollectionTreeBranch {
  return {
    parentId,
    pages: [],
    collections,
    loaded: true,
    loading: false,
    loadingMore: false,
    error: null,
    nextOffset: null,
  };
}

function controllerWith(
  roots: CollectionItem[],
  children: Record<number, CollectionItem[]> = {},
  overrides: Partial<CollectionTreeController> = {},
): CollectionTreeController {
  const branches: Record<string, CollectionTreeBranch> = { root: branch(null, roots) };
  for (const [parentId, rows] of Object.entries(children)) {
    branches[parentId] = branch(Number(parentId), rows);
  }
  return {
    branches,
    roots,
    expandedIds: new Set(),
    selectedId: null,
    selectedCollection: null,
    selectedParentId: null,
    path: [],
    attachment: null,
    selecting: false,
    selectionError: null,
    childrenOf: (parentId) => branches[parentId === null ? 'root' : String(parentId)]?.collections ?? [],
    loadChildren: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined),
    setExpanded: vi.fn().mockResolvedValue(undefined),
    toggleExpanded: vi.fn().mockResolvedValue(undefined),
    selectCollection: vi.fn().mockResolvedValue(null),
    refreshSelected: vi.fn().mockResolvedValue(null),
    refreshLoaded: vi.fn().mockResolvedValue(undefined),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    moveFolder: vi.fn(),
    previewDelete: vi.fn(),
    deleteFolder: vi.fn(),
    attachDocument: vi.fn(),
    detachDocument: vi.fn(),
    ...overrides,
  };
}

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

describe('CollectionTree accessibility and drag/drop', () => {
  it('implements roving tree focus and the WAI-ARIA arrow key contract', async () => {
    const root = makeCollection({ id: 1, name: 'Root', child_count: 1 });
    const child = makeCollection({ id: 2, name: 'Child', parent_id: 1, depth: 2 });
    const selected = vi.fn();

    function Harness() {
      const [expanded, setExpanded] = useState<Set<number>>(new Set());
      const controller = controllerWith([root], { 1: [child] }, {
        expandedIds: expanded,
        setExpanded: async (collectionId, value) => {
          setExpanded((previous) => {
            const next = new Set(previous);
            if (value) next.add(collectionId);
            else next.delete(collectionId);
            return next;
          });
        },
        toggleExpanded: async (collectionId) => {
          setExpanded((previous) => {
            const next = new Set(previous);
            if (next.has(collectionId)) next.delete(collectionId);
            else next.add(collectionId);
            return next;
          });
        },
      });
      return (
        <CollectionTree
          controller={controller}
          selected="unfiled"
          onSelectUnfiled={() => selected('unfiled')}
          onSelectCollection={selected}
        />
      );
    }

    render(<Harness />);
    let items = screen.getAllByRole('treeitem');
    const unfiled = items[0];
    let rootItem = items[1];
    expect(unfiled.tabIndex).toBe(0);
    expect(unfiled.getAttribute('aria-expanded')).toBeNull();
    expect(unfiled.getAttribute('aria-level')).toBe('1');
    expect(unfiled.getAttribute('aria-posinset')).toBe('1');
    expect(unfiled.getAttribute('aria-setsize')).toBe('2');
    expect(rootItem.tabIndex).toBe(-1);
    expect(rootItem.getAttribute('aria-level')).toBe('1');
    expect(rootItem.getAttribute('aria-posinset')).toBe('2');
    expect(rootItem.getAttribute('aria-setsize')).toBe('2');
    expect(screen.getByRole('button', { name: 'Expand Root' }).tabIndex).toBe(-1);
    // The drag handle is a pointer affordance only. It used to be a focusable
    // <button> that did nothing on Enter or Space; the keyboard route for
    // moving a folder is its actions menu, so the handle is now hidden from
    // assistive tech rather than advertised as a control.
    expect(screen.queryByRole('button', { name: 'Drag Root' })).toBeNull();
    const handle = rootItem.querySelector('[draggable="true"]');
    expect(handle?.getAttribute('aria-hidden')).toBe('true');
    expect(handle?.hasAttribute('tabindex')).toBe(false);

    unfiled.focus();
    await act(async () => {
      fireEvent.keyDown(unfiled, { key: 'ArrowDown' });
    });
    expect(document.activeElement).toBe(rootItem);

    await act(async () => {
      fireEvent.keyDown(rootItem, { key: 'ArrowRight' });
    });
    items = await screen.findAllByRole('treeitem');
    expect(items).toHaveLength(3);
    rootItem = items[1];
    const childItem = items[2];
    expect(childItem.getAttribute('aria-level')).toBe('2');

    await act(async () => {
      fireEvent.keyDown(rootItem, { key: 'ArrowRight' });
    });
    expect(document.activeElement).toBe(childItem);
    await act(async () => {
      fireEvent.keyDown(childItem, { key: ' ' });
    });
    expect(selected).toHaveBeenCalledWith(2);

    await act(async () => {
      fireEvent.keyDown(childItem, { key: 'ArrowLeft' });
    });
    expect(document.activeElement).toBe(rootItem);
    await act(async () => {
      fireEvent.keyDown(rootItem, { key: 'Home' });
    });
    expect(document.activeElement).toBe(unfiled);
    await act(async () => {
      fireEvent.keyDown(unfiled, { key: 'End' });
    });
    expect(document.activeElement).toBe(childItem);

    rootItem.focus();
    await act(async () => {
      fireEvent.keyDown(rootItem, { key: 'ArrowLeft' });
    });
    await waitFor(() => expect(screen.getAllByRole('treeitem')).toHaveLength(2));
    rootItem = screen.getByRole('treeitem', { name: /Root/ });
    rootItem.focus();
    fireEvent.keyDown(rootItem, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(rootItem);
  });

  it('moves the one tree tab stop to a pointer-selected row', async () => {
    const root = makeCollection({ id: 1, name: 'Root' });

    function Harness() {
      const [selected, setSelected] = useState<number | 'unfiled'>('unfiled');
      return (
        <CollectionTree
          controller={controllerWith([root])}
          selected={selected}
          onSelectUnfiled={() => setSelected('unfiled')}
          onSelectCollection={setSelected}
        />
      );
    }

    render(<Harness />);
    const rootItem = screen.getByRole('treeitem', { name: /Root/ });
    fireEvent.click(rootItem);

    await waitFor(() => expect(document.activeElement).toBe(rootItem));
    expect(rootItem.tabIndex).toBe(0);
    expect(screen.getByRole('treeitem', { name: 'Unfiled' }).tabIndex).toBe(-1);
  });

  it('owns only treeitems, including its pagination and its status lines', () => {
    // A tree may only own `treeitem` and `group`. The per-branch loading and
    // error lines used to be role="status" / role="alert" elements and the
    // pagination a <Button>, all sitting directly inside role="tree" — a real
    // violation, and the load-more was a second tab stop in a widget that is
    // meant to have exactly one.
    const roots = [makeCollection({ id: 1, name: 'Root' })];
    const controller = controllerWith(roots, {}, {
      branches: {
        root: { ...branch(null, roots), nextOffset: 50, loading: true, error: 'Could not load folders' },
      },
    });

    render(
      <CollectionTree
        controller={controller}
        selected="unfiled"
        onSelectUnfiled={() => undefined}
        onSelectCollection={() => undefined}
      />,
    );

    const tree = screen.getByRole('tree');
    for (const child of Array.from(tree.querySelectorAll('[role]'))) {
      expect(child.getAttribute('role')).toBe('treeitem');
    }
    // Pagination is a treeitem, so the arrow keys reach it like anything else.
    expect(screen.getByRole('treeitem', { name: /Show more folders/ })).toBeTruthy();
    // The error is still announced — from outside the tree.
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Could not load folders');
    expect(tree.contains(alert)).toBe(false);
    expect(tree.getAttribute('aria-busy')).toBe('true');
  });

  it('offers no destination a folder cannot legally move into', () => {
    // The picker passes the folder being moved plus its loaded descendants.
    // Offering them and letting the server reject the move was the bug; the
    // dialog copy that explained the rejection was the symptom.
    const parent = makeCollection({ id: 1, name: 'Parent', child_count: 1 });
    const child = makeCollection({ id: 2, name: 'Child', parent_id: 1, depth: 2 });
    const other = makeCollection({ id: 3, name: 'Elsewhere' });
    const onSelect = vi.fn();

    render(
      <CollectionTree
        controller={controllerWith([parent, other], { 1: [child] }, {
          expandedIds: new Set([1]),
        })}
        selected={null}
        showUnfiled={false}
        disabledIds={new Set([1, 2])}
        onSelectCollection={onSelect}
      />,
    );

    const disabled = screen.getByRole('treeitem', { name: /Parent/ });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(disabled);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('treeitem', { name: /Elsewhere/ }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('uses distinct validated folder/resource payloads and drops onto folder or Unfiled', () => {
    const folder = makeCollection({ id: 4, name: 'Target' });
    const onDrop = vi.fn();
    render(
      <CollectionTree
        controller={controllerWith([folder])}
        selected="unfiled"
        onSelectUnfiled={() => undefined}
        onSelectCollection={() => undefined}
        onDrop={onDrop}
      />,
    );
    const [unfiled, target] = screen.getAllByRole('treeitem');

    const resourceDrag = dataTransfer();
    setLibraryDragPayload(resourceDrag, { kind: 'resource', id: 19 });
    fireEvent.drop(target, { dataTransfer: resourceDrag });
    expect(onDrop).toHaveBeenCalledWith({ kind: 'resource', id: 19 }, 4);

    const folderDrag = dataTransfer();
    setLibraryDragPayload(folderDrag, { kind: 'collection', id: 8 });
    fireEvent.drop(unfiled, { dataTransfer: folderDrag });
    expect(onDrop).toHaveBeenCalledWith({ kind: 'collection', id: 8 }, null);

    const invalid = dataTransfer();
    invalid.setData(COLLECTION_DRAG_MIME, '{"version":1,"id":"not-a-number"}');
    fireEvent.drop(target, { dataTransfer: invalid });

    const arbitraryText = dataTransfer();
    arbitraryText.setData('text/plain', '19');
    fireEvent.drop(target, { dataTransfer: arbitraryText });
    expect(onDrop).toHaveBeenCalledTimes(2);
  });

  it('separates OS file drops from internal resource moves', () => {
    const onFiles = vi.fn();
    render(
      <UploadDropZone compact uploading={false} targetLabel="Unfiled" onFiles={onFiles} />,
    );
    // Located via the file input rather than the copy: the zone has a compact
    // and a full layout with different wording, and this test is about the drop
    // guards, not the words.
    const dropZone = screen
      .getByLabelText('Add PDFs to your library')
      .closest('div') as HTMLElement;
    const file = new File(['%PDF-1.7'], 'paper.pdf', { type: 'application/pdf' });

    const internal = dataTransfer([file]);
    setLibraryDragPayload(internal, { kind: 'resource', id: 3 });
    fireEvent.drop(dropZone, { dataTransfer: internal });
    expect(onFiles).not.toHaveBeenCalled();

    const external = dataTransfer([file]);
    fireEvent.drop(dropZone, { dataTransfer: external });
    expect(onFiles).toHaveBeenCalledWith(external.files);
  });
});

describe('Collection navigation and attachment labels', () => {
  it('renders labeled breadcrumbs and navigates root and ancestors', () => {
    const root = vi.fn();
    const select = vi.fn();
    render(
      <CollectionBreadcrumbs
        path={[
          { id: 1, parent_id: null, name: 'Research', depth: 1 },
          { id: 2, parent_id: 1, name: 'Methods', depth: 2 },
        ]}
        onSelectRoot={root}
        onSelectCollection={select}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Folder breadcrumbs' });
    expect(nav.className).toContain('overflow-x-auto');
    expect(within(nav).getByText('Methods').getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(nav).getByRole('button', { name: 'Unfiled' }));
    fireEvent.click(within(nav).getByRole('button', { name: 'Research' }));
    expect(root).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith(1);
  });

  it('clearly distinguishes direct, inherited, and direct-plus-inherited access', () => {
    const direct = {
      collection_id: 2,
      direct: true,
      effective: true,
      nearest_direct_collection_id: 2,
      nearest_direct_collection_name: 'Methods',
    };
    const inherited = {
      collection_id: 2,
      direct: false,
      effective: true,
      nearest_direct_collection_id: 1,
      nearest_direct_collection_name: 'Research',
    };
    render(
      <div>
        <CollectionAttachmentLabel attachment={direct} />
        <CollectionAttachmentLabel attachment={inherited} />
        <CollectionAttachmentLabel attachment={direct} inheritedFromAncestor />
      </div>,
    );
    expect(screen.getByText('Attached')).toBeTruthy();
    expect(screen.getByText('Via Research')).toBeTruthy();
    expect(screen.getByText('Attached + inherited')).toBeTruthy();
    // The short label goes in the badge; the sentence goes in the title, so a
    // 380px panel row stays scannable without losing the explanation.
    expect(screen.getByText('Attached').getAttribute('title')).toBe(
      'Attached to this document.',
    );
    expect(screen.getByText('Via Research').getAttribute('title')).toBe(
      'Reached through Research, which is attached to this document.',
    );
  });
});

describe('Collection move and delete dialogs', () => {
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

  it('moves a resource to the folder selected in the accessible picker', async () => {
    const folder = makeCollection({ id: 5, name: 'Results' });
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(
      <CollectionPickerDialog
        open
        mode="resource"
        subjectName="paper.pdf"
        controller={controllerWith([folder])}
        documentId="doc-1"
        onOpenChange={() => undefined}
        onMove={onMove}
      />,
    );

    fireEvent.click(screen.getByRole('treeitem', { name: /Results/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
    });
    expect(onMove).toHaveBeenCalledWith({ kind: 'collection', collectionId: 5 });
  });

  it.each([
    'A collection cannot be moved into itself or its descendants',
    'Collection depth cannot exceed 32',
  ])('shows the server move constraint: %s', async (message) => {
    render(
      <CollectionPickerDialog
        open
        mode="collection"
        subjectName="Methods"
        controller={controllerWith([])}
        onOpenChange={() => undefined}
        onMove={vi.fn().mockRejectedValue(new Error(message))}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
    });
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('shows exact recursive counts and requires the exact folder name', async () => {
    const folder = makeCollection({ id: 9, name: 'Danger Zone' });
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <CollectionDeleteDialog
        open
        collection={folder}
        onOpenChange={() => undefined}
        onPreview={vi.fn().mockResolvedValue({
          collection_id: 9,
          status: 'ready',
          collection_count: 3,
          membership_count: 4,
          resource_count: 12,
          resource_bytes: 12_345,
        })}
        onDelete={onDelete}
      />,
    );

    expect(await screen.findByText('12.1 KB')).toBeTruthy();
    expect(screen.getByText(/PDFs and their extracted text are permanently deleted/i)).toBeTruthy();
    const deleteButton = screen.getByRole('button', { name: 'Delete folder and contents' });
    expect(deleteButton.hasAttribute('disabled')).toBe(true);

    const input = screen.getByLabelText('Type Danger Zone to confirm deletion');
    fireEvent.change(input, { target: { value: 'danger zone' } });
    expect(deleteButton.hasAttribute('disabled')).toBe(true);
    fireEvent.change(input, { target: { value: 'Danger Zone' } });
    expect(deleteButton.hasAttribute('disabled')).toBe(false);
    await act(async () => {
      fireEvent.click(deleteButton);
    });
    expect(onDelete).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ resource_count: 12, resource_bytes: 12_345 }),
    );
  });

  it('refreshes changed counts and requires confirmation again', async () => {
    const folder = makeCollection({ id: 9, name: 'Danger Zone' });
    const original = {
      collection_id: 9,
      status: 'ready',
      collection_count: 1,
      membership_count: 0,
      resource_count: 0,
      resource_bytes: 0,
    };
    const changed = { ...original, resource_count: 1, resource_bytes: 2048 };
    const onPreview = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(changed);
    const onDelete = vi.fn().mockRejectedValue(
      new Error('Folder contents changed; review the updated deletion preview'),
    );
    render(
      <CollectionDeleteDialog
        open
        collection={folder}
        onOpenChange={() => undefined}
        onPreview={onPreview}
        onDelete={onDelete}
      />,
    );

    const input = await screen.findByLabelText('Type Danger Zone to confirm deletion');
    fireEvent.change(input, { target: { value: 'Danger Zone' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete folder and contents' }));
    });

    expect(await screen.findByText(/folder contents changed after this preview/i)).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete folder and contents' }).hasAttribute('disabled')).toBe(true);
  });
});
