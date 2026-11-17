import { BookmarkCheck, BookmarkPlus, Plus, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toastContext';
import { referenceTitle, useOptionalEditorActions, type ReferenceRecord } from '@/editor';
import { useSourceActions } from './sourceActions';

export type SourceActionsProps = {
  record: ReferenceRecord;
  /** `icons` for a row's quiet actions, `buttons` for a card's labelled ones. */
  variant?: 'icons' | 'buttons';
  /**
   * What Cite does instead of citing at the caret: the citation picker adds
   * the work to the citation it is editing.
   */
  cite?: { label: string; run: () => void };
};

/**
 * Cite and Add to sources, for one reference — the one component a reply's
 * sources, a paper result and the citation picker show (P2.UI-1). Both act
 * on the record as it came, so the same work is the same entry from
 * wherever it was cited. Outside an editor, where there is no caret and no
 * library, it shows nothing.
 */
export function SourceActions(props: SourceActionsProps) {
  if (!useOptionalEditorActions()) return null;
  return <EditorSourceActions {...props} />;
}

function EditorSourceActions({ record, variant = 'icons', cite }: SourceActionsProps) {
  const actions = useSourceActions(record);
  const { toast } = useToast();
  const title = referenceTitle(record);
  const citeLabel = cite?.label ?? 'Cite';
  const onCite = cite?.run ?? actions.cite;
  const save = () => {
    if (!actions.inSources) toast({ title: 'Added to sources', description: title });
    actions.save();
  };
  const CiteIcon = cite ? Plus : Quote;

  if (variant === 'buttons') {
    return (
      <div className="-mx-1 flex items-center gap-1">
        {/* In a card that names the work, the words are the names. */}
        <Button type="button" variant="ghost" size="sm" onClick={onCite}>
          <CiteIcon aria-hidden="true" />
          {citeLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={save} aria-pressed={actions.inSources}>
          {actions.inSources ? <BookmarkCheck aria-hidden="true" className="text-primary" /> : <BookmarkPlus aria-hidden="true" />}
          {actions.inSources ? 'In sources' : 'Add to sources'}
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onCite}
        aria-label={cite ? `${citeLabel}: ${title}` : `Cite “${title}” at the cursor`}
      >
        <CiteIcon aria-hidden="true" />
        {citeLabel}
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="icon"
            size="icon-xs"
            aria-label={actions.inSources ? `“${title}” is in sources` : `Add “${title}” to sources`}
            aria-pressed={actions.inSources}
            onClick={save}
          >
            {actions.inSources ? <BookmarkCheck aria-hidden="true" className="text-primary" /> : <BookmarkPlus aria-hidden="true" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{actions.inSources ? 'In sources' : 'Add to sources'}</TooltipContent>
      </Tooltip>
    </>
  );
}
