import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code,
  FileText,
  Italic,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Quote,
  RotateCcw,
  Sparkles,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ASK_AI_PRESETS, presetGroupsFor } from '@/components/editor/AskAi/presets';
import { Badge } from '@/components/ui/badge';
import { toolMeta, type ToolMeta } from '@/components/panels/toolsConfig';
import {
  menuItem,
  menuItemDestructive,
  menuLabel,
  menuSeparator,
  menuShortcut,
  menuSurface,
} from '@/components/ui/menuStyles';

/**
 * Static, non-interactive replicas of real editor UI (page topbar, review
 * pill, suggested changes, selection toolbar, Ask AI, the right sidebar). They are
 * deliberately built from spans and the same tokens the app uses, so the
 * landing page stays honest about what the product looks like.
 */

/* ----------------------------------------
   Shared bits
   ---------------------------------------- */

/** A span styled like the app's small buttons — looks real, steals no focus. */
function MockButton({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A citation as the page draws it: quiet bracketed text, no box. */
export function CitationPill({ children }: { children: ReactNode }) {
  return <span className="text-[0.9em] text-muted-foreground">{children}</span>;
}

export function EquationChip({ children }: { children: ReactNode }) {
  return <span className="font-serif italic text-foreground">{children}</span>;
}

/* ----------------------------------------
   Review pill — mirrors Review/ReviewPill.tsx
   ---------------------------------------- */

const REVIEW_ROWS = [
  { icon: Pencil, label: 'Rewrite paragraph in “Introduction”' },
  { icon: Plus, label: 'Add paragraph after “Introduction”' },
  { icon: Plus, label: 'Add a contribution to the list' },
];

/** The "3 suggestions" pill in the page topbar, with its review menu open. */
export function ReviewPillMock({ className }: { className?: string }) {
  const count = REVIEW_ROWS.length;
  return (
    <div className={cn('flex w-72 max-w-full flex-col items-end gap-1.5', className)}>
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-ai/15 pl-2.5 pr-2 text-sm font-medium text-ai">
        <Sparkles aria-hidden="true" className="size-3.5" />
        <span className="tabular-nums">{count} suggestions</span>
        <ChevronDown aria-hidden="true" className="size-3.5 rotate-180 opacity-70" />
      </span>
      <div className={cn(menuSurface, 'w-full')}>
        <div className="flex h-8 items-center gap-1 pl-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{count} suggestions</span>
          <ChevronLeft aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="min-w-[3.25rem] text-center text-xs tabular-nums text-muted-foreground">1 of {count}</span>
          <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
        </div>
        <div aria-hidden="true" className={menuSeparator} />
        {REVIEW_ROWS.map((row, index) => (
          <div key={row.label} className={cn(menuItem, 'cursor-default', index === 0 && 'bg-active')}>
            <row.icon aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
          </div>
        ))}
        <div aria-hidden="true" className={menuSeparator} />
        <div className="flex items-center gap-1 text-sm">
          <span className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md font-medium text-diff-add-fg">
            <Check aria-hidden="true" className="size-4" />
            Accept all
          </span>
          <span className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-muted-foreground">
            <X aria-hidden="true" className="size-4" />
            Reject all
          </span>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------
   Suggested change — mirrors Review/ChangeCard.tsx
   ---------------------------------------- */

const CHANGE_KINDS = {
  insert: { rail: 'bg-diff-add-border', label: 'Suggested addition', tint: 'bg-diff-add/60', icon: Plus },
  replace: { rail: 'bg-ai/60', label: 'Suggested rewrite', tint: '', icon: Pencil },
} as const;

/**
 * A suggested change where it lands in the page: a coloured rail, a quiet
 * label, and accept/reject icons — or, when it depends on another change,
 * the lock and the reason instead.
 */
export function ChangeCardMock({
  kind,
  locked = false,
  className,
  children,
}: {
  kind: keyof typeof CHANGE_KINDS;
  locked?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const style = CHANGE_KINDS[kind];
  return (
    <div className={cn('relative rounded-md py-1 pl-4 pr-2', style.tint, className)}>
      <span aria-hidden="true" className={cn('absolute bottom-1 left-1.5 top-1 w-0.5 rounded-full', style.rail)} />
      <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <style.icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0">{style.label}</span>
        {locked ? (
          <span className="flex min-w-0 items-center gap-1 truncate">
            <span aria-hidden="true">·</span>
            <Lock aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="truncate">Accept the one above first</span>
          </span>
        ) : (
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <span className="grid h-6 w-6 place-items-center rounded-md text-diff-add-fg">
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
            <span className="grid h-6 w-6 place-items-center rounded-md">
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
          </span>
        )}
      </div>
      <div className="pt-0.5">{children}</div>
    </div>
  );
}

/** Word-level diff body, mirroring the WordDiff inside ChangeCard. */
export function RewriteDiffBody() {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      <span className="rounded-sm bg-diff-remove text-diff-remove-fg line-through decoration-1">
        In this paper, we
      </span>{' '}
      <span className="rounded-sm bg-diff-add text-diff-add-fg">We</span>
      <span className="text-muted-foreground"> show that sparse routing lets models scale </span>
      <span className="rounded-sm bg-diff-remove text-diff-remove-fg line-through decoration-1">
        without a matching increase in
      </span>{' '}
      <span className="rounded-sm bg-diff-add text-diff-add-fg">sublinearly in</span>
      <span className="text-muted-foreground"> compute.</span>
    </p>
  );
}

/* ----------------------------------------
   Selection toolbar — mirrors FloatingToolbar.tsx
   ---------------------------------------- */

function ToolbarDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />;
}

export function SelectionToolbarMock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex w-fit items-center gap-0.5 rounded-lg bg-popover p-1 shadow-lg [&_svg]:h-4 [&_svg]:w-4',
        className,
      )}
    >
      <MockButton className="text-ai">
        <Sparkles aria-hidden="true" />
        Ask AI
      </MockButton>
      <ToolbarDivider />
      <MockButton className="text-foreground/90">
        Text
        <ChevronDown aria-hidden="true" />
      </MockButton>
      <ToolbarDivider />
      {[Bold, Italic, Underline, Strikethrough, Code, Link2].map((Icon, index) => (
        <span key={index} className="grid h-7 w-7 place-items-center rounded-md text-foreground/90">
          <Icon aria-hidden="true" />
        </span>
      ))}
      <ToolbarDivider />
      <MockButton className="text-foreground/90">
        <Quote aria-hidden="true" />
        Cite
      </MockButton>
      <span className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground">
        <MoreHorizontal aria-hidden="true" />
      </span>
    </div>
  );
}

/* ----------------------------------------
   Editor window — the hero visual
   ---------------------------------------- */

export function EditorMock() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-xl">
      {/* Page topbar — breadcrumb and save state, as in PageTopbar */}
      <div className="flex h-11 items-center gap-2 px-4">
        <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="truncate text-sm">Sparse Routing for Long-Context Pretraining</p>
        <p className="shrink-0 text-xs text-muted-foreground">Saved</p>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-ai/15 px-2 py-1 text-xs font-medium text-ai">
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="tabular-nums">1 suggestion</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 px-1 text-xs font-medium text-ai">
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
          Ask AI
        </span>
        <MoreHorizontal aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      <div className="space-y-4 px-5 pb-6 pt-3 sm:px-10">
        <p className="text-2xl font-bold tracking-tight">Sparse Routing for Long-Context Pretraining</p>
        <p className="text-lg font-semibold tracking-tight">Introduction</p>

        <p className="text-sm leading-relaxed">
          Mixture-of-experts layers route each token to a small subset of feed-forward
          networks, decoupling parameter count from per-token compute{' '}
          <CitationPill>[1]</CitationPill>.
        </p>

        <div>
          <SelectionToolbarMock className="mb-2" />
          <p className="text-sm leading-relaxed">
            <span className="rounded-sm bg-selection">
              In this paper, we show that sparse routing lets models scale without a matching
              increase in compute.
            </span>
          </p>
        </div>

        <ChangeCardMock kind="replace">
          <RewriteDiffBody />
        </ChangeCardMock>

        <p className="text-sm leading-relaxed">
          Section 3 details the gating objective <EquationChip>y = Σᵢ Gᵢ(x)·Eᵢ(x)</EquationChip>{' '}
          and the load-balancing loss used throughout training <CitationPill>[2]</CitationPill>.
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------
   Ask AI — mirrors AskAi.tsx: the prompt bar under the selection, and the
   menu hung from it (presets before a run, result actions after one)
   ---------------------------------------- */

function AskAiBarMock({ placeholder }: { placeholder: string }) {
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-lg bg-popover px-3 shadow-md ring-1 ring-ai/25">
      <Sparkles aria-hidden="true" className="size-[18px] shrink-0 text-ai" />
      <span className="min-w-0 flex-1 truncate text-sm text-placeholder">{placeholder}</span>
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-placeholder">
        <ArrowUp aria-hidden="true" className="size-4" />
      </span>
    </div>
  );
}

/** The top-level presets Ask AI offers on a selection, in its own groups. */
const SELECTION_PRESETS = ASK_AI_PRESETS.filter((preset) => preset.applies.includes('selection'));

/** Ask AI opened on a selection: the bar, then every preset it offers. */
export function AiActionMenuMock() {
  return (
    <div className="w-full max-w-80 space-y-1.5">
      <AskAiBarMock placeholder="Ask AI to edit or explain…" />
      <div className={cn(menuSurface, 'w-full')}>
        {presetGroupsFor('selection').map((group, index) => {
          const presets = SELECTION_PRESETS.filter((preset) => preset.group === group.id);
          if (presets.length === 0) return null;
          return (
            <div key={group.id}>
              {index > 0 && <div aria-hidden="true" className={menuSeparator} />}
              <p className={menuLabel}>{group.label}</p>
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  className={cn(menuItem, 'cursor-default [&>svg]:text-ai', preset.id === 'improve' && 'bg-hover')}
                >
                  <preset.icon aria-hidden="true" />
                  {preset.label}
                  {preset.children && <ChevronRight aria-hidden="true" className="ml-auto" />}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const RESULT_ACTIONS = [
  { icon: Check, label: 'Replace selection', shortcut: 'Ctrl+↵' },
  { icon: ArrowDown, label: 'Insert below' },
  { icon: RotateCcw, label: 'Try again' },
  { icon: Trash2, label: 'Discard', shortcut: 'Esc', destructive: true },
];

/** After a run: the diff under the selection, a follow-up bar and the result actions. */
export function AskAiResultMock() {
  return (
    <div className="space-y-2">
      <div className="border-l-2 border-ai/50 py-1 pl-4 pr-1">
        <RewriteDiffBody />
      </div>
      <AskAiBarMock placeholder="Tell AI what to do next…" />
      <div className={cn(menuSurface, 'w-full max-w-72')}>
        {RESULT_ACTIONS.map((action, index) => (
          <div
            key={action.label}
            className={cn(
              menuItem,
              'cursor-default [&>svg]:text-ai',
              index === 0 && 'bg-hover',
              action.destructive && cn(menuItemDestructive, '[&>svg]:text-destructive'),
            )}
          >
            <action.icon aria-hidden="true" />
            {action.label}
            {action.shortcut && <span className={menuShortcut}>{action.shortcut}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------
   Right sidebar — mirrors the tab strip in panels/toolsAside
   ---------------------------------------- */

/** Labels and icons come from the real tool catalogue, so the mock follows it. */
const SIDEBAR_TABS = [
  { id: 'assistant' },
  { id: 'research', active: true },
  { id: 'sources', count: 3 },
  { id: 'history' },
] as const satisfies ReadonlyArray<{ id: ToolMeta['id']; active?: boolean; count?: number }>;

/** The right sidebar's tabs: one place for the assistant and every research tool. */
export function SidebarTabsMock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-lg bg-card p-1 shadow-sm ring-1 ring-border',
        className,
      )}
    >
      {SIDEBAR_TABS.map((tab) => {
        const meta = toolMeta(tab.id);
        const active = 'active' in tab && tab.active;
        return (
          <span
            key={tab.id}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium',
              active ? 'bg-active text-foreground' : 'text-muted-foreground',
            )}
          >
            <meta.icon
              aria-hidden="true"
              className={cn('size-4', tab.id === 'assistant' ? 'text-ai' : active ? 'text-foreground' : 'text-muted-foreground')}
            />
            {meta.label}
            {'count' in tab && <span className="text-xs font-normal tabular-nums text-muted-foreground">{tab.count}</span>}
          </span>
        );
      })}
    </div>
  );
}

/* ----------------------------------------
   Tool panel mini-mocks
   ---------------------------------------- */

const PAPERS = [
  {
    title: 'Mixture-of-Experts Meets Long Context: A Study',
    meta: 'Kaplan, Smith, +4 · arXiv:2401.12013',
    score: '96% match',
  },
  {
    title: 'Sparse Routing Without Load Imbalance',
    meta: 'Duarte, Wei · arXiv:2311.08872',
    score: '91% match',
  },
];

export function ArxivResultMock() {
  return (
    <div className="mt-3 space-y-2">
      {PAPERS.map((paper) => (
        <div key={paper.title} className="rounded-md border border-border bg-background/60 p-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium leading-snug">{paper.title}</p>
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              {paper.score}
            </Badge>
          </div>
          <p className="mt-1 text-2xs text-muted-foreground">{paper.meta}</p>
        </div>
      ))}
    </div>
  );
}

export function ColpaliResultMock() {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {[7, 12].map((page) => (
        <div
          key={page}
          className="relative rounded-md border border-border bg-background/60 p-2.5"
        >
          <Badge variant="secondary" className="absolute right-1.5 top-1.5 px-1.5 text-2xs">
            p. {page}
          </Badge>
          <div aria-hidden="true" className="space-y-1.5 pt-1">
            <div className="h-1 w-2/3 rounded-sm bg-border" />
            <div className="h-1 w-full rounded-sm bg-border/70" />
            <div className="h-1 w-5/6 rounded-sm bg-border/70" />
            <div className="h-6 w-full rounded-sm border border-border bg-subtle" />
            <div className="h-1 w-full rounded-sm bg-border/70" />
            <div className="h-1 w-3/4 rounded-sm bg-border/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

const LIBRARY_FILES = [
  { name: 'attention-is-all-you-need.pdf', size: '2.1 MB' },
  { name: 'switch-transformers.pdf', size: '1.4 MB' },
];

export function LibraryMock() {
  return (
    <div className="mt-3 space-y-2">
      {LIBRARY_FILES.map((file) => (
        <div
          key={file.name}
          className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-2"
        >
          <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="truncate text-xs">{file.name}</p>
          <p className="ml-auto shrink-0 text-2xs text-muted-foreground">{file.size}</p>
        </div>
      ))}
      <p className="text-2xs text-muted-foreground">
        Files stay in this browser session — drop PDFs in, preview them alongside the text.
      </p>
    </div>
  );
}
