import { toEditorDoc } from '@/api/content';
import { fixtureDocument } from '@/dev/fixtureDocument';
import { wireBlock } from '@/dev/wireBlock';
import { isCitationStyle } from '@/editor/csl/styles';
import type { Doc } from '@/editor/types';

export function sampleManuscript(): Doc {
  const { name, citationStyle, sources, blocks } = fixtureDocument();
  return toEditorDoc({
    schema_version: 1,
    name,
    blocks: blocks.map(wireBlock),
    sources,
    citationStyle: isCitationStyle(citationStyle) ? citationStyle : null,
    instructions: null,
    documentType: null,
  });
}

export function figureSource(doc: Doc, language: 'figure' | 'mermaid') {
  const block = doc.blocks.find((item) => item.type === 'code' && item.language === language);
  if (block?.type !== 'code') throw new Error(`Missing ${language} block in the sample manuscript`);
  return block.text;
}
