import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { uid } from '@/lib/uid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { menuItem, menuLabel, menuSeparator } from '@/components/ui/menuStyles';
import {
  TURN_INTO_KINDS,
  blockKind,
  kindOf,
  useDocumentId,
  useDocumentSession,
  useEditorActions,
  type BlockKindId,
} from '@/editor';
import { AgentToolsContext } from '@/components/preferences/agentToolsContextState';
import { PanelsContext } from '@/components/panels/panelsContextState';
import { serializeEditableHtml } from '@/components/common/Editable/editableHtml';
import {
  AlertCircle,
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Italic,
  Link2,
  MoreHorizontal,
  Quote,
  Sparkles,
  Strikethrough,
  Telescope,
  Underline,
} from 'lucide-react';
import { openAskAi } from '../AskAi/askAiEvents';
import { ASK_AI_PRESETS, type AskAiPreset } from '../AskAi/presets';
import { ToolbarMenu } from './ToolbarMenu';
import { EDIT_LINK_EVENT, normalizeHref } from './linkHref';
import { LinkHoverCard } from './LinkHoverCard';

const TOOLBAR_HEIGHT = 36;
const VIEWPORT_MARGIN = 8;
/** Space between the selection and the toolbar. */
const GAP = 8;
/** Roughly the toolbar's width; used only until the real size is measured. */
const ESTIMATED_WIDTH = 460;
/** Tall enough for either menu; decides whether a menu opens up or down. */
const MENU_ROOM = 480;

/** `⌘X` on Apple platforms, `Ctrl+X` everywhere else. */
function modKeyLabel(key: string): string {
  const apple =
    typeof navigator !== 'undefined' &&
    /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
  return apple ? `⌘${key}` : `Ctrl+${key}`;
}

/**
 * The top of the room the toolbar may use: just under the page's topbar (the
 * top edge of the scrolling canvas), or the viewport edge outside a canvas.
 */
function roomTop(block: Element | null): number {
  const canvas = block?.closest('.canvas') ?? document.querySelector('.canvas');
  const top = canvas?.getBoundingClientRect().top ?? 0;
  return Math.max(VIEWPORT_MARGIN, top + VIEWPORT_MARGIN);
}

type FormatStateKey = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

interface FormatButton {
  command: string;
  stateKey: FormatStateKey;
  label: string;
  icon: typeof Bold;
  shortcut?: string;
}

const FORMAT_BUTTONS: readonly FormatButton[] = [
  { command: 'bold', stateKey: 'bold', label: 'Bold', icon: Bold, shortcut: modKeyLabel('B') },
  { command: 'italic', stateKey: 'italic', label: 'Italic', icon: Italic, shortcut: modKeyLabel('I') },
  { command: 'underline', stateKey: 'underline', label: 'Underline', icon: Underline, shortcut: modKeyLabel('U') },
  { command: 'strikeThrough', stateKey: 'strike', label: 'Strikethrough', icon: Strikethrough },
  { command: 'code', stateKey: 'code', label: 'Inline code', icon: Code },
];

type FormatState = Record<FormatStateKey, boolean>;

const EMPTY_STATE: FormatState = { bold: false, italic: false, underline: false, strike: false, code: false };

/**
 * The toolbar's "…" menu: the Ask AI presets that make sense for a selection,
 * each opening the Ask AI prompt with that preset already running. The prompt
 * shows the result as a diff and asks before anything replaces the text —
 * one AI surface, reached from here, the slash menu, Space and ⌘J alike.
 */
const MORE_AI_GROUPS: ReadonlyArray<{ label: string; ids: readonly string[] }> = [
  { label: 'Edit', ids: ['improve', 'grammar', 'shorter', 'longer', 'simplify', 'tone', 'translate'] },
  { label: 'Research', ids: ['explain', 'cite', 'check', 'counter'] },
];

function presetById(id: string): AskAiPreset | undefined {
  return ASK_AI_PRESETS.find((preset) => preset.id === id);
}

/** The `<code>` element the selection sits inside, if any. */
function codeAncestor(node: Node | null): HTMLElement | null {
  const element = node?.nodeType === 1 ? (node as HTMLElement) : node?.parentElement;
  return element?.closest('code') ?? null;
}

/** The `<a>` the selection sits inside, if any. */
function linkAncestor(node: Node | null): HTMLAnchorElement | null {
  const element = node?.nodeType === 1 ? (node as HTMLElement) : node?.parentElement;
  return (element?.closest('a') as HTMLAnchorElement | null) ?? null;
}

/**
 * Wrap the selection in `<code>`, or unwrap it when it is already inside one.
 *
 * `document.execCommand` has no inline-code command, so this is done by hand.
 * `surroundContents` throws on a range that partially selects a node, which is
 * ordinary in prose — the fallback extracts and re-inserts instead.
 */
function toggleInlineCode(range: Range): void {
  const existing = codeAncestor(range.commonAncestorContainer);
  if (existing) {
    const parent = existing.parentNode;
    if (!parent) return;
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
    parent.removeChild(existing);
    return;
  }
  const code = document.createElement('code');
  try {
    range.surroundContents(code);
  } catch {
    code.append(range.extractContents());
    range.insertNode(code);
  }
}

/**
 * The toolbar's selection tracking, formatting and hand-offs.
 *
 * It locates the active field by walking up to an element with the `editable`
 * class, which `Editable` renders on every prose block.
 */
function useFloatingToolbar() {
  const { exec, refs, updateHtml, addParagraphChild, getBlock, setBlockKind } = useEditorActions();
  const documentId = useDocumentId();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, below: false });
  const [states, setStates] = useState<FormatState>(EMPTY_STATE);
  const [activeIndex, setActiveIndex] = useState(0);
  /** The block the selection is in, for Turn into, Cite and Ask AI. */
  const [blockId, setBlockId] = useState<string | null>(null);
  /** The href on the current selection, and whether its editor is open. */
  const [linkHref, setLinkHref] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const slashOpenRef = useRef(false);
  // The last non-collapsed range inside an editable. Keeping it lets the
  // buttons run from the keyboard, where reaching them moves DOM focus away
  // from the text and a live `getSelection()` read is no longer reliable.
  const savedRangeRef = useRef<Range | null>(null);
  // The selection rect behind the current position, kept so a measured
  // toolbar size can refine a position computed against the estimates.
  const selectionRectRef = useRef<DOMRect | null>(null);
  const sizeRef = useRef({ width: ESTIMATED_WIDTH, height: TOOLBAR_HEIGHT });
  // Escape hides the toolbar until the selection it acted on is released —
  // restoring that selection would otherwise re-show it in the same gesture.
  const dismissedRef = useRef(false);
  // Set by the link card's Edit: the selection it is about to make should
  // open with the link field rather than the formatting row.
  const pendingLinkEditRef = useRef(false);

  /**
   * Above the selection, as in every editor — and it stays there, over a
   * heading if need be, as Notion's does: a toolbar that jumped below for the
   * first paragraph under each heading covered the rest of that paragraph and
   * moved from block to block. It goes below only when above would run under
   * the page's topbar or off screen. Clamped horizontally to either edge.
   */
  const positionFor = useCallback((rect: DOMRect, block: Element | null) => {
    const { width, height } = sizeRef.current;
    const half = width / 2;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2, half + VIEWPORT_MARGIN),
      window.innerWidth - half - VIEWPORT_MARGIN,
    );
    const minTop = roomTop(block);
    const above = rect.top - height - GAP;
    const below = rect.bottom + GAP;
    const roomBelow = below + height + VIEWPORT_MARGIN <= window.innerHeight;
    const flip = above < minTop && roomBelow;
    return { top: flip ? below : Math.max(minTop, above), left, below: flip };
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const onEditLink = () => {
      dismissedRef.current = false;
      pendingLinkEditRef.current = true;
      window.clearTimeout(timer);
      // Selection changes arrive asynchronously, sometimes more than one per
      // gesture; the request covers all of them, then lapses.
      timer = window.setTimeout(() => {
        pendingLinkEditRef.current = false;
      }, 200);
    };
    window.addEventListener(EDIT_LINK_EVENT, onEditLink);
    return () => {
      window.removeEventListener(EDIT_LINK_EVENT, onEditLink);
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const onSlashVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ visible: boolean }>).detail;
      slashOpenRef.current = Boolean(detail?.visible);
      if (slashOpenRef.current) setVisible(false);
    };
    window.addEventListener('colwrite:slash-menu-visibility', onSlashVisibility as EventListener);
    return () =>
      window.removeEventListener('colwrite:slash-menu-visibility', onSlashVisibility as EventListener);
  }, []);

  const ownerDocumentId = useRef(documentId);
  useEffect(() => {
    if (ownerDocumentId.current === documentId) return;
    ownerDocumentId.current = documentId;
    savedRangeRef.current = null;
    setVisible(false);
  }, [documentId]);

  const findBlockId = useCallback((node: Node | null): { el: HTMLDivElement | null; id: string | null } => {
    let current: Node | null = node;
    while (current) {
      if (current instanceof HTMLElement && current.classList.contains('editable')) break;
      current = current.parentNode;
    }
    const el = (current as HTMLDivElement | null) ?? null;
    if (!el) return { el: null, id: null };
    const entry = Object.entries(refs.current || {}).find(([, dom]) => dom === el);
    return { el, id: entry?.[0] ?? null };
  }, [refs]);

  /**
   * Show, place or hide the toolbar for the document's current selection.
   * Returns whether it is showing for that selection afterwards.
   */
  const syncWithSelection = useCallback((): boolean => {
    // Moving focus onto a toolbar button greys the selection out, which used
    // to dismiss the toolbar the moment a keyboard user reached it. While
    // focus is inside the toolbar the selection it acts on is `savedRangeRef`.
    if (toolbarRef.current?.contains(document.activeElement)) return true;

    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || slashOpenRef.current) {
      // A collapsed selection ends the dismissal: the next one is a fresh
      // selection and gets the toolbar back.
      dismissedRef.current = false;
      setVisible(false);
      return false;
    }

    const { el: editable, id } = findBlockId(selection.anchorNode);
    if (!editable) {
      setVisible(false);
      return false;
    }

    if (dismissedRef.current) return false;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setVisible(false);
      return false;
    }

    savedRangeRef.current = range.cloneRange();
    selectionRectRef.current = rect;

    setBlockId(id);
    setPos(positionFor(rect, editable.closest('[data-block-id]')));
    try {
      setStates({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strike: document.queryCommandState('strikeThrough'),
        code: codeAncestor(range.commonAncestorContainer) !== null,
      });
    } catch {
      setStates(EMPTY_STATE);
    }
    setLinkHref(linkAncestor(range.commonAncestorContainer)?.getAttribute('href') ?? null);
    setLinkOpen(pendingLinkEditRef.current);
    setVisible(true);
    return true;
  }, [findBlockId, positionFor]);

  useEffect(() => {
    const onSelectionChange = () => void syncWithSelection();
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('scroll', onSelectionChange, true);
    window.addEventListener('resize', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', onSelectionChange, true);
      window.removeEventListener('resize', onSelectionChange);
    };
  }, [syncWithSelection]);

  /**
   * Alt+F10 with text selected: bring the toolbar up for the selection, even
   * one an earlier Escape dismissed it for. Returns false when there is no
   * selection in the document text for it to act on.
   */
  const summon = useCallback((): boolean => {
    if (toolbarRef.current?.contains(document.activeElement)) return true;
    dismissedRef.current = false;
    return syncWithSelection();
  }, [syncWithSelection]);

  // The first position of an opening is computed against the size estimates;
  // measure the rendered toolbar and refine it before the browser paints.
  useLayoutEffect(() => {
    if (!visible) return;
    const el = toolbarRef.current;
    const rect = selectionRectRef.current;
    if (!el || !rect) return;
    const { offsetWidth: width, offsetHeight: height } = el;
    if (width === sizeRef.current.width && height === sizeRef.current.height) return;
    sizeRef.current = { width, height };
    const block = blockId ? refs.current[blockId]?.closest('[data-block-id]') ?? null : null;
    setPos(positionFor(rect, block));
  }, [visible, blockId, positionFor, refs]);

  /**
   * Put the caret back where the user left it before reaching the toolbar.
   *
   * `document.execCommand` acts on whatever the document has selected, so once
   * focus sits on a toolbar button it would apply to nothing. The pointer path
   * never hits this because `mousedown` is prevented; the keyboard path does.
   */
  const focusSavedRange = useCallback(() => {
    const range = savedRangeRef.current;
    if (!range) return;
    const { el } = findBlockId(range.commonAncestorContainer);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    const selection = document.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }, [findBlockId]);

  /**
   * Escape out of the toolbar: hide it and put the selection back.
   *
   * Restoring the saved range fires `selectionchange`, which would re-open the
   * toolbar in the same gesture — the dismissal flag holds it closed until the
   * selection collapses.
   */
  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setVisible(false);
    focusSavedRange();
  }, [focusSavedRange]);

  /**
   * Hand the selection to the Ask AI prompt, optionally with a preset already
   * chosen. The selection is put back first, because the prompt captures what
   * it acts on from the document selection when it opens.
   */
  const onAskAi = useCallback(
    (presetId?: string) => {
      const range = savedRangeRef.current;
      if (!range) return;
      const { id } = findBlockId(range.commonAncestorContainer);
      if (!id) return;
      focusSavedRange();
      dismissedRef.current = true;
      setVisible(false);
      openAskAi({ blockId: id, actionId: presetId });
    },
    [findBlockId, focusSavedRange],
  );

  /** The selected words, as one line — what a Research query is made of. */
  const selectedText = useCallback(
    () => savedRangeRef.current?.toString().replace(/\s+/g, ' ').trim() ?? '',
    [],
  );

  /** Write the block's DOM back to document state after a hand-made edit. */
  const commitActiveBlock = useCallback(() => {
    const { el, id } = findBlockId(document.getSelection()?.anchorNode ?? null);
    if (el && id) updateHtml(id, serializeEditableHtml(el));
  }, [findBlockId, updateHtml]);

  const onFormat = (command: string) => (event: React.MouseEvent | React.KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    focusSavedRange();
    if (command === 'code') {
      const selection = document.getSelection();
      if (!selection?.rangeCount) return;
      toggleInlineCode(selection.getRangeAt(0));
      commitActiveBlock();
      setStates((prev) => ({ ...prev, code: !prev.code }));
      return;
    }
    exec(command);
  };

  /**
   * Apply, replace or clear the link on the saved selection.
   *
   * `createLink` on a range already inside an `<a>` nests one anchor in
   * another, so an existing link is unwrapped first and then rewritten.
   */
  const applyLink = useCallback(
    (href: string | null) => {
      focusSavedRange();
      const selection = document.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range) return;

      const existing = linkAncestor(range.commonAncestorContainer);
      if (existing) {
        const parent = existing.parentNode;
        if (parent) {
          while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
          parent.removeChild(existing);
        }
      }
      if (href) exec('createLink', href);
      commitActiveBlock();
      setLinkHref(href);
      setLinkOpen(false);
    },
    [commitActiveBlock, exec, focusSavedRange],
  );

  /** Turn the selection's block into another kind, keeping its text. */
  const turnInto = useCallback(
    (kind: BlockKindId) => {
      if (!blockId) return;
      const el = refs.current[blockId];
      dismissedRef.current = true;
      setVisible(false);
      setBlockKind(blockId, kind, el ? { html: serializeEditableHtml(el) } : undefined);
    },
    [blockId, refs, setBlockKind],
  );

  /**
   * Put an empty citation straight after the selection and open its source
   * picker — the selected words are the claim being cited.
   *
   * The placeholder and the child are committed together: a paragraph whose
   * html and children disagree fails validation for every later edit.
   */
  const cite = useCallback(() => {
    const range = savedRangeRef.current;
    if (!range || !blockId) return;
    const el = refs.current[blockId];
    if (!el || !range.endContainer.isConnected || !el.contains(range.endContainer)) return;

    const at = range.cloneRange();
    at.collapse(false);
    const childId = uid();
    const placeholder = document.createElement('span');
    placeholder.setAttribute('data-child-id', childId);
    placeholder.contentEditable = 'false';
    at.insertNode(placeholder);

    dismissedRef.current = true;
    setVisible(false);
    addParagraphChild(blockId, { id: childId, type: 'citation', keys: [], style: 'numeric' });
    updateHtml(blockId, serializeEditableHtml(el));

    // The widget mounts into the placeholder on the next render; open it
    // then, so the author lands in the search field rather than on a red pill.
    let attempts = 0;
    const open = () => {
      const pill = document.querySelector<HTMLElement>(`[data-child-id="${childId}"] button`);
      if (pill) pill.click();
      else if (++attempts < 10) requestAnimationFrame(open);
    };
    requestAnimationFrame(open);
  }, [addParagraphChild, blockId, refs, updateHtml]);

  const block = blockId ? getBlock(blockId) : undefined;

  return {
    visible,
    pos,
    states,
    activeIndex,
    setActiveIndex,
    toolbarRef,
    block,
    onFormat,
    onAskAi,
    selectedText,
    turnInto,
    cite,
    dismiss,
    summon,
    restoreSelection: focusSavedRange,
    linkHref,
    linkOpen,
    setLinkOpen,
    applyLink,
  };
}

/**
 * The link editor, opened from the toolbar's link button or `Mod+K`.
 *
 * It replaces the toolbar row rather than floating beside it: the toolbar is
 * already positioned against the selection, and a second floating surface
 * would need its own clamping against the viewport edges.
 */
function LinkEditor({
  href,
  onApply,
  onCancel,
}: {
  href: string | null;
  onApply: (href: string | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(href ?? '');
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const commit = () => {
    // An emptied field clears the link, as it always has.
    if (!value.trim()) {
      onApply(null);
      return;
    }
    const result = normalizeHref(value);
    if (result.ok) onApply(result.href);
    else setError(result.reason);
  };

  return (
    <div className="relative flex items-center gap-1">
      {error ? (
        <AlertCircle aria-hidden="true" className="ml-1.5 h-4 w-4 shrink-0 text-destructive" />
      ) : (
        <Link2 aria-hidden="true" className="ml-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <Input
        autoFocus
        type="url"
        inputMode="url"
        aria-label="Link address"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder="Paste a link…"
        className="h-7 w-60 bg-transparent ring-0 focus-visible:ring-0 max-sm:w-44"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        // The toolbar prevents mousedown to keep the selection; the field
        // needs the pointer to reach it.
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <Button type="button" variant="ghost" size="sm" onClick={commit}>
        Apply
      </Button>
      {href && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => onApply(null)}
        >
          Remove
        </Button>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="absolute left-0 top-full mt-2 whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-xs text-destructive shadow-md"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * `role="toolbar"` promises one tab stop plus arrow-key navigation. The
 * roving `tabindex` is kept in the DOM rather than in JSX so every top-level
 * control joins the same rotation, whatever renders it.
 */
function toolbarItems(toolbar: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(toolbar?.querySelectorAll<HTMLButtonElement>('[data-toolbar-item]') ?? []);
}

function useRovingTabIndex(
  toolbarRef: React.RefObject<HTMLDivElement | null>,
  visible: boolean,
  activeIndex: number,
) {
  useEffect(() => {
    if (!visible) return;
    toolbarItems(toolbarRef.current).forEach((item, index) => {
      item.tabIndex = index === activeIndex ? 0 : -1;
    });
  }, [toolbarRef, visible, activeIndex]);
}

/**
 * Alt+F10, the APG convention for moving focus from the text to its toolbar.
 * Listed in the shortcuts dialog through `EDITOR_SHORTCUTS`.
 */
const TOOLBAR_FOCUS_KEYS = 'Alt+F10';

function isToolbarFocusKey(event: KeyboardEvent): boolean {
  return event.key === 'F10' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

/**
 * The item a keyboard user lands on: the one they were on last time, or the
 * first that is enabled. Returns its index, or -1 when every item is
 * disabled.
 */
function landingIndex(items: HTMLButtonElement[], preferred: number): number {
  if (items[preferred] && !items[preferred].disabled) return preferred;
  return items.findIndex((item) => !item.disabled);
}

/**
 * A toolbar button's name and shortcut, in the styled tooltip the rest of the
 * chrome uses (the native `title` took a second to appear, unstyled). Placed
 * away from the selection: above the toolbar, or below it when the toolbar
 * sits under the text.
 */
function ToolbarTip({
  label,
  shortcut,
  below,
  children,
}: {
  label: string;
  shortcut?: string;
  below: boolean;
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={below ? 'bottom' : 'top'} sideOffset={8}>
        {label}
        {shortcut && <span className="ml-2 text-tooltip-foreground/60">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

function Divider() {
  return <div role="separator" aria-orientation="vertical" className="mx-0.5 h-5 w-px shrink-0 bg-divider" />;
}

/** The open menu, how it was opened, and where its trigger sits in the toolbar. */
type OpenMenu = { id: 'kind' | 'ai'; fromKeyboard: boolean; left: number } | null;

/**
 * The selection toolbar:
 *
 *   ✦ Ask AI | Text ▾ | B I U S <> 🔗 | ❝ Cite | …
 *
 * AI first, as in Notion; then what the block is (and a menu to change it);
 * then marks; then citing, the move a paper makes most after bold; then the
 * rest of the AI presets.
 */
export function FloatingToolbar() {
  return (
    <>
      <SelectionToolbar />
      <LinkHoverCard />
    </>
  );
}

function SelectionToolbar() {
  // A read-only page (a viewer) gets no formatting toolbar: the text can still
  // be selected and copied, and Mod+J asks the assistant about it.
  const { loadingDocumentId, readOnly } = useDocumentSession();
  const agentTools = useContext(AgentToolsContext);
  // Optional, like the agent tools: outside the workspace there is no sidebar.
  const panels = useContext(PanelsContext);
  const {
    visible,
    pos,
    states,
    activeIndex,
    setActiveIndex,
    toolbarRef,
    block,
    onFormat,
    onAskAi,
    selectedText,
    turnInto,
    cite,
    dismiss,
    summon,
    restoreSelection,
    linkHref,
    linkOpen,
    setLinkOpen,
    applyLink,
  } = useFloatingToolbar();
  const [menu, setMenu] = useState<OpenMenu>(null);
  const kindButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  // Alt+F10 on a selection the toolbar was not showing for: focus moves in
  // once it has rendered.
  const focusPendingRef = useRef(false);

  useRovingTabIndex(toolbarRef, visible && !linkOpen, activeIndex);

  /**
   * Put keyboard focus in the toolbar: on the item used last, or the first
   * enabled one; in the link field when that has replaced the row. Returns
   * false when the toolbar is not rendered yet.
   */
  const focusToolbar = useCallback((): boolean => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return false;
    const items = toolbarItems(toolbar);
    if (items.length === 0) {
      const field = toolbar.querySelector<HTMLElement>('input, button:not(:disabled)');
      field?.focus();
      return Boolean(field);
    }
    const index = landingIndex(items, activeIndex);
    const item = items[index];
    if (!item) return false;
    setActiveIndex(index);
    item.focus();
    return true;
  }, [activeIndex, setActiveIndex, toolbarRef]);

  // Alt+F10 from the text: the only way to the toolbar from the keyboard. It
  // is mounted after the page, so Tab would cross every block to reach it,
  // and Tab inside a list or code indents instead. Escape (handled below)
  // brings focus back to the text with the selection as it was.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isToolbarFocusKey(event) || event.defaultPrevented || loadingDocumentId) return;
      if (toolbarRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        return;
      }
      if (!summon()) return;
      event.preventDefault();
      event.stopPropagation();
      if (!focusToolbar()) focusPendingRef.current = true;
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [focusToolbar, loadingDocumentId, summon, toolbarRef]);

  useLayoutEffect(() => {
    if (!focusPendingRef.current) return;
    focusPendingRef.current = false;
    if (visible) focusToolbar();
  }, [visible, focusToolbar]);

  // A menu belongs to the showing of the toolbar it was opened in.
  if (!visible && menu) setMenu(null);

  // `⌘K` is the binding every writing tool uses for this and the one the
  // toolbar's own tooltip advertises.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }
      event.preventDefault();
      setMenu(null);
      setLinkOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, setLinkOpen]);

  /**
   * Escape while the toolbar is up and focus is still in the text.
   *
   * A menu is usually opened with the pointer, which leaves focus in the
   * paragraph — so Escape went to the editor, which turned the text selection
   * into a block selection and left the menu open over it, with a toolbar
   * whose buttons no longer had a selection to act on. Caught in the capture
   * phase, ahead of the editor: the first Escape closes the menu (or the link
   * field), the next hides the toolbar; the selection is put back each time.
   * With focus inside the toolbar, its own handlers decide.
   */
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (toolbarRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      if (menu) {
        setMenu(null);
        restoreSelection();
      } else if (linkOpen) {
        setLinkOpen(false);
        restoreSelection();
      } else {
        dismiss();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [visible, menu, linkOpen, dismiss, restoreSelection, setLinkOpen, toolbarRef]);

  const closeMenu = useCallback((returnFocus: boolean) => {
    setMenu((current) => {
      if (current && returnFocus) {
        (current.id === 'kind' ? kindButtonRef : moreButtonRef).current?.focus();
      }
      return null;
    });
  }, []);

  /** Runs the selection as a Research query in the right sidebar. */
  const searchPapers = () => {
    const query = selectedText();
    if (!panels || !query) return;
    dismiss();
    panels.openSidebar('research', { tab: 'research', query });
  };

  const onToolbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    const items = toolbarItems(toolbarRef.current);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;

    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = current === 0 ? items.length - 1 : current - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    const item = next === null ? undefined : items[next];
    if (next === null || !item) return;

    event.preventDefault();
    setMenu(null);
    setActiveIndex(next);
    item.focus();
  };

  if (!visible || Boolean(loadingDocumentId) || readOnly) return null;

  const locked = block?.locked === true;
  const kind = block && (block.type === 'paragraph' || block.type === 'heading') ? kindOf(block) : null;
  const KindIcon = kind ? blockKind(kind).icon : Sparkles;
  const canCite = block?.type === 'paragraph' && !locked;
  const citationsEnabled = agentTools?.isToolEnabled('search_citations') ?? false;
  // Open menus upwards when the toolbar sits low on the screen.
  const menuAbove = pos.top + TOOLBAR_HEIGHT + MENU_ROOM > window.innerHeight && pos.top > MENU_ROOM;

  /** A menu trigger: click toggles, and a keyboard click lands in the menu. */
  const toggle = (id: 'kind' | 'ai') => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setLinkOpen(false);
    // `detail` is 0 for the click that Enter and Space synthesize.
    const fromKeyboard = event.detail === 0;
    const left = event.currentTarget instanceof HTMLElement ? event.currentTarget.offsetLeft : 0;
    setMenu((current) => (current?.id === id ? null : { id, fromKeyboard, left }));
  };

  return (
    // Its own provider: the toolbar is also mounted outside the workspace
    // shell, and its hints should come quicker than the chrome's.
    <TooltipProvider delayDuration={300} skipDelayDuration={200}>
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Text formatting"
        aria-keyshortcuts={TOOLBAR_FOCUS_KEYS}
        onKeyDown={onToolbarKeyDown}
        className={cn(
          'floating-toolbar fixed flex h-9 -translate-x-1/2 items-center gap-0.5 rounded-lg bg-popover p-1 text-popover-foreground shadow-lg',
          'animate-in fade-in-0 zoom-in-95 duration-100 z-[var(--z-floating)]',
        )}
        style={{ top: pos.top, left: pos.left }}
        // Keep the text selection alive while interacting with the toolbar.
        onMouseDown={(event) => event.preventDefault()}
      >
        {linkOpen ? (
          <LinkEditor
            href={linkHref}
            onApply={applyLink}
            // The field unmounts with the editor; without this, Escape in it
            // left focus on <body> with the selection gone.
            onCancel={() => {
              setLinkOpen(false);
              restoreSelection();
            }}
          />
        ) : (
          <>
            <ToolbarTip label="Ask AI" shortcut={modKeyLabel('J')} below={pos.below}>
              <Button
                type="button"
                variant="ai"
                size="sm"
                data-toolbar-item
                className="font-medium"
                disabled={!block}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onAskAi();
                }}
                aria-label={`Ask AI (${modKeyLabel('J')})`}
              >
                <Sparkles aria-hidden="true" />
                {/* Icons only on a phone, where the full row would not fit. */}
                <span className="max-sm:sr-only">Ask AI</span>
              </Button>
            </ToolbarTip>

            {kind && (
              <>
                <Divider />
                <ToolbarTip label="Turn into" below={pos.below}>
                  <Button
                    ref={kindButtonRef}
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-toolbar-item
                    className="gap-1 font-normal aria-expanded:bg-active"
                    disabled={locked}
                    aria-haspopup="menu"
                    aria-expanded={menu?.id === 'kind'}
                    aria-label={`Turn into (${blockKind(kind).label})`}
                    onClick={toggle('kind')}
                  >
                    <KindIcon aria-hidden="true" className="sm:hidden" />
                    <span className="max-sm:hidden">{blockKind(kind).label}</span>
                    <ChevronDown aria-hidden="true" className="!size-3.5 text-muted-foreground" />
                  </Button>
                </ToolbarTip>
              </>
            )}

            <Divider />
            {FORMAT_BUTTONS.map(({ command, stateKey, label, icon: Icon, shortcut }) => (
              <ToolbarTip key={command} label={label} shortcut={shortcut} below={pos.below}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  data-toolbar-item
                  className={cn(states[stateKey] && 'text-primary hover:text-primary')}
                  onClick={onFormat(command)}
                  aria-label={shortcut ? `${label} (${shortcut})` : label}
                  aria-pressed={states[stateKey]}
                >
                  <Icon aria-hidden="true" />
                </Button>
              </ToolbarTip>
            ))}
            <ToolbarTip label={linkHref ? 'Edit link' : 'Add link'} shortcut={modKeyLabel('K')} below={pos.below}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-toolbar-item
                className={cn(linkHref && 'text-primary hover:text-primary')}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenu(null);
                  setLinkOpen(true);
                }}
                aria-label={`${linkHref ? 'Edit link' : 'Add link'} (${modKeyLabel('K')})`}
                aria-pressed={Boolean(linkHref)}
              >
                <Link2 aria-hidden="true" />
              </Button>
            </ToolbarTip>

            {canCite && (
              <>
                <Divider />
                <ToolbarTip label="Cite a source" below={pos.below}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-toolbar-item
                    className="font-normal"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      cite();
                    }}
                    aria-label="Cite a source for the selection"
                  >
                    <Quote aria-hidden="true" className="text-muted-foreground" />
                    <span className="max-sm:sr-only">Cite</span>
                  </Button>
                </ToolbarTip>
              </>
            )}

            <Divider />
            <ToolbarTip label="More AI actions" below={pos.below}>
              <Button
                ref={moreButtonRef}
                type="button"
                variant="icon"
                size="icon-sm"
                data-toolbar-item
                className="aria-expanded:bg-active aria-expanded:text-foreground"
                disabled={!block}
                aria-haspopup="menu"
                aria-expanded={menu?.id === 'ai'}
                aria-label="More AI actions"
                onClick={toggle('ai')}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </ToolbarTip>

            {menu?.id === 'kind' && kind && (
              <ToolbarMenu
                label="Turn into"
                align={{ left: menu.left }}
                above={menuAbove}
                autoFocus={menu.fromKeyboard}
                onClose={closeMenu}
              >
                <div className={menuLabel}>Turn into</div>
                {TURN_INTO_KINDS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={cn(menuItem, 'w-full text-left')}
                    onClick={() => turnInto(option.id)}
                  >
                    <option.icon aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.id === kind && <Check aria-hidden="true" className="!text-foreground" />}
                  </button>
                ))}
              </ToolbarMenu>
            )}

            {menu?.id === 'ai' && (
              <ToolbarMenu
                label="More AI actions"
                align="end"
                above={menuAbove}
                autoFocus={menu.fromKeyboard}
                onClose={closeMenu}
              >
                {MORE_AI_GROUPS.map((group, groupIndex) => (
                  <div key={group.label} role="group" aria-label={group.label}>
                    {groupIndex > 0 && <div role="separator" className={menuSeparator} />}
                    <div className={menuLabel}>{group.label}</div>
                    {group.ids
                      .map(presetById)
                      .filter((preset): preset is AskAiPreset => !!preset && (!preset.citations || citationsEnabled))
                      .map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          role="menuitem"
                          tabIndex={-1}
                          className={cn(menuItem, 'w-full text-left [&>svg]:text-ai')}
                          onClick={() => onAskAi(preset.id)}
                        >
                          <preset.icon aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">{preset.label}</span>
                          {preset.children && (
                            <ChevronRight aria-hidden="true" className="!text-muted-foreground" />
                          )}
                        </button>
                      ))}
                    {group.label === 'Research' && panels && (
                      <button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        className={cn(menuItem, 'w-full text-left')}
                        onClick={searchPapers}
                      >
                        <Telescope aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">Search papers for this</span>
                      </button>
                    )}
                  </div>
                ))}
              </ToolbarMenu>
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
