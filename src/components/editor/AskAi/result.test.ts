import { takeItems } from '@/lib/itemAt';
import { describe, expect, it } from 'vitest';
import type { ParagraphBlock } from '@/editor';
import { agentSource } from '@/__tests__/agentSource';
import { presetGroupsFor, askAiPresets, presetsFor } from './presets';
import { PERSONAL_WORKSPACE_ID, catalogOf } from '@/dev/msw/fixtures';
import { resultBlocks } from './result';

const NONE = new Map();

function onlyParagraph(blocks: ReturnType<typeof resultBlocks>): ParagraphBlock {
  expect(blocks).toHaveLength(1);
  const [block] = takeItems(blocks, 1);
  if (block.type !== 'paragraph') throw new Error('Expected a paragraph');
  return block;
}

/** Every placeholder in the html has its child, and every child its placeholder. */
function expectConsistent(block: ParagraphBlock) {
  const placeholders = Array.from(block.html.matchAll(/data-child-id="([^"]+)"/g), (match) => match[1]);
  expect(placeholders.sort()).toEqual((block.children ?? []).map((child) => child.id).sort());
}

describe('Ask AI results', () => {
  it('resolves [S#] handles to the sources the run returned, and leaves unknown ones as text', () => {
    const sources = [agentSource('S1', { key: 'arxiv:2101.03961', title: 'Switch Transformers', provider: 'semantic_scholar' })];
    const block = onlyParagraph(
      resultBlocks({ text: 'Compute stays flat [S1] but not [S9].', citations: NONE, sources }),
    );
    expect(block.children).toEqual([
      expect.objectContaining({
        type: 'citation',
        keys: ['arxiv:2101.03961'],
        sources: [sources[0]?.record],
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
    const presets = askAiPresets(catalogOf(PERSONAL_WORKSPACE_ID).presets);
    expect(presetsFor(presets, 'selection', '').some((preset) => preset.id === 'continue')).toBe(false);
    expect(presetsFor(presets, 'block', '').some((preset) => preset.id === 'continue')).toBe(true);
  });
});
