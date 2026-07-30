import { useEffect, type ReactElement, type ReactNode } from 'react';
import { Button, ToastProvider } from 'colwrite-ui';
import { Save } from 'lucide-react';

type ToastOptions = {
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'error' | 'warning';
  duration?: number;
};

/**
 * Nothing is visible until something calls the hook, so each cell fires real
 * toasts on mount.
 *
 * In app code a child component calls `useToast()` and gets `{ toast, dismiss }`
 * from context. `useToast` is not on the preview bundle's global yet (only
 * `ToastProvider` is — see .design-sync/learnings/F-feedback.md), so this reads
 * the very same value off the element the provider returns. Everything below the
 * provider is the real component: the portal, the stack, the toast cards.
 */
function ToastStage({ fire, children }: { fire: ToastOptions[]; children: ReactNode }) {
  const asFn = ToastProvider as unknown as (props: { children: ReactNode }) => ReactElement<{
    value: { toast: (options: ToastOptions) => string };
  }>;
  const tree = asFn({ children });
  const { toast } = tree.props.value;
  useEffect(() => {
    // The long duration only holds the toast on screen for a static capture.
    // Real callers leave `duration` unset: 4s, or 8s for `error`.
    fire.forEach((options) => toast({ duration: 60_000, ...options }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return tree;
}

/** The surface the toasts float above — a document the author just saved. */
function DocumentSurface() {
  return (
    <div className="w-full max-w-xl rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-md font-semibold">Attention Is All You Need, Revisited</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            8 sections · 14 references · last saved 2 minutes ago
          </p>
        </div>
        <Button size="sm" variant="outline">
          <Save />
          Save
        </Button>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        We revisit the original transformer formulation under modern training budgets and show
        that the reported scaling behaviour holds only once the learning-rate schedule is
        decoupled from the batch size.
      </p>
    </div>
  );
}

export function SavedSuccess() {
  return (
    <ToastStage fire={[{ title: 'Document saved', variant: 'success' }]}>
      <DocumentSurface />
    </ToastStage>
  );
}

export function SaveFailed() {
  return (
    <ToastStage
      fire={[
        {
          title: 'Save failed',
          description: 'The server returned 502. Your draft is still in the editor.',
          variant: 'error',
        },
      ]}
    >
      <DocumentSurface />
    </ToastStage>
  );
}

export function PlainNote() {
  return (
    <ToastStage
      fire={[
        {
          title: 'Renamed locally, but the save failed',
          description: 'The new title is in the editor and will be sent with the next save.',
        },
      ]}
    >
      <DocumentSurface />
    </ToastStage>
  );
}

export function StackedVariants() {
  return (
    <ToastStage
      fire={[
        { title: 'Autosave paused', description: 'You are offline.', variant: 'warning' },
        { title: 'Document saved', variant: 'success' },
        {
          title: 'Could not load more documents',
          description: 'Request failed after 3 retries.',
          variant: 'error',
        },
      ]}
    >
      <DocumentSurface />
    </ToastStage>
  );
}
