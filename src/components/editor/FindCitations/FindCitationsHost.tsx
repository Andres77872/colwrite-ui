import { useEffect, useMemo, useState } from 'react';
import { Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toastContext';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useAssistantCatalog } from '@/components/preferences';
import { ReferenceStatus } from '@/components/editor/References';
import { referenceAuthors, referenceTitle, referenceYear } from '@/editor';
import { paperFailure, searchPassages } from '@/data/papers';
import { candidatesFrom, picksOf, type SentenceCandidates, type Ticks } from './findCitations';
import { closeFindCitations, useFindCitationsTarget, type FindCitationsTarget } from './findCitationsTarget';
import { useInsertCitations } from './useInsertCitations';

const LEVELS = { full_text: 'Full text', abstract: 'Abstract', snippet: 'Snippet', metadata: 'Metadata' } as const;

/**
 * Find citations (P2.UI-3): the dialog the toolbar's "Find citations"
 * opens. Step one searches each sentence of the selection for passages
 * that bear on it; step two is the author ticking what to cite. Insert
 * places only what was ticked, as one undo step.
 */
export function FindCitationsHost() {
  const target = useFindCitationsTarget();
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && closeFindCitations()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Find citations</DialogTitle>
          <DialogDescription>
            Sources for each sentence of the selection, with the passage each would rest on. Tick what to cite; nothing
            else changes.
          </DialogDescription>
        </DialogHeader>
        {target && <FindCitationsBody key={target.id} target={target} />}
      </DialogContent>
    </Dialog>
  );
}

function FindCitationsBody({ target }: { target: FindCitationsTarget }) {
  const workspaceId = useWorkspaceId();
  const { papers } = useAssistantCatalog();
  const insert = useInsertCitations();
  const { toast } = useToast();
  const [sentences, setSentences] = useState<SentenceCandidates[]>(target.sentences);
  const [ticks, setTicks] = useState<Ticks>(new Map());

  // Each sentence to search asks the passages route once; its row fills in as it answers.
  useEffect(() => {
    if (!papers.on) return;
    const controller = new AbortController();
    const settle = (index: number, change: Partial<SentenceCandidates>) => {
      setSentences((current) => current.map((item, at) => (at === index ? { ...item, ...change } : item)));
    };
    target.sentences.forEach((sentence, index) => {
      if (sentence.status !== 'searching') return;
      searchPassages(workspaceId, sentence.text, { limit: 8 }, { signal: controller.signal })
        .then((page) => {
          const candidates = candidatesFrom(page.items);
          settle(index, { status: candidates.length ? 'found' : 'none', candidates });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) settle(index, { status: 'failed', reason: paperFailure(error), candidates: [] });
        });
    });
    return () => controller.abort();
  }, [papers.on, target, workspaceId]);

  const picks = useMemo(() => picksOf(sentences, ticks), [sentences, ticks]);
  const tickedCount = picks.reduce((total, pick) => total + pick.records.length, 0);

  const toggle = (index: number, key: string, on: boolean) => {
    setTicks((current) => {
      const next = new Map(current);
      const keys = new Set(next.get(index) ?? []);
      if (on) keys.add(key);
      else keys.delete(key);
      next.set(index, keys);
      return next;
    });
  };

  const onInsert = () => {
    const { inserted, missed } = insert(target.blockId, picks);
    closeFindCitations();
    toast({
      title: inserted ? `Cited ${inserted} sentence${inserted === 1 ? '' : 's'}` : 'Nothing was cited',
      description: missed.length
        ? `${missed.length} sentence${missed.length === 1 ? ' was' : 's were'} edited since, so ${missed.length === 1 ? 'it was' : 'they were'} left as ${missed.length === 1 ? 'it is' : 'they are'}.`
        : inserted ? 'Undo takes them all out at once.' : undefined,
    });
  };

  if (!papers.on) {
    return <p className="mt-4 text-sm text-muted-foreground">Paper search is not available here. {papers.reason}</p>;
  }
  if (sentences.length === 0) return <p className="mt-4 text-sm text-muted-foreground">Select one or more sentences of a paragraph first.</p>;

  return (
    <>
      <ol className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-1" aria-label="Sentences">
        {sentences.map((sentence, index) => (
          <li key={`${sentence.start}:${sentence.text}`} data-sentence={index} className="space-y-1.5">
            <blockquote className="border-l-2 border-border pl-2 text-sm">{sentence.text}</blockquote>
            {sentence.status === 'skipped' && <p className="text-xs text-muted-foreground">{sentence.reason}</p>}
            {sentence.status === 'searching' && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner /> Searching papers…</p>
            )}
            {sentence.status === 'none' && <p className="text-xs text-muted-foreground">No good source found for this sentence.</p>}
            {sentence.status === 'failed' && <p role="alert" className="text-xs text-destructive">{sentence.reason}</p>}
            {sentence.candidates.length > 0 && (
              <ul className="space-y-1" aria-label={`Sources for sentence ${index + 1}`}>
                {sentence.candidates.map((candidate) => {
                  const { record } = candidate;
                  const checked = ticks.get(index)?.has(record.key) ?? false;
                  const byline = [referenceAuthors(record), referenceYear(record)].filter(Boolean).join(' · ');
                  return (
                    <li key={record.key}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-hover has-focus-visible:bg-hover">
                        <Checkbox
                          className="mt-0.5"
                          checked={checked}
                          onCheckedChange={(value) => toggle(index, record.key, value === true)}
                          aria-label={`Cite “${referenceTitle(record)}” for sentence ${index + 1}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-snug">{referenceTitle(record)}</span>
                          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            {byline && <span>{byline}</span>}
                            <span>{LEVELS[candidate.level]}</span>
                            <ReferenceStatus record={record} />
                          </span>
                          <span className="mt-0.5 line-clamp-3 block text-xs text-foreground/80">“{candidate.passage}”</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <DialogFooter className="mt-4">
        <Button type="button" variant="ghost" onClick={closeFindCitations}>Cancel</Button>
        <Button type="button" onClick={onInsert} disabled={tickedCount === 0}>
          <Quote aria-hidden="true" />
          {tickedCount === 0 ? 'Insert' : `Insert ${tickedCount} citation${tickedCount === 1 ? '' : 's'}`}
        </Button>
      </DialogFooter>
    </>
  );
}
