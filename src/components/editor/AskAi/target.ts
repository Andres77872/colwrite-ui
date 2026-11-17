import type { AgentChatContext } from '@/api/assistant/agentChat';
import type { Block, CitationChild } from '@/editor';
import type { AskAiPreset, AskAiTargetKind } from './presets';

/** What an open prompt acts on, captured when it opens. */
export type AskAiTarget = {
  /** Distinguishes one opening from the next (the panel remounts per target). */
  key: string;
  kind: AskAiTargetKind;
  /** The blocks the result would replace, in document order. */
  blockIds: string[];
  /** The block the panel sits under. */
  anchorId: string;
  /**
   * For `selection`: the selected text as markdown, citations as `[@key]`
   * markers. It goes to the server as `context.selection`, which the server
   * drops when the block is hidden; it is never pasted into the message.
   */
  selection?: string;
  /** For `empty`: the blocks just above the caret, sent as referenced blocks for context. */
  nearbyIds?: string[];
  /** The target as plain text (widgets as short stand-ins), for one-line summaries. */
  text: string;
  /**
   * For `block` and `selection`: the target as a block (a selection as the
   * block cut down to it), what a rewrite is diffed against — widgets and all.
   */
  diffBase?: Block;
  /** For `selection`: the selected range inside the block. */
  range?: Range;
  /** Whether any target block is locked — replacing is then off the table. */
  locked: boolean;
  /**
   * A target block is marked "Hide from assistant". Nothing about it is
   * sent: the prompt says so and runs nothing.
   */
  hidden: boolean;
  /** Citations present in the target, the only ones a result may carry. */
  citations: Map<string, CitationChild>;
  preset?: string;
  /** The target is one structured-figure block: it gets the figure presets. */
  figure?: boolean;
};

/**
 * The server's bounds on `context` (`AgentContext` in
 * `ColWrite-api/src/models/agent_chat_request.py`); a request past them is
 * refused whole, so the prompt says so before sending.
 */
const MAX_SELECTION_CHARS = 4_000;
const MAX_CONTEXT_BLOCKS = 20;

/** Why a target cannot be sent, in the author's words. */
export function targetRefusal(target: AskAiTarget): string | null {
  if (target.hidden) {
    return target.kind === 'blocks'
      ? 'One of these blocks is hidden from the assistant. Show it to the assistant to ask AI about it.'
      : 'This block is hidden from the assistant. Show it to the assistant to ask AI about it.';
  }
  if (target.kind === 'selection' && (target.selection ?? '').length > MAX_SELECTION_CHARS) {
    return `Ask AI reads at most ${MAX_SELECTION_CHARS.toLocaleString('en-US')} selected characters. Select less, or put the caret in the block to work on all of it.`;
  }
  if (target.blockIds.length > MAX_CONTEXT_BLOCKS) {
    return `Ask AI works on at most ${MAX_CONTEXT_BLOCKS} blocks at a time. Select fewer.`;
  }
  return null;
}

/**
 * Where the run's target is, as `context`: the block, the selection, the
 * blocks around an empty line. The server checks each against the stored,
 * visible document and drops what the model may not see.
 */
export function askAiContext(target: AskAiTarget): AgentChatContext {
  const [first] = target.blockIds;
  const blockId = first ?? target.anchorId;
  switch (target.kind) {
    case 'selection':
      return { block_id: blockId, selection: { block_id: blockId, text: target.selection ?? '' } };
    case 'block':
      return { block_id: blockId, block_ids: [blockId] };
    case 'blocks':
      return { block_id: target.anchorId, block_ids: [...target.blockIds] };
    case 'empty':
      return target.nearbyIds?.length
        ? { block_id: blockId, block_ids: [...target.nearbyIds] }
        : { block_id: blockId };
  }
}

/** Ids as the model reads them: `a`, `b` and `c`. */
function idList(ids: readonly string[]): string {
  const quoted = ids.map((id) => `\`${id}\``);
  if (quoted.length <= 1) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

function aboutTarget(preset: AskAiPreset, target: AskAiTarget): string {
  const [blockId = target.anchorId] = target.blockIds;
  if (preset.forFigure) {
    return `The passage is block \`${blockId}\` of the current document: a structured figure, a \`\`\`figure block whose JSON spec the editor lays out and draws.`;
  }
  switch (target.kind) {
    case 'selection':
      return `The passage is the text the author selected in block \`${blockId}\`, quoted under the author's focus. The result replaces that selection only.`;
    case 'block':
      return `The passage is block \`${blockId}\` of the current document.`;
    case 'blocks':
      return `The passage is blocks ${idList(target.blockIds)} of the current document, in that order.`;
    case 'empty':
      return target.nearbyIds?.length
        ? `The author's caret is on an empty line, block \`${blockId}\` of the current document, just after the blocks referenced under the author's focus.`
        : `The author's caret is on an empty line, block \`${blockId}\` of the current document.`;
  }
}

/**
 * How an inline run replies: its text is parsed as markdown into real
 * blocks, so a preamble ("Here is the improved version:") would land in the
 * document.
 */
const MARKDOWN_REPLY = [
  'Reply with the result only, as Markdown: paragraphs, "#"/"##"/"###" headings, "-" or "1." lists,',
  '"- [ ]" to-dos, "> " quotes, pipe tables, fenced code, and $…$ / $$…$$ for mathematics.',
  'No preamble, no closing remarks, no code fence around the whole reply.',
].join(' ');

/**
 * What an inline run sends. A server preset is its id and no text: the
 * server supplies the instruction, and `context` says where the target is.
 * An author's own prompt is a message: the task, where
 * its target is, and the format of the reply. It names the target by id and
 * never quotes it: the server already holds the page, and quoting it here
 * would send what the author hid from the assistant.
 */
export function askAiRequest({
  preset,
  target,
  previous,
  problems,
}: {
  preset: AskAiPreset;
  target: AskAiTarget;
  /** A refinement: the previous result the author wants changed. */
  previous?: string;
  /** For *Fix problems* on a figure: the compiler's findings (`figureProblems`). */
  problems?: readonly string[];
}): { message: string; preset?: string; context: AgentChatContext } {
  const ask = preset.ask;
  if (ask === null) throw new Error(`${preset.id} is a submenu and runs nothing`);
  const context = { ...askAiContext(target),
    ...(previous ? { previous_result: previous } : {}),
    ...(problems?.length ? { figure_problems: [...problems] } : {}),
  };
  if ('preset' in ask) return { message: ask.message ?? '', preset: ask.preset, context };
  return { message: instructionMessage(ask.instruction, preset, target), context };
}

function instructionMessage(
  instruction: string,
  preset: AskAiPreset,
  target: AskAiTarget,
): string {
  const format = `${MARKDOWN_REPLY} Write each citation of the passage that still applies as a marker such as [@10.1145/3442188], with its key exactly as the document has it, and never invent a new one.`;

  const lines = [`Task: ${instruction}`, aboutTarget(preset, target), format];
  return lines.join('\n');
}

/**
 * The message of an AI beat's run: the author's instruction and style, and
 * where the result goes. The page itself the server reads.
 */
export function buildBeatMessage(blockId: string, instruction: string, style: string): string {
  return [
    `Task: ${instruction.trim()}`,
    ...(style.trim() ? [`Style: ${style.trim()}`] : []),
    `The result goes into block \`${blockId}\` of the current document, where the author placed this AI passage.`,
    MARKDOWN_REPLY,
  ].join('\n');
}
