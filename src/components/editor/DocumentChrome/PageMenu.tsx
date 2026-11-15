import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTrash } from '@/actions/useTrash';
import { useMoveTo } from '@/actions/useMoveTo';
import { MoveToDialog, type MoveDestination } from '@/components/collections/MoveToDialog';
import { CopyToWorkspaceDialog } from '@/components/collections/CopyToWorkspaceDialog';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { displayTitle } from '@/components/layout/displayTitle';
import { pagePlacementQuery } from '@/data/documents';
import { useToast } from '@/components/ui/toastContext';
import {
  useDocumentId,
  useDocumentStatus,
  useEditorActions,
  useEditorDoc,
  useEditorView,
  usePageReadOnly,
  type Doc,
} from '@/editor';
import { usePageSettings } from '@/editor/pageSettings';
import { usePanels } from '@/components/panels/panelsContextState';
import { modifierLabel } from '@/components/layout/Shortcuts';
import { editedLabel } from '@/components/layout/editedLabel';
import { pageLink } from '@/lib/pageLink';
import { useCompactMenus } from '@/components/layout/useCompactMenus';
import { DocumentExportDialog } from './DocumentExportDialog';
import { documentStats, plural } from './documentStats';
import { PAGE_TOOLS } from './pageTools';
import {
  CaseSensitive,
  Copy,
  Download,
  FileCode,
  FolderInput,
  History,
  Link2,
  MoreHorizontal,
  MoveHorizontal,
  Quote,
  Redo2,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';

const CITATION_STYLES: ReadonlyArray<{ value: NonNullable<Doc['citationStyle']> | 'auto'; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'numeric', label: 'Numeric [1]' },
  { value: 'ieee', label: 'IEEE' },
  { value: 'author-year', label: 'Author–year' },
];

/**
 * The page's "…" menu: everything that acts on the page as a whole.
 *
 * Export, Move to Trash, undo and the rest used to be a row of buttons — among them
 * a filled Save button that was the loudest thing on screen for an action
 * autosave already performs. As in Notion they sit here, with the counts the
 * old status footer kept permanently on screen as the menu's footer.
 */
export function PageMenu() {
  const { blocks, doc } = useEditorDoc();
  const documentId = useDocumentId();
  // A viewer (D6) reads, copies, exports and looks at history; nothing here
  // moves, copies out, restyles or trashes the page for them.
  const readOnly = usePageReadOnly();
  const { lastSavedAt, inTrash } = useDocumentStatus();
  const { canUndo, canRedo } = useEditorView();
  const { undo, redo, setCitationStyle } = useEditorActions();
  const pageSettings = usePageSettings();
  const { setTool } = usePanels();
  const { trashPage } = useTrash();
  const { toast } = useToast();
  const move = useMoveTo();
  const workspaceId = useWorkspaceId();
  const placement = useQuery({ ...pagePlacementQuery(workspaceId, documentId ?? ''), enabled: documentId !== null });
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  // Closing the menu hands focus back to its trigger, and a focused trigger
  // opens its tooltip: after choosing Document JSON the hint would sit over
  // the sidebar that just opened. The tooltip ignores that one focus.
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const menuClosedAt = useRef(0);
  // Export opens from a menu item that is gone by the time the dialog
  // closes; the dialog hands focus back to this button instead.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const onMenuOpenChange = (next: boolean) => {
    if (!next) menuClosedAt.current = Date.now();
    setTooltipOpen(false);
    setOpen(next);
  };
  const onTooltipOpenChange = (next: boolean) =>
    setTooltipOpen(next && !open && Date.now() - menuClosedAt.current > 400);
  const modifier = modifierLabel();

  // Only while the menu is open: counting words on every keystroke for a
  // footer nobody is looking at would be wasted work.
  const stats = useMemo(() => (open ? documentStats(blocks) : null), [blocks, open]);
  // A side flyout has no room on a phone: the styles go inline instead.
  const compact = useCompactMenus();
  // The editor knows when the open page was last saved, from its load and
  // then from each save, so the footer needs no request of its own.
  const footer = stats
    ? [editedLabel(lastSavedAt), plural(stats.words, 'word')].filter(Boolean).join(' · ')
    : '';
  const citationChoices = (
    <DropdownMenuRadioGroup
      value={doc.citationStyle ?? 'auto'}
      onValueChange={(value) =>
        setCitationStyle(value === 'auto' ? null : (value as NonNullable<Doc['citationStyle']>))
      }
    >
      {CITATION_STYLES.map((style) => (
        <DropdownMenuRadioItem
          key={style.value}
          value={style.value}
          indicator
          // Inline, the menu stays open so the choice is seen to take.
          onSelect={compact ? (event) => event.preventDefault() : undefined}
        >
          {style.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );

  const styleChoices = (
    <>
      <DropdownMenuCheckboxItem
        toggle
        checked={pageSettings.fullWidth}
        onCheckedChange={(checked) => pageSettings.set({ fullWidth: checked === true })}
        onSelect={(event) => event.preventDefault()}
      >
        <MoveHorizontal aria-hidden="true" />
        Full width
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        toggle
        checked={pageSettings.smallText}
        onCheckedChange={(checked) => pageSettings.set({ smallText: checked === true })}
        onSelect={(event) => event.preventDefault()}
      >
        <CaseSensitive aria-hidden="true" />
        Small text
      </DropdownMenuCheckboxItem>
    </>
  );

  const copyLink = async () => {
    if (!documentId) return;
    try {
      await navigator.clipboard.writeText(pageLink(documentId));
      toast({ title: 'Link copied', variant: 'success' });
    } catch {
      toast({ title: 'Could not copy the link', variant: 'error' });
    }
  };

  const onTrash = async () => {
    if (!documentId) return;
    await trashPage({ id: documentId, name: doc.name, collectionId: placement.data?.collectionId });
  };

  const moveTo = async (destination: MoveDestination) => {
    if (!documentId || !placement.data) return;
    await move.movePage(
      { id: documentId, name: doc.name ?? '', collectionId: placement.data.collectionId, placementEtag: placement.data.placementEtag },
      destination.kind === 'collection' ? { id: destination.collectionId, name: destination.name } : { id: null, name: null },
    );
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onMenuOpenChange}>
        <Tooltip open={tooltipOpen} onOpenChange={onTooltipOpenChange}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button ref={triggerRef} variant="icon" size="icon-sm" aria-label="Page options">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Style, export and more</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-[260px]">
          <DropdownMenuItem disabled={!documentId} onSelect={() => void copyLink()}>
            <Link2 aria-hidden="true" />
            Copy link
          </DropdownMenuItem>
          {!readOnly && (
            <>
              <DropdownMenuItem disabled={!documentId || !placement.data} onSelect={() => setMoveOpen(true)}>
                <FolderInput aria-hidden="true" />
                Move to…
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!documentId} onSelect={() => setCopyOpen(true)}>
                <Copy aria-hidden="true" />
                Copy to workspace…
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onSelect={() => setExportOpen(true)}>
            <Download aria-hidden="true" />
            Export…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTool('history')}>
            <History aria-hidden="true" />
            Version history
          </DropdownMenuItem>
          {/* The topbar drops its tool buttons on a phone; they live here then. */}
          {PAGE_TOOLS.filter((tool) => tool.id !== 'history').map(({ id, label, icon: Icon }) => (
            <DropdownMenuItem key={id} className="sm:hidden" onSelect={() => setTool(id)}>
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setTool('json')}>
            <FileCode aria-hidden="true" />
            Document JSON
            <DropdownMenuShortcut>Developer</DropdownMenuShortcut>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          {compact ? (
            <>
              {!readOnly && (
                <DropdownMenuLabel className="flex items-center gap-2">
                  <Quote aria-hidden="true" className="size-3.5" />
                  Citation style
                </DropdownMenuLabel>
              )}
              {!readOnly && citationChoices}
              <DropdownMenuLabel className="flex items-center gap-2">
                <Type aria-hidden="true" className="size-3.5" />
                Style
              </DropdownMenuLabel>
              {styleChoices}
            </>
          ) : (
            <>
              {!readOnly && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Quote aria-hidden="true" />
                    Citation style
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-48" collisionPadding={8}>
                    {citationChoices}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Type aria-hidden="true" />
                  Style
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48" collisionPadding={8}>
                  {styleChoices}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}

          {!readOnly && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!canUndo} onSelect={(event) => { event.preventDefault(); undo(); }}>
                <Undo2 aria-hidden="true" />
                Undo
                {!compact && <DropdownMenuShortcut>{modifier}+Z</DropdownMenuShortcut>}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canRedo} onSelect={(event) => { event.preventDefault(); redo(); }}>
                <Redo2 aria-hidden="true" />
                Redo
                {!compact && <DropdownMenuShortcut>{modifier}+Shift+Z</DropdownMenuShortcut>}
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuItem destructive disabled={!documentId || inTrash !== null} onSelect={() => void onTrash()}>
                <Trash2 aria-hidden="true" />
                Move to Trash
              </DropdownMenuItem>
            </>
          )}

          {footer && (
            <>
              <DropdownMenuSeparator />
              <p className="px-2 pb-1 pt-0.5 text-xs leading-5 text-muted-foreground">{footer}</p>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DocumentExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        returnFocus={() => triggerRef.current}
      />
      {moveOpen && placement.data && (
        <MoveToDialog
          open
          subject={{ kind: 'page', name: displayTitle(doc.name), collectionId: placement.data.collectionId }}
          onOpenChange={setMoveOpen}
          onChoose={moveTo}
          returnFocusRef={triggerRef}
        />
      )}
      {copyOpen && documentId && (
        <CopyToWorkspaceDialog
          page={{ id: documentId, name: displayTitle(doc.name), collectionId: placement.data?.collectionId ?? null }}
          onOpenChange={setCopyOpen}
          returnFocusRef={triggerRef}
        />
      )}
    </>
  );
}
