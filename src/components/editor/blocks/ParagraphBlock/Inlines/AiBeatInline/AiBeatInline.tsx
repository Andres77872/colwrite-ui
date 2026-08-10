import { useMemo, useRef, useState } from 'react';
import type { AiBeatChild } from '@/editor';
import type { AiBeatWidgetProps } from '../types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { streamAgentChat } from '@/services/agentChat';
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
export function AiBeatInline({ child, ...rest }: AiBeatWidgetProps) {
  if (child.type !== 'aiBeat') return null;
  return <AiBeatInlineContent child={child} {...rest} />;
}

function AiBeatInlineContent(props: AiBeatWidgetProps<AiBeatChild>) {
  const { blockId, child, updateHtml, refs, documentId, ensureRemoteDocument } = props;
  const { patch, remove } = useInlineChild(props);

  // Only the streamed output is local: it arrives token by token, and writing
  // every token into the document would put thousands of entries through the
  // autosave path for one generation. It is committed to the child when the
  // stream ends.
  const [streamed, setStreamed] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const message = child.message ?? '';
  const prompt = child.prompt ?? '';
  const output = streamed ?? child.output ?? '';
  const collapsed = child.collapsed === true;

  const messageOverLimit = message.length > MAX_PROMPT_LENGTH;
  const promptOverLimit = prompt.length > MAX_PROMPT_LENGTH;
  const hasValidationError = messageOverLimit || promptOverLimit;

  const onGenerate = async () => {
    if (generating || hasValidationError || !message.trim()) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setError('');
    setStreamed('');

    let text = '';
    try {
      // Shared with the assistant and the selection toolbar, so a draft that
      // several of them reach for at once is created exactly once.
      const docId = documentId ?? (await ensureRemoteDocument());
      if (!docId) {
        setError('This document could not be saved, so nothing could be generated for it.');
        return;
      }
      await streamAgentChat(
        {
          message: `Use this prompt: ${prompt}\n\nGenerate response for: ${message}`,
          document_id: docId,
          // Without this the agent runs with the document tools and can edit
          // the paper while the author is still deciding whether to keep the
          // text this widget is generating. AIBeat produces text; it does not
          // get to change anything.
          mode: 'rewrite',
        },
        {
          onToken: (content) => {
            text += content;
            setStreamed(text);
          },
          onError: (_code, detail) => setError(detail),
        },
        { signal: controller.signal },
      );
      patch({ output: text });
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Generation failed');
      }
      // Whatever arrived before the failure is still the author's to keep.
      if (text) patch({ output: text });
    } finally {
      setGenerating(false);
      setStreamed(null);
      abortRef.current = null;
    }
  };

  const onStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  /**
   * Accept: the generated text replaces the widget.
   *
   * It used to insert the text *after* the widget and leave the widget behind,
   * so accepting produced a paragraph with the text plus the panel that made
   * it, and the author had to delete the panel by hand every time.
   */
  const onAccept = () => {
    const host = refs.current[blockId];
    // The id arrives from tool payloads, so it is escaped before it goes into
    // a selector.
    const placeholder = host?.querySelector(`[data-child-id="${CSS.escape(child.id)}"]`);
    if (!host || !placeholder) return;

    placeholder.replaceWith(document.createTextNode(output));
    // Drop the child before reserializing: the placeholder is already gone
    // from the DOM, and a child with no placeholder fails the paragraph's
    // html/children invariant.
    props.removeParagraphChild(blockId, child.id);
    updateHtml(blockId, serializeEditableHtml(host));
  };

  const summary = useMemo(() => {
    const text = (output || message).trim();
    return text.length > 72 ? `${text.slice(0, 72)}…` : text || 'Empty';
  }, [output, message]);

  /* The block-level shell mirrors InlineFigureShell — same radius, same
     header strip — but keeps the primary tint that marks AI-owned content,
     and its header stays visible because it carries the collapse toggle. */
  return (
    <span
      className="ai-beat-widget my-2 block overflow-hidden rounded-lg border border-primary/30 bg-primary/5 transition-colors focus-within:border-primary/50"
      role="group"
      aria-label="AI passage"
      contentEditable={false}
      {...stopEditorEvents}
    >
      <span className="flex items-center gap-1 border-b border-primary/20 px-2 py-1">
        <button
          type="button"
          onClick={() => patch({ collapsed: !collapsed })}
          aria-expanded={!collapsed}
          className="flex items-center gap-1 rounded-sm px-0.5 text-xs font-medium text-primary transition-colors hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
          AI passage
        </button>

        {collapsed && (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="ml-auto text-muted-foreground hover:text-destructive"
          aria-label="Remove AI passage"
          title="Remove AI passage"
          onClick={remove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </span>

      {!collapsed && (
        <span className="block space-y-2.5 p-2.5">
          <span className="block">
            <span className="mb-1 flex items-baseline justify-between gap-2">
              <label
                htmlFor={`aibeat-message-${child.id}`}
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
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
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
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
            <span
              className="block max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-2 text-sm"
              aria-live="polite"
            >
              {output}
              {generating && (
                <span
                  aria-hidden="true"
                  className="ml-0.5 inline-block h-4 w-1 animate-shimmer align-text-bottom bg-primary"
                />
              )}
            </span>
          )}

          {error && (
            <span role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </span>
          )}

          <span className="flex flex-wrap items-center gap-1.5">
            {generating ? (
              <Button type="button" variant="destructive" size="sm" onClick={onStop}>
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
              onClick={() => patch({ output: '' })}
            >
              Clear
            </Button>
            {generating && !output ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Spinner className="h-3 w-3" />
                Thinking…
              </span>
            ) : (
              <span className="ml-auto text-xs text-muted-foreground">
                Ctrl+Enter to generate · Esc to collapse
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
