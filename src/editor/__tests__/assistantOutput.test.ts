import { describe, expect, it } from 'vitest';
import { agentSource } from '@/__tests__/agentSource';
import { resolveAssistantOutput } from '../assistantOutput';
import { assistantOutputBlocks } from '../markdown';

describe('document-owned assistant output', () => {
  it('retains only cited records, deduplicates aliases and keeps unknown handles visible', () => {
    const a = agentSource('S1', { key: 'doi:10.1/a', title: 'A' });
    const alias = { ...a, handle: 'S2' };
    const unused = agentSource('S3', { key: 'doi:10.1/unused', title: 'Unused' });
    const output = resolveAssistantOutput('Claim [S1, S2, S1, S9]. Again [S2]. Unknown [S8].', [a, alias, unused]);
    expect(output).toEqual({
      text: 'Claim [@doi:10.1/a] [S9]. Again [@doi:10.1/a]. Unknown [S8].',
      sources: [a.record],
    });
    const [block] = assistantOutputBlocks(output);
    expect(block?.type === 'paragraph' && block.children).toMatchObject([
      { type: 'citation', keys: [a.key], sources: [a.record] },
      { type: 'citation', keys: [a.key], sources: [a.record] },
    ]);
  });

  it('keeps the latest evidence record for a handle', () => {
    const before = agentSource('S1', { key: 'doi:10.1/a', title: 'Before' });
    const checked = agentSource('S1', { key: 'doi:10.1/a', title: 'Checked', state: 'verified' });
    expect(resolveAssistantOutput('[S1]', [before, checked])).toEqual({
      text: '[@doi:10.1/a]', sources: [checked.record],
    });
  });

  it('renders null and an empty result as no blocks, without inventing a reference', () => {
    expect(assistantOutputBlocks(null)).toEqual([]);
    expect(assistantOutputBlocks({ text: '', sources: [] })).toEqual([]);
    expect(resolveAssistantOutput('Unknown [S1]', [])).toEqual({ text: 'Unknown [S1]', sources: [] });
  });
});
