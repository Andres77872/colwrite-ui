import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { uid } from '@/lib/uid';
import { blocksToMarkdown, citationLookup, inlineHtmlToMarkdown } from '@/editor/markdown';
import { htmlToText, isFigureBlock, useEditorActions, useEditorState } from '@/editor';
import { blockText } from '@/editor/proposals';
import { serializeEditableHtml } from '../../common/Editable/editableHtml';
import { ASK_AI_EVENT, type AskAiRequest } from './askAiEvents';
import type { AskAiTarget } from './AskAi';

/**
 * Listens for Ask AI requests and captures what they are about.
 *
 * Lives in the canvas, which renders the panel directly under the target
 * block: an in-flow panel scrolls with the document and never has to chase
 * its anchor the way a floating one does.
 */
export function useAskAiTarget() {
  const { selectedBlockIds, blocks } = useEditorState();
  const { refs, getBlock, clearBlockSelection } = useEditorActions();
  const [target, setTarget] = useState<AskAiTarget | null>(null);
  const selectedRef = useRef(selectedBlockIds);
  const blocksRef = useRef(blocks);
  useLayoutEffect(() => {
    selectedRef.current = selectedBlockIds;
    blocksRef.current = blocks;
  }, [selectedBlockIds, blocks]);

  useEffect(() => {
    const capture = (request: AskAiRequest): AskAiTarget | null => {
      const all = blocksRef.current;
      const selected = selectedRef.current;
      const key = uid();
      let blockId = request.blockId;

      if (selected.length > 0) {
        const chosen = all.filter((block) => selected.includes(block.id));
        if (chosen.length === 1 && isFigureBlock(chosen[0])) {
          // One selected figure (Esc in its source, then Mod+J) is the figure
          // itself: the text presets would rewrite its JSON as prose, and the
          // figure presets apply to a single block only.
          clearBlockSelection();
          blockId = chosen[0].id;
        } else if (chosen.length > 0) {
          clearBlockSelection();
          return {
            key,
            kind: 'blocks',
            blockIds: chosen.map((block) => block.id),
            anchorId: chosen[chosen.length - 1].id,
            markdown: blocksToMarkdown(chosen),
            text: chosen.map(blockText).join('\n\n'),
            locked: chosen.some((block) => block.locked),
            citations: citationLookup(chosen),
            preset: request.actionId,
          };
        }
      }

      const block = getBlock(blockId);
      if (!block) return null;
      const el = refs.current[block.id];
      const selection = window.getSelection();
      const citations = citationLookup([block]);
      const base = {
        key,
        blockIds: [block.id],
        anchorId: block.id,
        locked: block.locked === true,
        citations,
        preset: request.actionId,
      };

      if (
        el &&
        selection &&
        selection.rangeCount > 0 &&
        !selection.isCollapsed &&
        el.contains(selection.getRangeAt(0).commonAncestorContainer) &&
        (block.type === 'paragraph' || block.type === 'heading')
      ) {
        const range = selection.getRangeAt(0).cloneRange();
        const holder = document.createElement('div');
        holder.appendChild(range.cloneContents());
        const markdown = inlineHtmlToMarkdown(
          holder.innerHTML,
          block.type === 'paragraph' ? block.children ?? [] : [],
        ).trim();
        const selected = { ...block, html: serializeEditableHtml(holder) } as typeof block;
        const text = blockText(selected);
        if (markdown) return { ...base, kind: 'selection', markdown, text, diffBase: selected, range };
      }

      const text = block.type === 'code' ? block.text : 'html' in block ? htmlToText(block.html) : '';
      const hasWidgets = block.type === 'paragraph' && (block.children ?? []).length > 0;
      if ((block.type === 'paragraph' || block.type === 'heading') && !text.trim() && !hasWidgets) {
        const index = all.findIndex((candidate) => candidate.id === block.id);
        const before = all.slice(Math.max(0, index - 3), index);
        return {
          ...base,
          kind: 'empty',
          markdown: '',
          text: '',
          anchorText: blocksToMarkdown(before).trim() || undefined,
        };
      }
      if (block.type === 'divider') return null;
      return {
        ...base,
        kind: 'block',
        markdown: blocksToMarkdown([block]),
        text: blockText(block),
        diffBase: block,
        figure: isFigureBlock(block),
      };
    };

    const onOpen = (event: Event) => {
      const request = (event as CustomEvent<AskAiRequest>).detail;
      if (!request?.blockId) return;
      const next = capture(request);
      if (next) setTarget(next);
    };
    window.addEventListener(ASK_AI_EVENT, onOpen);
    return () => window.removeEventListener(ASK_AI_EVENT, onOpen);
  }, [clearBlockSelection, getBlock, refs]);

  const close = useCallback(() => setTarget(null), []);
  return { target, close };
}
