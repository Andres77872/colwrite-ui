import { describe, expect, it } from 'vitest';
import { customPreset } from './presets';
import { askAiContext, askAiRequest, targetRefusal, type AskAiTarget } from './target';

/** The server's bounds on `context` (`AgentContext`). */
const MAX_SELECTION_CHARS = 4_000;
const MAX_CONTEXT_BLOCKS = 20;

const base: AskAiTarget = {
  key: 't', kind: 'block', blockIds: ['b1'], anchorId: 'b1', text: '', locked: false, hidden: false, citations: new Map(),
};
/** The author's own prompt, which is sent as a message. */
const typed = customPreset('Make it shorter', 'selection');

describe('the Ask AI target as `context`', () => {
  it('names each kind of target by its ids', () => {
    expect(askAiContext(base)).toEqual({ block_id: 'b1', block_ids: ['b1'] });
    expect(askAiContext({ ...base, kind: 'blocks', blockIds: ['a', 'b'], anchorId: 'b' })).toEqual({ block_id: 'b', block_ids: ['a', 'b'] });
    expect(askAiContext({ ...base, kind: 'selection', selection: 'some words' })).toEqual({
      block_id: 'b1', selection: { block_id: 'b1', text: 'some words' },
    });
    expect(askAiContext({ ...base, kind: 'empty', nearbyIds: ['x', 'y'] })).toEqual({ block_id: 'b1', block_ids: ['x', 'y'] });
    expect(askAiContext({ ...base, kind: 'empty', nearbyIds: [] })).toEqual({ block_id: 'b1' });
  });

  it('quotes nothing of the page in the message', () => {
    const { message } = askAiRequest({ preset: typed, target: { ...base, kind: 'selection', selection: 'Quoted words', text: 'Quoted words' } });
    expect(message).toContain('Task: Make it shorter');
    expect(message).toContain('selected in block `b1`');
    expect(message).not.toContain('Quoted words');
  });

  it('keeps a refinement’s previous result, which is the assistant’s own text', () => {
    const { message, context } = askAiRequest({ preset: typed, target: base, previous: 'An earlier answer.' });
    expect(context.previous_result).toBe('An earlier answer.');
    expect(message).not.toContain('An earlier answer.');
  });
});

describe('targets Ask AI refuses', () => {
  it('refuses a hidden block, and a selection or block set past the server’s bounds', () => {
    expect(targetRefusal(base)).toBeNull();
    expect(targetRefusal({ ...base, hidden: true })).toMatch(/hidden from the assistant/);
    expect(targetRefusal({ ...base, kind: 'selection', selection: 'x'.repeat(MAX_SELECTION_CHARS) })).toBeNull();
    expect(targetRefusal({ ...base, kind: 'selection', selection: 'x'.repeat(MAX_SELECTION_CHARS + 1) })).toMatch(/at most 4,000 selected characters/);
    const many = Array.from({ length: MAX_CONTEXT_BLOCKS + 1 }, (_, i) => `b${i}`);
    expect(targetRefusal({ ...base, kind: 'blocks', blockIds: many })).toMatch(/at most 20 blocks/);
  });
});
