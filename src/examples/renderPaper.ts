import type { Doc } from '@/editor/types';
import { loadCitationProcessor } from '@/editor/csl/processor';
import { HTML_EXPORT_OPTIONS, type ExportProfile } from '@/export/types';

export async function manuscriptHtml(doc: Doc, includeReferences: boolean, profile: ExportProfile = HTML_EXPORT_OPTIONS.profile) {
  const [{ renderStandaloneHtml }, { renderDocumentDiagrams }] = await Promise.all([
    import('@/export/renderStandaloneHtml'),
    import('@/export/diagrams'),
    loadCitationProcessor(),
  ]);
  const diagrams = await renderDocumentDiagrams(doc.blocks);
  return renderStandaloneHtml(
    doc,
    { ...HTML_EXPORT_OPTIONS, profile, include_title: true, include_references: includeReferences },
    { local_revision: 0, dirty: false },
    diagrams,
  );
}

/**
 * The export as the sample paper page shows it: the page's own sheet on the
 * site's background, without the export's grey surround, margin and shadow
 * (the frame around it draws those). The downloaded file stays as exported.
 */
export function framedPaperHtml(html: string) {
  const host =
    '<style>html,body{background:transparent!important}.document-export{margin:0 auto!important;box-shadow:none!important;min-height:0!important;width:100%!important}</style>';
  return html.includes('</head>') ? html.replace('</head>', `${host}</head>`) : host + html;
}
