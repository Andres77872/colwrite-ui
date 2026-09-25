import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toastContext';
import { htmlToText, useDocumentTitle, useEditorActions, type Block } from '@/editor';
import { markdownToBlocks } from '@/editor/markdown';
import { uid } from '@/lib/uid';
import { openAskAi } from '../AskAi/askAiEvents';
import { FileUp, ListTree, Sparkles } from 'lucide-react';

const PAPER_SECTIONS = ['Abstract', 'Introduction', 'Related work', 'Method', 'Experiments', 'Conclusion'];

function emptyParagraph(): Block {
  return { id: uid(), type: 'paragraph', html: '', children: [], columns: 1 };
}

/**
 * The quiet starting points under an empty page's title, in place of the
 * "Start writing" card: nothing to dismiss, and gone as soon as the page has
 * a word in it.
 *
 * `blankId` is the page's one empty paragraph, which a template replaces
 * rather than pushing down (null when the page has no blocks at all).
 */
export function BlankPageActions({ blankId }: { blankId: string | null }) {
  const { insertBlocksAfter, refs } = useEditorActions();
  const { isUntitled, rename } = useDocumentTitle();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const fill = (blocks: Block[], focusId: string | undefined) => {
    insertBlocksAfter(blankId, blocks, { replaceAnchor: true });
    if (focusId) requestAnimationFrame(() => refs.current[focusId]?.focus());
  };

  const startWithAi = () => {
    let id = blankId;
    if (!id) {
      const [created] = insertBlocksAfter(null, [emptyParagraph()]);
      id = created ?? null;
    }
    if (!id) return;
    const target = id;
    // The prompt anchors to a mounted row, so wait for the new one to render.
    requestAnimationFrame(() => openAskAi({ blockId: target }));
  };

  const paperOutline = () => {
    const blocks = PAPER_SECTIONS.flatMap((section): Block[] => [
      { id: uid(), type: 'heading', level: 2, html: section },
      emptyParagraph(),
    ]);
    fill(blocks, blocks[1].id);
  };

  const importMarkdown = async (file: File) => {
    try {
      let blocks = markdownToBlocks(await file.text());
      // A leading "# Title" names an untitled page instead of repeating it.
      const first = blocks[0];
      if (isUntitled && first?.type === 'heading' && first.level === 1) {
        void rename(htmlToText(first.html));
        blocks = blocks.slice(1);
      }
      if (blocks.length === 0) {
        toast({ title: 'That file has no content to import', variant: 'error' });
        return;
      }
      fill(blocks, undefined);
    } catch (error) {
      toast({
        title: 'Could not read that file',
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    }
  };

  return (
    <div className="-ml-2 mb-2 flex flex-wrap items-center gap-0.5 text-muted-foreground">
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={startWithAi}>
        <Sparkles aria-hidden="true" className="text-ai" />
        Start with AI
      </Button>
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={paperOutline}>
        <ListTree aria-hidden="true" />
        Paper outline
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => fileRef.current?.click()}
      >
        <FileUp aria-hidden="true" />
        Import Markdown
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void importMarkdown(file);
        }}
      />
    </div>
  );
}
