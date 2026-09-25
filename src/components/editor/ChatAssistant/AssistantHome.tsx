import {
  BookCheck,
  FileText,
  PenLine,
  ScrollText,
  Sigma,
  Sparkles,
  Telescope,
  type LucideIcon,
} from 'lucide-react';

/** Label on the row, and the message it sends. */
const SUGGESTIONS: ReadonlyArray<{ label: string; prompt: string; icon: LucideIcon }> = [
  {
    label: 'Summarize this document',
    prompt: 'Summarize this document in a short paragraph.',
    icon: FileText,
  },
  {
    label: 'Find related work',
    prompt: 'Find related work this paper should discuss or cite.',
    icon: Telescope,
  },
  {
    label: 'Check my citations',
    prompt: 'Check my citations: flag claims that need a source, and sources that do not support their claim.',
    icon: BookCheck,
  },
  {
    label: 'Improve the introduction',
    prompt: 'Improve the introduction.',
    icon: PenLine,
  },
  { label: 'Draft an abstract', prompt: 'Draft an abstract for this paper.', icon: ScrollText },
  { label: 'Explain an equation', prompt: 'Explain the main equation in this paper.', icon: Sigma },
];

/**
 * What an empty conversation shows: what the assistant is for, and six
 * one-click starts. Each row sends its prompt straight away — it is a
 * shortcut, not a template to edit.
 */
export function AssistantHome({
  documentName,
  saved,
  unsavedNoticeId,
  onPick,
}: {
  documentName: string;
  /** Whether the document already has an id. Asking saves it otherwise. */
  saved: boolean;
  unsavedNoticeId: string;
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-col pt-6">
      <Sparkles aria-hidden="true" className="h-7 w-7 text-ai" strokeWidth={1.75} />
      <h3 className="mt-3 text-lg font-semibold text-foreground">How can I help with this paper?</h3>
      <p className="mt-1 text-sm text-muted-foreground text-pretty">
        Working on <span className="text-foreground">“{documentName}”</span>. Edits arrive as
        suggestions you accept in the page.
      </p>

      <ul className="-mx-2 mt-5 flex flex-col gap-px" aria-label="Suggestions">
        {SUGGESTIONS.map(({ label, prompt, icon: Icon }) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => onPick(prompt)}
              aria-describedby={saved ? undefined : unsavedNoticeId}
              className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-foreground outline-none transition-colors duration-120 hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              {label}
            </button>
          </li>
        ))}
      </ul>

      {/* Sending saves the document itself and keeps the conversation with it,
          so the only thing worth saying is that it will. */}
      {!saved && (
        <p id={unsavedNoticeId} className="mt-4 text-xs text-muted-foreground">
          Asking saves this document first, so the assistant can work on it.
        </p>
      )}
    </div>
  );
}
