import type { Doc } from '@/editor/types';
import { loadCitationProcessor } from '@/editor/csl/processor';
import { HTML_EXPORT_OPTIONS } from '@/export/types';

export async function manuscriptHtml(doc: Doc, includeReferences: boolean) {
  const [{ renderStandaloneHtml }, { renderDocumentDiagrams }] = await Promise.all([
    import('@/export/renderStandaloneHtml'),
    import('@/export/diagrams'),
    loadCitationProcessor(),
  ]);
  const diagrams = await renderDocumentDiagrams(doc.blocks);
  return renderStandaloneHtml(
    doc,
    { ...HTML_EXPORT_OPTIONS, include_title: true, include_references: includeReferences },
    { local_revision: 0, dirty: false },
    diagrams,
  );
}
