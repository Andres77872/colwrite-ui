import { describe, expect, it } from 'vitest';
import type { ParagraphBlock } from '@/editor';
import type { AgentSource } from '@/services/streamParser';
import { presetGroupsFor, presetsFor } from './presets';
import { resultBlocks } from './result';

const NONE = new Map();

function onlyParagraph(blocks: ReturnType<typeof resultBlocks>): ParagraphBlock {
  expect(blocks).toHaveLength(1);
  const [block] = blocks;
  if (block.type !== 'paragraph') throw new Error('Expected a paragraph');
  return block;
}

/** Every placeholder in the html has its child, and every child its placeholder. */
function expectConsistent(block: ParagraphBlock) {
  const placeholders = Array.from(block.html.matchAll(/data-child-id="([^"]+)"/g), (match) => match[1]);
  expect(placeholders.sort()).toEqual((block.children ?? []).map((child) => child.id).sort());
}

describe('Ask AI results', () => {
  it('turns citation tags into citation widgets, placeholder and child together', () => {
    const block = onlyParagraph(
      resultBlocks({
        text: 'Supported <citation title="A Study" key="a" url="https://example.test/a" /> here.',
        citationTags: true,
        citations: NONE,
        sources: [],
      }),
    );
    expect(block.children).toEqual([expect.objectContaining({ type: 'citation', keys: ['a'] })]);
    expectConsistent(block);
  });

  it('never lets unreadable citation markup reach the document as text', () => {
    const block = onlyParagraph(
      resultBlocks({
        text: 'Claim <citation title="unreadable" onclick="x" /> end.',
        citationTags: true,
        citations: NONE,
        sources: [],
      }),
    );
    expect(block.html).not.toContain('citation');
    expect(block.children ?? []).toEqual([]);
  });

  it('resolves [S#] handles to the sources the run returned, and leaves unknown ones as text', () => {
    const sources: AgentSource[] = [
      { id: 'S1', key: '2101.03961', title: 'Switch Transformers', provider: 'semantic_scholar' },
    ];
    const block = onlyParagraph(
      resultBlocks({ text: 'Compute stays flat [S1] but not [S9].', citationTags: false, citations: NONE, sources }),
    );
    expect(block.children).toEqual([
      expect.objectContaining({
        type: 'citation',
        keys: ['2101.03961'],
        sources: [expect.objectContaining({ title: 'Switch Transformers' })],
      }),
    ]);
    expect(block.html).toContain('[S9]');
    expect(block.html).not.toContain('[S1]');
    expectConsistent(block);
  });
});

describe('Ask AI suggestions', () => {
  it('leads with editing for text and with writing for an empty line', () => {
    expect(presetGroupsFor('selection').map((group) => group.label)).toEqual([
      'Edit or review',
      'Generate',
      'Research',
      'Write',
    ]);
    expect(presetGroupsFor('empty').map((group) => group.label)).toEqual(['Write', 'Generate']);
  });

  it('does not offer "Continue writing" for a selection', () => {
    expect(presetsFor('selection', '').some((preset) => preset.id === 'continue')).toBe(false);
    expect(presetsFor('block', '').some((preset) => preset.id === 'continue')).toBe(true);
  });
});
