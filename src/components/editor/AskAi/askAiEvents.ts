/**
 * Opening the inline "Ask AI" prompt from anywhere.
 *
 * Space on an empty line, Mod+J in a block, `/ai`, the block handle's
 * "Ask AI" and the selection toolbar all open the same prompt surface. They
 * live in different components with no common parent short of the app, so
 * the request travels as a window event, like the slash menu's.
 */
export const ASK_AI_EVENT = 'colwrite:ask-ai';

export type AskAiRequest = {
  /** The block the prompt is anchored to. */
  blockId: string;
  /**
   * Start the prompt with this preset already chosen (an id from
   * `ASK_AI_PRESETS`), for entry points that already know what they want —
   * the selection toolbar's "…" menu. A preset with a submenu (tone,
   * translate) opens on that submenu.
   */
  actionId?: string;
};

export function openAskAi(request: AskAiRequest): void {
  window.dispatchEvent(new CustomEvent<AskAiRequest>(ASK_AI_EVENT, { detail: request }));
}
