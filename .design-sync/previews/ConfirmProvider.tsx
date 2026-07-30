import { useEffect, type ReactElement, type ReactNode } from 'react';
import { Button, ConfirmProvider } from 'colwrite-ui';
import { Save } from 'lucide-react';

type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/**
 * The provider renders nothing until something awaits `confirm(...)`, so each
 * cell opens one real confirmation on mount.
 *
 * In app code a handler calls `useConfirm()` and awaits the promise. `useConfirm`
 * is not on the preview bundle's global yet (only `ConfirmProvider` is — see
 * .design-sync/learnings/F-feedback.md), so this reads the same `confirm`
 * function off the element the provider returns. The dialog, the scrim and the
 * footer buttons are all the real component.
 */
function ConfirmStage({ ask, children }: { ask: ConfirmOptions; children: ReactNode }) {
  const asFn = ConfirmProvider as unknown as (props: { children: ReactNode }) => ReactElement<{
    value: (options: ConfirmOptions) => Promise<boolean>;
  }>;
  const tree = asFn({ children });
  const confirm = tree.props.value;
  useEffect(() => {
    void confirm(ask);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return tree;
}

/** The surface behind the scrim — the document the action would act on. */
function DocumentSurface() {
  return (
    <div className="w-full max-w-xl rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-md font-semibold">Attention Is All You Need, Revisited</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            8 sections · 14 references · 3 attached PDFs
          </p>
        </div>
        <Button size="sm" variant="outline">
          <Save />
          Save
        </Button>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Self-attention replaced recurrence as the dominant sequence-modelling primitive largely
        on throughput grounds rather than sample efficiency.
      </p>
    </div>
  );
}

export function DeleteDocument() {
  return (
    <ConfirmStage
      ask={{
        title: 'Delete “Attention Is All You Need, Revisited”?',
        description:
          'This permanently removes the document and its chats. It cannot be undone.',
        confirmLabel: 'Delete',
        destructive: true,
      }}
    >
      <DocumentSurface />
    </ConfirmStage>
  );
}

export function DeleteUpload() {
  return (
    <ConfirmStage
      ask={{
        title: 'Delete attention-2017.pdf?',
        description:
          'The file, its extracted text, and the assistant’s access to it are removed. This cannot be undone.',
        confirmLabel: 'Delete',
        destructive: true,
      }}
    >
      <DocumentSurface />
    </ConfirmStage>
  );
}

export function StartNewDocument() {
  return (
    <ConfirmStage
      ask={{
        title: 'Start a new document?',
        description: 'Unsaved changes to the current document will be lost.',
        confirmLabel: 'Start new',
      }}
    >
      <DocumentSurface />
    </ConfirmStage>
  );
}

export function AcceptAllSuggestions() {
  return (
    <ConfirmStage
      ask={{
        title: 'Accept all 7 suggestions?',
        description: 'Every pending suggestion will be applied to the document.',
        confirmLabel: 'Accept all',
        cancelLabel: 'Keep reviewing',
      }}
    >
      <DocumentSurface />
    </ConfirmStage>
  );
}
