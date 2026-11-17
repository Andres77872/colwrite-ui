import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useDocumentActions,
  useDocumentId,
  useEditorDoc,
  useEditorActions,
  usePageReadOnly,
  type AiBeatChild,
  type Block,
} from '@/editor';
import type { InlineWidgetProps } from '../types';
import { cn } from '@/lib/utils';
import { modKeyLabel } from '@/components/layout/Shortcuts/shortcuts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AgentStatusLine } from '@/components/editor/AgentProgress';
import { useAgentRun } from '@/components/editor/AgentRun';
import { buildBeatMessage } from '@/components/editor/AskAi/target';
import { resolveAssistantOutput } from '@/editor/assistantOutput';
import { assistantOutputBlocks } from '@/editor/markdown';
import { buildBibliography } from '@/editor/citations';
import { useCitationProcessor } from '@/editor/csl/useCitationProcessor';
import type { AgentSource } from '@/api/assistant/streamParser';
import { ProposedBlockView } from '@/components/editor/Review/ProposedBlockView';
import { serializeEditableHtml } from '@/components/common/Editable/editableHtml';
import { stopEditorEvents, useInlineChild } from '../shared';
import { AlertCircle, ChevronDown, ChevronRight, Sparkles, Square, Trash2 } from 'lucide-react';

const MAX_PROMPT_LENGTH = 2000;

/**
 * Type-guard wrapper. It declares no hooks, so returning early here is safe;
 * the guard used to sit above the content component's hooks, which meant a
 * child whose type changed in place rendered fewer hooks than the previous
 * pass and crashed React.
 */
export function AiBeatInline({ child, ...rest }: InlineWidgetProps) {
  if (child.type !== 'aiBeat') return null;
  return <AiBeatInlineContent child={child} {...rest} />;
}

function AiBeatInlineContent(props: InlineWidgetProps<AiBeatChild>) {
  const { blockId, child, updateHtml, refs } = props;
  const { patch, remove } = useInlineChild(props);
  const readOnly = usePageReadOnly();
  const { doc: { citationStyle } } = useEditorDoc();
  const documentId = useDocumentId();
  const { ensureRemoteDocument, hasPendingEdits, saveRemote } = useDocumentActions();
  const { batch, addParagraphChild, insertBlocksAfter, replaceBlocks, upsertSources } = useEditorActions();
  const agent = useAgentRun({
    surface: 'inline',
    document: { documentId, ensureRemoteDocument, hasPendingEdits, saveRemote },
  });
  const { progress, sources, running: generating } = agent;

  // Only the streamed output is local: it arrives token by token, and writing
  // every token into the document would put thousands of entries through the
  // autosave path for one generation. It is committed to the child when the
  // stream ends.
  const [streamed, setStreamed] = useState<string | null>(null);
  const [error, setError] = useState('');
  /** Said once, when a generation ends: never a live region that reads every token. */
  const [announcement, setAnnouncement] = useState('');
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const message = child.message ?? '';
  const prompt = child.prompt ?? '';
  const storedOutput = useMemo(
    () => streamed === null ? child.output : resolveAssistantOutput(streamed, sources),
    [child.output, streamed, sources],
  );
  const output = storedOutput?.text ?? '';
  const collapsed = child.collapsed === true;
  // The reply is markdown, shown and inserted as the blocks it makes.
  const blocks = useMemo(
    () => assistantOutputBlocks(storedOutput),
    [storedOutput],
  );
  useCitationProcessor((storedOutput?.sources.length ?? 0) > 0);
  const bibliography = buildBibliography(blocks, { style: citationStyle });

  const messageOverLimit = message.length > MAX_PROMPT_LENGTH;
  const promptOverLimit = prompt.length > MAX_PROMPT_LENGTH;
  const hasValidationError = messageOverLimit || promptOverLimit;

  const onGenerate = async () => {
    if (generating || hasValidationError || !message.trim()) return;
    setError('');
    setAnnouncement('');
    setStreamed('');

    let text = '';
    const found = new Map<string, AgentSource>();
    const outcome = await agent.start({
      request: { message: buildBeatMessage(blockId, message, prompt), context: { block_id: blockId } },
      handlers: {
        onEvidence: ({ sources }) => { for (const source of sources) found.set(source.handle, source); },
        onToken: (content) => {
          text += content;
          setStreamed(text);
        },
      },
    });
    // The widget is gone, and the run with it: there is nothing to write to.
    if (!mountedRef.current) return;
    setStreamed(null);
    if (outcome.status === 'failed') setError(outcome.error.message);
    // Whatever arrived is the author's to keep, stopped or failed part-way.
    if (text || outcome.status === 'done') patch({ output: resolveAssistantOutput(text, [...found.values()]) });
    setAnnouncement(
      outcome.status === 'done'
        ? text.trim() ? 'The AI passage is ready.' : 'The assistant returned nothing.'
        : outcome.status === 'failed' ? 'The AI passage did not finish.' : 'Stopped.',
    );
  };

  /**
   * Accept: the generated text replaces the widget, as the blocks it makes.
   *
   * One plain paragraph takes the widget's place in the sentence, widgets and
   * all; anything else (a list, several paragraphs, a table) goes in after
   * the paragraph, or in place of it when the widget was all it held. One
   * undo step either way.
   */
  const onAccept = () => {
    const host = refs.current[blockId];
    // The id arrives from tool payloads, so it is escaped before it goes into
    // a selector.
    const placeholder = host?.querySelector(`[data-child-id="${CSS.escape(child.id)}"]`);
    if (!host || !placeholder || blocks.length === 0) return;
    const [only] = blocks;
    const single = blocks.length === 1 && only?.type === 'paragraph' && !only.variant ? only : null;

    batch(() => {
      if (storedOutput?.sources.length) upsertSources(storedOutput.sources);
      if (single) {
        const template = document.createElement('template');
        template.innerHTML = single.html;
        for (const added of single.children ?? []) addParagraphChild(blockId, added);
        placeholder.replaceWith(template.content);
      } else {
        placeholder.remove();
      }
      // Drop the child before reserializing: the placeholder is already gone
      // from the DOM, and a child with no placeholder fails the paragraph's
      // html/children invariant.
      props.removeParagraphChild(blockId, child.id);
      updateHtml(blockId, serializeEditableHtml(host));
      if (single) return;
      const emptied = !host.textContent?.trim() && !host.querySelector('[data-child-id]');
      if (emptied) replaceBlocks([blockId], blocks as Block[]);
      else insertBlocksAfter(blockId, blocks as Block[]);
    });
  };

  const summary = useMemo(() => {
    const text = (output || message).trim();
    return text.length > 72 ? `${text.slice(0, 72)}…` : text || 'Empty';
  }, [output, message]);

  // A read-only page (a viewer): what the passage holds, and nothing that
  // generates, inserts or changes it.
  if (readOnly) {
    return (
      <span
        className="ai-beat-widget my-3 block overflow-hidden rounded-lg bg-subtle px-3 py-2 ring-1 ring-inset ring-border"
        role="group"
        aria-label="AI passage"
        contentEditable={false}
        {...stopEditorEvents}
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-ai" />
          AI passage
        </span>
        <span className="mt-1 block text-sm">
          {blocks.length ? blocks.map((block) => <ProposedBlockView key={block.id} block={block} bibliography={bibliography} />) : message.trim() || 'Empty'}
        </span>
      </span>
    );
  }

  /* A quiet well rather than a tinted card: the violet sparkle is what marks
     it as AI-owned, as it does everywhere else in the app. The header stays
     visible because it carries the collapse toggle. */
  return (
    <span
      className="ai-beat-widget my-3 block overflow-hidden rounded-lg bg-subtle ring-1 ring-inset ring-border transition-shadow focus-within:ring-ai/40"
      role="group"
      aria-label="AI passage"
      contentEditable={false}
      {...stopEditorEvents}
    >
      <span className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          onClick={() => patch({ collapsed: !collapsed })}
          aria-expanded={!collapsed}
          className="flex h-6 items-center gap-1.5 rounded-sm px-1 text-sm font-medium text-foreground transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-ai" />
          AI passage
        </button>

        {collapsed && (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
        )}

        <Button
          type="button"
          variant="icon"
          size="icon-xs"
          className="ml-auto hover:text-destructive"
          aria-label="Remove AI passage"
          title="Remove AI passage"
          onClick={remove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </span>

      {!collapsed && (
        <span className="block space-y-2.5 px-3 pb-3 pt-1">
          <span className="block">
            <span className="mb-1 flex items-baseline justify-between gap-2">
              <label
                htmlFor={`aibeat-message-${child.id}`}
                className="text-xs font-medium text-muted-foreground"
              >
                Message
              </label>
              <CharacterCount value={message} label="Message" />
            </span>
            <Textarea
              id={`aibeat-message-${child.id}`}
              rows={2}
              value={message}
              maxLength={MAX_PROMPT_LENGTH}
              placeholder="What do you want to generate?"
              onChange={(event) => patch({ message: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  onGenerate();
                }
                if (event.key === 'Escape') patch({ collapsed: true });
              }}
              className="min-h-0 resize-y px-2 py-1.5 shadow-none"
            />
          </span>

          <span className="block">
            <span className="mb-1 flex items-baseline justify-between gap-2">
              <label
                htmlFor={`aibeat-prompt-${child.id}`}
                className="text-xs font-medium text-muted-foreground"
              >
                Style prompt
              </label>
              <CharacterCount value={prompt} label="Prompt" />
            </span>
            <Input
              id={`aibeat-prompt-${child.id}`}
              type="text"
              value={prompt}
              maxLength={MAX_PROMPT_LENGTH}
              placeholder="You are a helpful assistant"
              onChange={(event) => patch({ prompt: event.target.value })}
              className="h-8 px-2 shadow-none"
            />
          </span>

          {(output || generating) && (
            // Shown as the blocks it will become. Not a live region: read out
            // on every token it was noise; the end is announced once below.
            <span className="block max-h-48 space-y-1.5 overflow-auto rounded-md bg-background p-2.5 text-sm ring-1 ring-inset ring-border">
              {blocks.map((block) => (
                  <ProposedBlockView key={block.id} block={block} bibliography={bibliography} />
              ))}
              {generating && (
                <span
                  aria-hidden="true"
                  className="ml-0.5 inline-block h-4 w-1 animate-shimmer align-text-bottom bg-ai"
                />
              )}
            </span>
          )}
          <span aria-live="polite" className="sr-only">
            {announcement}
          </span>

          {error && (
            <span role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </span>
          )}

          <span className="flex flex-wrap items-center gap-1.5">
            {generating ? (
              <Button type="button" variant="destructive" size="sm" onClick={agent.stop}>
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={hasValidationError || !message.trim()}
                onClick={onGenerate}
              >
                {output.trim() ? 'Regenerate' : 'Generate'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!output.trim() || generating}
              onClick={onAccept}
              title="Replace this panel with the generated text"
            >
              Insert into text
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={!output.trim() || generating}
              onClick={() => patch({ output: null })}
            >
              Clear
            </Button>
            {generating && progress ? (
              <span className="flex min-w-0 items-center">
                <AgentStatusLine
                  progress={progress}
                  as="span"
                  className="text-xs"
                  whileWriting={<span className="text-xs text-muted-foreground animate-shimmer">Writing…</span>}
                />
              </span>
            ) : (
              <span className="ml-auto text-xs text-muted-foreground">
                {modKeyLabel('Enter')} to generate · Esc to collapse
              </span>
            )}
          </span>
        </span>
      )}
    </span>
  );
}

function CharacterCount({ value, label }: { value: string; label: string }) {
  const over = value.length > MAX_PROMPT_LENGTH;
  return (
    <span className={cn('text-xs tabular-nums', over ? 'text-destructive' : 'text-muted-foreground/70')}>
      {value.length}/{MAX_PROMPT_LENGTH}
      {over && <span className="ml-2">{label} must be ≤{MAX_PROMPT_LENGTH} characters</span>}
    </span>
  );
}
