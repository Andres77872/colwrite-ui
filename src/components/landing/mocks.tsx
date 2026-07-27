import type { ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  FileText,
  Lock,
  Plus,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AI_ACTION_REGISTRY, type AiActionGroup } from '@/config/aiActions';
import { Badge } from '@/components/ui/badge';

/**
 * Static, non-interactive replicas of real editor UI (document chrome, review
 * bar, change cards, floating toolbar, AI action menu, tool panels). They are
 * deliberately built from spans and the same tokens the app uses, so the
 * landing page stays honest about what the product looks like.
 */

/* ----------------------------------------
   Shared bits
   ---------------------------------------- */

/** A span styled like the app's small buttons — looks real, steals no focus. */
function MockButton({
  primary,
  className,
  children,
}: {
  primary?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium [&_svg]:h-3.5 [&_svg]:w-3.5',
        primary ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function CitationPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm bg-primary/15 px-1 text-[0.8em] font-medium text-primary">
      {children}
    </span>
  );
}

export function EquationChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm bg-primary/10 px-1 py-0.5 font-mono text-[0.8em] text-primary">
      {children}
    </span>
  );
}

/* ----------------------------------------
   Review bar — mirrors ReviewBar.tsx
   ---------------------------------------- */

export function ReviewBarMock({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
      <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
      <p className="text-sm font-medium">
        {count} suggested {count === 1 ? 'change' : 'changes'}
      </p>
      <p className="hidden text-xs text-muted-foreground md:block">
        Review each one in the document.
      </p>
      <div className="ml-auto flex items-center gap-1">
        <span className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
          <ChevronUp aria-hidden="true" />
        </span>
        <span className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
          <ChevronDown aria-hidden="true" />
        </span>
        <MockButton primary>
          <Check aria-hidden="true" />
          Accept all
        </MockButton>
        <MockButton>
          <X aria-hidden="true" />
          Reject all
        </MockButton>
      </div>
    </div>
  );
}

/* ----------------------------------------
   Change card — mirrors Review/ChangeCard.tsx
   ---------------------------------------- */

const CHANGE_KINDS = {
  insert: {
    accent: 'border-l-diff-add-border',
    badge: 'bg-diff-add text-diff-add-fg',
    label: 'Addition',
    Icon: Plus,
  },
  replace: {
    accent: 'border-l-primary',
    badge: 'bg-primary/15 text-primary',
    label: 'Rewrite',
    Icon: CornerDownRight,
  },
} as const;

export function ChangeCardMock({
  kind,
  description,
  locked = false,
  className,
  children,
}: {
  kind: keyof typeof CHANGE_KINDS;
  description: string;
  locked?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const style = CHANGE_KINDS[kind];
  return (
    <div
      className={cn(
        'rounded-lg border border-l-2 border-border bg-card/80 shadow-sm',
        style.accent,
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            style.badge,
          )}
        >
          <style.Icon aria-hidden="true" className="h-3 w-3" />
          {style.label}
        </span>
        <span className="text-xs text-muted-foreground">{description}</span>
        <span className="ml-auto flex items-center gap-1">
          {locked ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock aria-hidden="true" className="h-3 w-3" />
              Needs the change above
            </span>
          ) : (
            <>
              <MockButton className="text-diff-add-fg">
                <Check aria-hidden="true" />
                Accept
              </MockButton>
              <MockButton>
                <X aria-hidden="true" />
                Reject
              </MockButton>
            </>
          )}
        </span>
      </div>
      <div className="px-3 py-2">{children}</div>
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
      <span className="rounded-sm bg-diff-add text-diff-add-fg">
        We
      </span>
      <span className="text-muted-foreground"> show that sparse routing lets models scale </span>
      <span className="rounded-sm bg-diff-remove text-diff-remove-fg line-through decoration-1">
        without a matching increase in
      </span>{' '}
      <span className="rounded-sm bg-diff-add text-diff-add-fg">
        sublinearly in
      </span>
      <span className="text-muted-foreground"> compute.</span>
    </p>
  );
}

/* ----------------------------------------
   Floating toolbar — mirrors FloatingToolbar.tsx
   ---------------------------------------- */

export function SelectionToolbarMock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex w-fit items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg',
        className,
      )}
    >
      {['B', 'I', 'U', 'S'].map((label) => (
        <span
          key={label}
          className="grid h-7 w-7 place-items-center rounded-md text-xs font-medium text-foreground/90"
        >
          {label}
        </span>
      ))}
      <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
      <span className="inline-flex h-7 items-center gap-1 rounded-md bg-primary/10 px-2 text-xs font-medium text-primary">
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
        AI
      </span>
    </div>
  );
}

/* ----------------------------------------
   Editor window — the hero visual
   ---------------------------------------- */

export function EditorMock() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xl">
      {/* Document chrome — title + autosave status, as in DocumentHeader */}
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="truncate text-sm font-medium">
          Sparse Routing for Long-Context Pretraining
        </p>
        <p className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
          Autosaved 14:32
        </p>
      </div>

      <ReviewBarMock />

      <div className="space-y-4 px-4 py-5 sm:px-6">
        <p className="text-xl font-semibold tracking-tight">1&nbsp;&nbsp;Introduction</p>

        <p className="text-sm leading-relaxed text-foreground/80">
          Mixture-of-experts layers route each token to a small subset of feed-forward
          networks, decoupling parameter count from per-token compute{' '}
          <CitationPill>[1]</CitationPill>.
        </p>

        <div>
          <SelectionToolbarMock className="mb-2" />
          <p className="text-sm leading-relaxed text-foreground/80">
            <span className="rounded-sm bg-primary/30">
              In this paper, we show that sparse routing lets models scale without a matching
              increase in compute.
            </span>
          </p>
        </div>

        <ChangeCardMock kind="replace" description="Rewrite paragraph in “Introduction”">
          <RewriteDiffBody />
        </ChangeCardMock>

        <p className="text-sm leading-relaxed text-foreground/80">
          Section 3 details the gating objective <EquationChip>y = Σᵢ Gᵢ(x)·Eᵢ(x)</EquationChip>{' '}
          and the load-balancing loss used throughout training <CitationPill>[2]</CitationPill>.
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------
   AI action menu — renders the real registry
   ---------------------------------------- */

const ACTION_GROUPS: [AiActionGroup, string][] = [
  ['edit', 'Edit'],
  ['reference', 'Reference'],
  ['transform', 'Transform'],
];

export function AiActionMenuMock() {
  return (
    <div className="w-60 rounded-lg border border-border bg-popover p-1 shadow-lg">
      {ACTION_GROUPS.map(([group, label], index) => (
        <div key={group}>
          {index > 0 && <div aria-hidden="true" className="mx-2 my-1 h-px bg-border/60" />}
          <p className="px-2 pb-0.5 pt-1.5 text-2xs font-medium text-muted-foreground">{label}</p>
          {Object.values(AI_ACTION_REGISTRY)
            .filter((action) => action.group === group)
            .map((action) => (
              <div
                key={action.id}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  action.id === 'improve' && 'bg-accent',
                )}
              >
                <action.icon aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                {action.label}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------
   Inline AI suggestion — mirrors .ai-suggest
   ---------------------------------------- */

export function InlineSuggestMock() {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-sm leading-relaxed">
        <span className="line-through opacity-50">The results are quite good overall.</span>{' '}
        <span className="rounded-sm bg-primary/10 px-0.5 text-primary">
          The routed model outperforms the dense baseline by 4.2 points.
        </span>
        <span className="ml-1 inline-flex gap-1 align-middle">
          <span className="grid h-5 w-5 place-items-center rounded-sm border border-border/60 bg-success/15 text-success">
            <Check aria-hidden="true" className="h-3 w-3" />
          </span>
          <span className="grid h-5 w-5 place-items-center rounded-sm border border-border/60 bg-destructive/15 text-destructive">
            <X aria-hidden="true" className="h-3 w-3" />
          </span>
          <span className="grid h-5 w-5 place-items-center rounded-sm border border-border/60 bg-muted text-muted-foreground">
            <Square aria-hidden="true" className="h-3 w-3" />
          </span>
        </span>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        The saved document keeps the original until you accept the suggestion.
      </p>
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
        <div key={paper.title} className="rounded-md border border-border/60 bg-background/60 p-2.5">
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
          className="relative rounded-md border border-border/60 bg-background/60 p-2.5"
        >
          <Badge variant="secondary" className="absolute right-1.5 top-1.5 px-1.5 text-2xs">
            p. {page}
          </Badge>
          <div aria-hidden="true" className="space-y-1.5 pt-1">
            <div className="h-1 w-2/3 rounded-sm bg-border" />
            <div className="h-1 w-full rounded-sm bg-border/70" />
            <div className="h-1 w-5/6 rounded-sm bg-border/70" />
            <div className="h-6 w-full rounded-sm border border-border/50 bg-muted/40" />
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
          className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-2"
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
