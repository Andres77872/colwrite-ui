import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ElementType } from 'react';
import {
  ArrowDownToLine,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerDownLeft,
  RotateCcw,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { menuItem, menuItemDestructive, menuLabel, menuSeparator, menuSurface } from '@/components/ui/menuStyles';
import { useEditorActions, useEditorState, type Block, type CitationChild } from '@/editor';
import { streamAgentChat } from '@/services/agentChat';
import type { AgentSource } from '@/services/streamParser';
import { AgentToolsContext } from '@/components/preferences/agentToolsContextState';
import { useAgentEngine } from '@/components/preferences/agentEngineContextState';
import { ProposedBlockView, ProposedRewriteView } from '../Review/ProposedBlockView';
import { previewBibliography } from '../Review/diffText';
import { toolRunningLabel } from '../ChatAssistant/AgentActivity/toolMeta';
import {
  AgentStatusLine,
  advanceProgress,
  progressForStatus,
  type AgentProgress,
} from '../AgentProgress';
import { serializeEditableHtml } from '../../common/Editable/editableHtml';
import { restoreCaretOffset } from '../../common/Editable/caret';
import {
  ASK_AI_PRESETS,
  buildAskAiMessage,
  customPreset,
  figureProblems,
  presetGroupsFor,
  presetsFor,
  type AskAiPreset,
  type AskAiTargetKind,
} from './presets';
import { asNotes, resultBlocks } from './result';

/** What an open prompt acts on, captured when it opens. */
export type AskAiTarget = {
  /** Distinguishes one opening from the next (the panel remounts per target). */
  key: string;
  kind: AskAiTargetKind;
  /** The blocks the result would replace, in document order. */
  blockIds: string[];
  /** The block the panel sits under. */
  anchorId: string;
  /** The target as markdown, citations as `[@key]` markers. */
  markdown: string;
  /** The target as plain text (widgets as short stand-ins), for one-line summaries. */
  text: string;
  /**
   * For `block` and `selection`: the target as a block (a selection as the
   * block cut down to it), what a rewrite is diffed against — widgets and all.
   */
  diffBase?: Block;
  /** For `selection`: the selected range inside the block. */
  range?: Range;
  /** For `empty`: the text just above the caret, as context. */
  anchorText?: string;
  /** Whether any target block is locked — replacing is then off the table. */
  locked: boolean;
  /** Citations present in the target, the only ones a result may carry. */
  citations: Map<string, CitationChild>;
  preset?: string;
  /** The target is one structured-figure block: it gets the figure presets. */
  figure?: boolean;
};

const HIGHLIGHT = 'ask-ai-target';

type HighlightRegistry = { set: (name: string, value: unknown) => void; delete: (name: string) => void };

function highlights(): HighlightRegistry | null {
  const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  return registry && HighlightCtor ? registry : null;
}

/** Keep a selection visibly marked while focus is in the prompt. */
function markRange(range: Range | undefined): () => void {
  const registry = highlights();
  if (!range || !registry) return () => {};
  const HighlightCtor = (globalThis as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight;
  registry.set(HIGHLIGHT, new HighlightCtor(range));
  return () => registry.delete(HIGHLIGHT);
}

/** `⌘↵` on Apple platforms, `Ctrl+↵` everywhere else. */
function modEnterLabel(): string {
  const apple =
    typeof navigator !== 'undefined' &&
    /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
  return apple ? '⌘↵' : 'Ctrl+↵';
}

type Phase = 'prompt' | 'running' | 'done' | 'error';

/** The menu's tallest; a shorter list is as tall as its rows. */
const MENU_MAX = 420;
/** Below this much room under the bar, the menu opens above it instead. */
const MENU_MIN_BELOW = 240;
/** The menu's gap from the bar, and its margin from the viewport edge. */
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 12;

type MenuFit = { maxHeight: number; above: boolean };

/** What choosing a menu row does. */
type RowAction =
  | { type: 'preset'; preset: AskAiPreset }
  | { type: 'apply'; how: 'replace' | 'below' | 'note' }
  | { type: 'copy' }
  | { type: 'retry' }
  | { type: 'discard' };

/** A row of the menu under the prompt bar: a suggestion or a result action. */
type MenuRow = {
  id: string;
  label: string;
  icon: ElementType;
  action: RowAction;
  hint?: string;
  submenu?: boolean;
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * Ask AI, the Notion AI way.
 *
 * A prompt bar anchored under the target, with a menu below it: suggestions
 * while the author decides what to ask, then — once the result is on screen —
 * what to do with it (Replace, Insert below, Try again, Discard), with the
 * bar staying live for a follow-up ("make it shorter"). A rewrite is shown
 * as a diff against the text it would replace; new content is shown as the
 * blocks it would become.
 *
 * Focus stays in the bar's input throughout; the menu is driven by
 * `aria-activedescendant`, like the slash menu.
 */
export function AskAiPanel({ target, onClose }: { target: AskAiTarget; onClose: () => void }) {
  const { documentId, doc, blocks: documentBlocks } = useEditorState();
  const {
    refs,
    ensureRemoteDocument,
    replaceBlocks,
    insertBlocksAfter,
    addParagraphChild,
    updateHtml,
    markRecentlyChanged,
  } = useEditorActions();
  const agentTools = useContext(AgentToolsContext);
  const engines = useAgentEngine();
  const [query, setQuery] = useState('');
  const [submenu, setSubmenu] = useState<AskAiPreset | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('prompt');
  const [result, setResult] = useState('');
  const [sources, setSources] = useState<AgentSource[]>([]);
  /** What the running request is doing, and since when; null when idle. */
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<AskAiPreset | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stopRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [menuFit, setMenuFit] = useState<MenuFit>({ maxHeight: MENU_MAX, above: false });
  const listId = useId();

  useEffect(() => markRange(target.range), [target.range]);
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  /**
   * Fit the menu to the room it has.
   *
   * It used to be a fixed 420px list hung under the bar, so on an ordinary
   * laptop screen its lower half was off the bottom and the last suggestions
   * could only be reached by scrolling the page. Now: if the menu would not
   * fit below, the canvas scrolls the bar up (no higher than about a third of
   * the viewport, so the text and any preview above it stay in view); the
   * menu then takes the height that is left, and when even that is cramped —
   * at the very end of a page — it opens above the bar instead.
   */
  const fitMenu = useCallback((allowScroll: boolean) => {
    const bar = barRef.current;
    if (!bar) return;
    const wanted = Math.min(MENU_MAX, listRef.current?.scrollHeight || MENU_MAX);
    const scroller = bar.closest<HTMLElement>('.canvas');
    const ceiling = (scroller?.getBoundingClientRect().top ?? 0) + VIEWPORT_MARGIN;
    const rect = bar.getBoundingClientRect();
    let top = rect.top;
    let bottom = rect.bottom;
    const room = () => window.innerHeight - bottom - MENU_GAP - VIEWPORT_MARGIN;

    if (allowScroll && scroller && room() < wanted) {
      const shift = Math.min(wanted - room(), top - Math.max(ceiling, window.innerHeight * 0.35));
      const possible = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      const by = Math.min(shift, possible);
      if (by > 0) {
        scroller.scrollBy({ top: by, behavior: 'auto' });
        // Fitted to where the bar will be; the scroll listener re-fits on the way.
        top -= by;
        bottom -= by;
      }
    }

    const below = room();
    const aboveRoom = top - ceiling - MENU_GAP;
    const above = below < Math.min(wanted, MENU_MIN_BELOW) && aboveRoom > below;
    const maxHeight = Math.max(120, Math.min(MENU_MAX, above ? aboveRoom : below));
    setMenuFit((current) =>
      current.maxHeight === maxHeight && current.above === above ? current : { maxHeight, above },
    );
  }, []);

  const citationsEnabled = agentTools?.isToolEnabled('search_citations') ?? false;
  const options = useMemo(() => {
    const figure = target.figure === true;
    const base = submenu?.children ? [...submenu.children] : presetsFor(target.kind, query, figure);
    const usable = base.filter((option) => !option.citations || citationsEnabled);
    // Typing something that is not a preset makes it the instruction.
    if (!submenu && query.trim()) return [customPreset(query.trim(), target.kind, figure), ...usable];
    if (submenu) return usable;
    // In the order the groups are drawn, so the arrow keys walk the list as seen.
    const order = presetGroupsFor(target.kind).map((group) => group.id);
    return usable.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  }, [submenu, target.kind, target.figure, query, citationsEnabled]);

  const blocks = useMemo(
    () =>
      preset
        ? resultBlocks({ text: result, citationTags: preset.citations === true, citations: target.citations, sources })
        : [],
    [preset, result, target.citations, sources],
  );

  const focusBack = useCallback(() => {
    requestAnimationFrame(() => {
      const el = refs.current[target.anchorId];
      if (!el) return;
      el.focus({ preventScroll: true });
      restoreCaretOffset(el, Number.MAX_SAFE_INTEGER);
    });
  }, [refs, target.anchorId]);

  const close = useCallback((restoreFocus = true) => {
    abortRef.current?.abort();
    onClose();
    if (restoreFocus) focusBack();
  }, [focusBack, onClose]);

  const run = useCallback(
    async (chosen: AskAiPreset, previous?: string) => {
      if (chosen.children) {
        setSubmenu(chosen);
        setActiveIndex(0);
        setQuery('');
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setPreset(chosen);
      setPhase('running');
      setResult('');
      setSources([]);
      setError(null);
      // Nothing is written yet, so this is not "writing": the model reads
      // the passage (and a citation preset searches) before the first word.
      setProgress({
        phase: chosen.citations ? 'tool' : 'thinking',
        label: chosen.citations ? 'Searching for sources…' : 'Thinking…',
        since: Date.now(),
      });
      setQuery('');
      setSubmenu(null);
      setActiveIndex(0);

      const docId = documentId ?? (await ensureRemoteDocument());
      if (!docId) {
        setPhase('error');
        setError('The document could not be saved, so the assistant cannot see it yet.');
        return;
      }

      let text = '';
      let failed: string | null = null;
      const engineRequest = engines.requestFor('inline');
      const moveTo = (next: Pick<AgentProgress, 'phase' | 'label'>) => {
        if (!controller.signal.aborted) setProgress((current) => advanceProgress(current, next));
      };
      try {
        const outcome = await streamAgentChat(
          {
            message: buildAskAiMessage({
              preset: chosen,
              target: target.kind,
              markdown: target.markdown,
              anchorText: target.anchorText,
              previous,
              // Compiled now, from the source the passage quotes, so the
              // line numbers match what the model reads.
              problems:
                chosen.id === 'figure-fix' && target.figure && target.diffBase?.type === 'code'
                  ? figureProblems(target.diffBase.text)
                  : undefined,
            }),
            document_id: docId,
            mode: 'rewrite',
            ephemeral: true,
            ...engineRequest,
          },
          {
            onToken: (token) => {
              text += token;
              setResult(text);
              setProgress({ phase: 'writing', label: 'Writing…', since: Date.now() });
            },
            onSources: (found) => setSources((current) => [...current, ...found]),
            onReasoning: () => moveTo({ phase: 'thinking', label: 'Thinking…' }),
            onStatus: (state, detail) => {
              const next = progressForStatus(state, detail);
              if (next) moveTo(next);
            },
            onToolCallStart: (tool) => moveTo({ phase: 'tool', label: `${toolRunningLabel(tool)}…` }),
            onToolCallEnd: () => {
              // Back to the model; an end that trails the answer (a duplicate
              // one) must not relabel text that is already streaming.
              if (!controller.signal.aborted) {
                setProgress((current) =>
                  current?.phase === 'tool' ? advanceProgress(current, { phase: 'thinking', label: 'Thinking…' }) : current,
                );
              }
            },
            onError: (code, message) => {
              failed = message;
              engines.noteRunError(code);
            },
          },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (failed || outcome.terminal !== 'done') {
          setPhase('error');
          setError(failed ?? 'The connection closed before the assistant finished.');
          return;
        }
        setPhase('done');
        setProgress(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setPhase('error');
        setError(caught instanceof Error ? caught.message : 'The assistant could not be reached.');
      }
    },
    [documentId, engines, ensureRemoteDocument, target],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setPhase(result ? 'done' : 'prompt');
    setProgress(null);
    setActiveIndex(0);
  }, [result]);

  /** Put the result into the document. */
  const apply = useCallback(
    (how: 'replace' | 'below' | 'note') => {
      if (blocks.length === 0) return;
      let inserted: string[];
      if (how === 'note') {
        inserted = insertBlocksAfter(target.anchorId, asNotes(blocks));
      } else if (how === 'below' && target.kind !== 'empty') {
        inserted = insertBlocksAfter(target.anchorId, blocks);
      } else if (target.kind === 'selection' && target.range) {
        const [blockId] = target.blockIds;
        const el = refs.current[blockId];
        const range = target.range;
        const intact = el && range.startContainer.isConnected && el.contains(range.commonAncestorContainer);
        const single = blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].variant;
        if (intact && el) {
          // A selection made by double-click or drag often carries the space
          // after the last word; the reply comes back trimmed. Keep the
          // selection's own edges so the sentence does not run together.
          const selected = range.toString();
          const lead = /^\s*/.exec(selected)?.[0] ?? '';
          const trail = /\s*$/.exec(selected)?.[0] ?? '';
          range.deleteContents();
          if (single && blocks[0].type === 'paragraph') {
            // One paragraph back: it takes the selection's place in the
            // sentence, widgets and all.
            const template = document.createElement('template');
            template.innerHTML = blocks[0].html;
            if (lead) template.content.prepend(lead);
            if (trail) template.content.append(trail);
            for (const child of blocks[0].children ?? []) addParagraphChild(blockId, child);
            range.insertNode(template.content);
            updateHtml(blockId, serializeEditableHtml(el as HTMLDivElement));
            inserted = [blockId];
          } else {
            updateHtml(blockId, serializeEditableHtml(el as HTMLDivElement));
            inserted = insertBlocksAfter(blockId, blocks);
          }
        } else {
          inserted = insertBlocksAfter(target.anchorId, blocks);
        }
      } else {
        inserted = replaceBlocks(target.blockIds, blocks);
      }
      markRecentlyChanged(inserted);
      onClose();
      const last = inserted[inserted.length - 1];
      if (last) {
        requestAnimationFrame(() => {
          const el = refs.current[last];
          if (!el) return;
          el.focus({ preventScroll: true });
          restoreCaretOffset(el, Number.MAX_SAFE_INTEGER);
        });
      }
    },
    [addParagraphChild, blocks, insertBlocksAfter, markRecentlyChanged, onClose, refs, replaceBlocks, target, updateHtml],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(result);
    } catch {
      /* the text is still on screen to select by hand */
    }
  }, [result]);

  const use = preset?.use ?? 'replace';
  const canReplace = !target.locked;
  const primary: 'replace' | 'below' | 'note' =
    use === 'note' ? 'note' : use === 'insert' || !canReplace ? 'below' : 'replace';
  const empty = blocks.length === 0;

  /** The rows of the menu under the bar, for the current phase. */
  const rows: MenuRow[] = useMemo(() => {
    if (phase === 'prompt') {
      return options.map((option) => ({
        id: option.id,
        label: option.id === 'custom' ? `Ask AI: “${option.label}”` : option.label,
        icon: option.icon,
        submenu: Boolean(option.children),
        action: { type: 'preset', preset: option },
      }));
    }
    if (phase === 'running') return [];
    const retry: MenuRow = { id: 'retry', label: 'Try again', icon: RotateCcw, action: { type: 'retry' }, disabled: !preset };
    const discard: MenuRow = {
      id: 'discard',
      label: 'Discard',
      icon: Trash2,
      action: { type: 'discard' },
      destructive: true,
      hint: 'Esc',
    };
    if (phase === 'error') return [retry, discard];

    const actions: MenuRow[] = [];
    if (primary === 'replace') {
      actions.push({
        id: 'replace',
        label: target.kind === 'selection' ? 'Replace selection' : 'Replace',
        icon: Check,
        action: { type: 'apply', how: 'replace' },
        hint: modEnterLabel(),
        disabled: empty,
      });
    }
    if (primary === 'note') {
      actions.push({
        id: 'note',
        label: 'Insert as note',
        icon: StickyNote,
        action: { type: 'apply', how: 'note' },
        hint: modEnterLabel(),
        disabled: empty,
      });
    }
    actions.push({
      id: 'below',
      label: target.kind === 'empty' ? 'Insert' : 'Insert below',
      icon: ArrowDownToLine,
      action: { type: 'apply', how: 'below' },
      hint: primary === 'below' ? modEnterLabel() : undefined,
      disabled: empty,
    });
    if (primary === 'note') actions.push({ id: 'copy', label: 'Copy', icon: Copy, action: { type: 'copy' } });
    return [...actions, retry, discard];
  }, [empty, options, phase, preset, primary, target.kind]);

  // Fit (and make room) whenever the menu appears or changes length; keep it
  // fitted while the page scrolls or the window resizes.
  const hasMenu = rows.length > 0;
  useLayoutEffect(() => {
    if (hasMenu) fitMenu(true);
  }, [fitMenu, hasMenu, phase, submenu, rows.length]);
  useEffect(() => {
    if (!hasMenu) return;
    const refit = () => fitMenu(false);
    window.addEventListener('scroll', refit, true);
    window.addEventListener('resize', refit);
    return () => {
      window.removeEventListener('scroll', refit, true);
      window.removeEventListener('resize', refit);
    };
  }, [fitMenu, hasMenu]);

  // The arrow keys move a highlight the list has to follow: the active row
  // used to walk off the bottom of the menu with nothing visible highlighted.
  useEffect(() => {
    if (!hasMenu) return;
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, hasMenu, listId]);

  const choose = (row: MenuRow | undefined) => {
    if (!row || row.disabled) return;
    const { action } = row;
    if (action.type === 'preset') void run(action.preset);
    else if (action.type === 'apply') apply(action.how);
    else if (action.type === 'copy') void copy();
    else if (action.type === 'retry') {
      if (preset) void run(preset);
    } else close();
  };

  type PanelKey = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'preventDefault' | 'stopPropagation'>;
  /**
   * A typed prompt as a preset. On a figure it asks for the figure back, and
   * so does a refinement of a result that was a figure ("add a legend" after
   * "Draw as a figure"): without that the model is told to answer in prose.
   */
  const freeform = (prompt: string, refining: boolean): AskAiPreset => {
    const typed = customPreset(prompt, target.kind, target.figure === true);
    return refining && preset?.drawsFigure ? { ...typed, drawsFigure: true } : typed;
  };

  const onKeyDown = (event: PanelKey) => {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (phase === 'running') stop();
      else if (submenu) setSubmenu(null);
      else close();
      return;
    }
    if (phase === 'done' && mod && event.key === 'Enter') {
      event.preventDefault();
      apply(primary);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (rows.length ? (index + step + rows.length) % rows.length : 0));
      return;
    }
    if (phase === 'prompt' && event.key === 'ArrowRight' && rows[activeIndex]?.submenu) {
      event.preventDefault();
      choose(rows[activeIndex]);
      return;
    }
    if ((event.key === 'ArrowLeft' || (event.key === 'Backspace' && !query)) && submenu) {
      event.preventDefault();
      setSubmenu(null);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      // Text typed after a result is a refinement of it.
      if (phase !== 'prompt' && query.trim() && preset) {
        void run(freeform(query.trim(), true), result);
        return;
      }
      choose(rows[activeIndex]);
    }
  };

  // A preset chosen by the entry point runs straight away, and whatever is
  // running stops when the panel goes. One effect for both, so a remount (as
  // StrictMode rehearses) aborts the first run and starts it again rather
  // than leaving the panel stuck on a progress line with nothing behind it.
  const runRef = useRef(run);
  useLayoutEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    const found = target.preset ? ASK_AI_PRESETS.find((candidate) => candidate.id === target.preset) : undefined;
    if (found) void runRef.current(found);
    return () => abortRef.current?.abort();
  }, [target.preset]);

  /**
   * Keep focus in the panel across a run.
   *
   * While the assistant writes, the bar's input gives way to the Stop button
   * — and focus used to go with it, to <body>, and never come back: the
   * result menu then showed "Replace selection" highlighted while the arrow
   * keys, Enter, Ctrl+Enter and Esc all went nowhere. Focus now moves to Stop
   * for the run and back to the follow-up field (whose active option is the
   * first action) the moment the run ends, however it ends.
   */
  const previousPhase = useRef<Phase>(phase);
  useLayoutEffect(() => {
    const was = previousPhase.current;
    previousPhase.current = phase;
    if (was === phase) return;
    const active = document.activeElement;
    const adrift = !active || active === document.body || Boolean(panelRef.current?.contains(active));
    if (!adrift) return;
    if (phase === 'running') stopRef.current?.focus({ preventScroll: true });
    else if (was === 'running') inputRef.current?.focus({ preventScroll: true });
  }, [phase]);

  /**
   * A safety net for a stray blur: if focus falls to <body> while the panel
   * is open, Escape still closes (or stops) it and Mod+Enter still applies —
   * and any navigation key brings focus back to the field it belongs in.
   * Keys aimed anywhere else (the page, another field) are left alone.
   */
  const keyHandlerRef = useRef(onKeyDown);
  useLayoutEffect(() => {
    keyHandlerRef.current = onKeyDown;
  });
  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const mod = event.metaKey || event.ctrlKey;
      const handled =
        event.key === 'Escape' ||
        (mod && event.key === 'Enter') ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter';
      if (!handled) return;
      keyHandlerRef.current(event);
      // After React has applied what the key did: a closed panel has no field
      // to return to, and a finished run has swapped Stop for the input.
      queueMicrotask(() => {
        const home = inputRef.current ?? stopRef.current;
        if (home?.isConnected && (!document.activeElement || document.activeElement === document.body)) {
          home.focus({ preventScroll: true });
        }
      });
    };
    document.addEventListener('keydown', onDocumentKeyDown, true);
    return () => document.removeEventListener('keydown', onDocumentKeyDown, true);
  }, []);

  const scope =
    target.kind === 'selection'
      ? 'Selection'
      : target.kind === 'blocks'
        ? `${target.blockIds.length} blocks`
        : target.kind === 'block'
          ? 'This block'
          : null;
  const placeholder =
    phase === 'done' || phase === 'error'
      ? 'Tell AI what to do next…'
      : submenu
        ? `${submenu.label}…`
        : target.kind === 'empty'
          ? 'Ask AI anything…'
          : 'Ask AI to edit or explain…';

  // A rewrite of one block reads best as a diff against what it replaces;
  // anything structural (a list, several blocks) is shown as the new blocks.
  const showDiff =
    phase === 'done' &&
    primary === 'replace' &&
    target.kind !== 'empty' &&
    target.kind !== 'blocks' &&
    blocks.length === 1 &&
    (blocks[0].type === 'heading' || (blocks[0].type === 'paragraph' && !blocks[0].variant));

  const sections: Array<{ id: string; label: string; rows: MenuRow[] }> =
    phase !== 'prompt'
      ? [{ id: 'result', label: '', rows }]
      : submenu || query.trim()
        ? [{ id: 'flat', label: submenu ? submenu.label : '', rows }]
        : presetGroupsFor(target.kind).map((group) => ({
            id: group.id,
            label: group.label,
            rows: rows.filter((_, index) => options[index]?.group === group.id),
          }));

  // Citations the result adds are numbered as they would be once applied, so
  // the preview prints "[2]" exactly where the page will.
  const bibliography = useMemo(
    () =>
      blocks.length === 0
        ? null
        : previewBibliography(
            documentBlocks,
            blocks,
            primary === 'replace' && target.kind !== 'selection' ? { replace: target.blockIds } : { after: target.anchorId },
            { library: doc.sources, style: doc.citationStyle ?? null },
          ),
    [blocks, doc.citationStyle, doc.sources, documentBlocks, primary, target.anchorId, target.blockIds, target.kind],
  );

  const hasResult = blocks.length > 0 || Boolean(error) || (phase === 'done' && empty);
  const canSend = query.trim().length > 0;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Ask AI"
      className="ask-ai-panel relative mb-2 mt-1"
      style={{ marginLeft: 'var(--doc-gutter)' }}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {hasResult && (
        <div
          className="mb-2 max-h-[50vh] overflow-y-auto border-l-2 border-ai/50 py-1 pl-4 pr-1"
          aria-live="off"
        >
          {showDiff ? (
            <ProposedRewriteView
              before={target.diffBase ?? target.text}
              after={blocks[0]}
              block={blocks[0]}
              bibliography={bibliography}
            />
          ) : blocks.length > 0 ? (
            <div className="space-y-1.5">
              {blocks.map((block) => (
                <ProposedBlockView key={block.id} block={block} bibliography={bibliography} />
              ))}
            </div>
          ) : null}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {phase === 'done' && empty && !error && (
            <p className="text-sm text-muted-foreground">The assistant returned nothing to insert.</p>
          )}
        </div>
      )}

      {/* The prompt bar, and the menu hung from it. */}
      <div className="relative">
        <div ref={barRef} className="flex min-h-11 items-center gap-2 rounded-lg bg-popover px-3 shadow-md ring-1 ring-ai/25">
          <Sparkles aria-hidden="true" className={cn('size-[18px] shrink-0 text-ai', phase === 'running' && 'animate-pulse')} />
          {phase === 'running' ? (
            <>
              {progress ? (
                <AgentStatusLine
                  progress={progress}
                  tone="ai"
                  className="flex-1 text-sm"
                  whileWriting={
                    <p role="status" className="min-w-0 flex-1 truncate text-sm text-ai">
                      <span className="animate-shimmer">Writing…</span>
                    </p>
                  }
                />
              ) : (
                <p role="status" className="min-w-0 flex-1 truncate text-sm text-ai">
                  <span className="animate-shimmer">Thinking…</span>
                </p>
              )}
              <button
                ref={stopRef}
                type="button"
                onClick={stop}
                aria-keyshortcuts="Escape"
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
              >
                <Square aria-hidden="true" className="size-3 fill-current" />
                Stop
                <span className="text-xs text-placeholder">Esc</span>
              </button>
            </>
          ) : (
            <>
              {submenu && (
                <button
                  type="button"
                  aria-label="Back"
                  onClick={() => setSubmenu(null)}
                  className="-ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"
                >
                  <ChevronLeft aria-hidden="true" className="size-4" />
                </button>
              )}
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                placeholder={placeholder}
                aria-label="Ask AI"
                role="combobox"
                aria-expanded={rows.length > 0}
                aria-controls={listId}
                aria-activedescendant={rows[activeIndex] ? `${listId}-${activeIndex}` : undefined}
                className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-placeholder"
              />
              {scope && phase === 'prompt' && (
                <span className="hidden shrink-0 rounded-sm bg-ai/10 px-1.5 py-0.5 text-xs text-ai sm:inline">
                  {scope}
                </span>
              )}
              <button
                type="button"
                disabled={!canSend}
                aria-label="Send"
                onClick={() => {
                  if (!canSend) return;
                  const refining = phase !== 'prompt';
                  void run(freeform(query.trim(), refining), refining ? result : undefined);
                }}
                className={cn(
                  'inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
                  canSend ? 'bg-ai-strong text-ai-foreground hover:bg-ai-strong/90' : 'bg-subtle text-placeholder',
                )}
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </button>
            </>
          )}
        </div>

        {/* Suggestions or result actions, floating over the text below like any
            menu, so the document does not reflow as the list changes. */}
        {rows.length > 0 && (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={phase === 'prompt' ? 'Suggestions' : 'Result actions'}
            data-side={menuFit.above ? 'top' : 'bottom'}
            className={cn(
              menuSurface,
              'absolute left-0 z-[var(--z-popover)] w-80 max-w-full overflow-y-auto overscroll-contain',
              menuFit.above ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            )}
            style={{ maxHeight: menuFit.maxHeight }}
          >
            {sections.map((section, sectionIndex) => {
              if (section.rows.length === 0) return null;
              return (
                <div key={section.id} role="group" aria-label={section.label || 'Suggestions'}>
                  {sectionIndex > 0 && phase === 'prompt' && !submenu && !query.trim() && (
                    <div role="separator" className={menuSeparator} />
                  )}
                  {section.label && !submenu && <div className={menuLabel}>{section.label}</div>}
                  {section.rows.map((row) => {
                    const index = rows.indexOf(row);
                    const active = index === activeIndex;
                    return (
                      <div
                        key={`${row.id}-${index}`}
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={active}
                        aria-disabled={row.disabled || undefined}
                        data-highlighted={active ? '' : undefined}
                        data-disabled={row.disabled ? '' : undefined}
                        className={cn(
                          menuItem,
                          'hover:bg-transparent [&>svg]:text-ai',
                          row.destructive && cn(menuItemDestructive, '[&>svg]:text-destructive'),
                        )}
                        onMouseMove={() => {
                          if (!active) setActiveIndex(index);
                        }}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          choose(row);
                        }}
                      >
                        <row.icon aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{row.label}</span>
                        {row.submenu && <ChevronRight aria-hidden="true" className="!text-muted-foreground" />}
                        {row.hint && <span className="ml-auto pl-4 text-xs text-muted-foreground">{row.hint}</span>}
                        {!row.hint && !row.submenu && active && (
                          <CornerDownLeft aria-hidden="true" className="ml-auto !size-3.5 !text-muted-foreground" />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        {phase === 'prompt' && options.length === 0 && (
          <p className={cn(menuSurface, 'absolute left-0 top-full z-[var(--z-popover)] mt-1.5 w-80 max-w-full px-3 py-2 text-sm text-muted-foreground')}>
            No suggestion matches — press Enter to ask anyway.
          </p>
        )}
      </div>
      {target.locked && phase === 'done' && (
        <p className="mt-1.5 text-xs text-muted-foreground">Locked blocks are never replaced.</p>
      )}
    </div>
  );
}
