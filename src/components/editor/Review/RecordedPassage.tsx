import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspaceId } from '@/components/workspace/workspaceContextState';
import { useDocumentId, type CitationPassage } from '@/editor';
import { chatPassageQuery } from '@/data/chats';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const LEVELS: Record<CitationPassage['level'], string> = {
  full_text: 'Full text', abstract: 'Abstract', snippet: 'Snippet', metadata: 'Metadata only',
};

/** Not a support verdict: exactly the excerpt recorded with the citation. */
export function RecordedPassage({ passage }: { passage: CitationPassage }) {
  const workspaceId = useWorkspaceId();
  const documentId = useDocumentId();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const query = useQuery({
    ...chatPassageQuery(workspaceId, documentId ?? '', passage.chat_id ?? '', passage.id),
    enabled: (open || hovered) && Boolean(documentId && passage.chat_id),
    retry: false,
  });
  const content = (
    <div className="space-y-2 text-xs">
      <p className="font-medium">{passage.id} · {LEVELS[passage.level]}</p>
      {!passage.chat_id || !documentId || query.isError
        ? <p>This passage isn’t available in this account.</p>
        : query.isPending ? <p role="status">Loading passage…</p>
          : query.data.passages.length === 0 ? <p>Passage not recorded.</p>
            : <>
              <p className="font-medium">{query.data.source.title}</p>
              {query.data.passages.map((item) => <blockquote key={item.id} className="border-l-2 border-border pl-2 whitespace-pre-wrap">{item.text}</blockquote>)}
              <p className="text-muted-foreground">Recorded evidence, not a guarantee that it supports the proposed claim.</p>
            </>}
    </div>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip open={hovered && !open} onOpenChange={setHovered}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button type="button" className="underline decoration-dotted underline-offset-2"
              aria-label={`Read passage ${passage.id}`}>
              {passage.id} · {LEVELS[passage.level]}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">{content}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="max-h-80 w-80 overflow-y-auto">{content}</PopoverContent>
    </Popover>
  );
}
