import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?inline';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff2?inline';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?inline';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?inline';
import sourceSerif400 from '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2?inline';
import sourceSerif400Italic from '@fontsource/source-serif-4/files/source-serif-4-latin-400-italic.woff2?inline';
import sourceSerif600 from '@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2?inline';
import sourceSerif700 from '@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2?inline';
import type { DocumentExportOptions } from './types';
import { katexOfflineCss } from './katexOfflineCss';
import { FIGURE_MATH_CSS } from '@/lib/figure/constants';

function pageDimensions(options: DocumentExportOptions): string {
  return `${options.page_size} ${options.orientation}`;
}

function editorPrintScale(options: DocumentExportOptions): number {
  if (options.orientation === 'landscape') return 1;
  return options.page_size === 'A4' ? 0.84 : 0.87;
}

export function exportStyles(options: DocumentExportOptions): string {
  const scale = editorPrintScale(options);
  return `
@font-face{font-family:"CW Inter";font-style:normal;font-weight:400;src:url("${inter400}") format("woff2")}
@font-face{font-family:"CW Inter";font-style:normal;font-weight:500;src:url("${inter500}") format("woff2")}
@font-face{font-family:"CW Inter";font-style:normal;font-weight:600;src:url("${inter600}") format("woff2")}
@font-face{font-family:"CW Inter";font-style:normal;font-weight:700;src:url("${inter700}") format("woff2")}
@font-face{font-family:"CW Source Serif";font-style:normal;font-weight:400;src:url("${sourceSerif400}") format("woff2")}
@font-face{font-family:"CW Source Serif";font-style:italic;font-weight:400;src:url("${sourceSerif400Italic}") format("woff2")}
@font-face{font-family:"CW Source Serif";font-style:normal;font-weight:600;src:url("${sourceSerif600}") format("woff2")}
@font-face{font-family:"CW Source Serif";font-style:normal;font-weight:700;src:url("${sourceSerif700}") format("woff2")}
${katexOfflineCss}
@page{
  size:${pageDimensions(options)};
  margin:18mm 16mm 20mm;
  @bottom-center{content:counter(page);font-family:"CW Inter";font-size:8pt;color:#6b7280}
}
:root{
  color-scheme:light;
  --color-card:#ffffff;
  --color-chart-grid:#e9e9e7;
  --color-chart-axis:#8994a3;
  /* The app's light series, same order: a category keeps its colour between editor and export. */
  --color-series-1:#2f78d4;
  --color-series-2:#c9501f;
  --color-series-3:#12875f;
  --color-series-4:#a86e00;
  --color-series-5:#c2466f;
  --color-series-6:#067306;
  --color-series-7:#7466d9;
  --color-series-8:#cf4c4c;
  --text-2xs:10px;
}
*{box-sizing:border-box}
html{background:#f3f4f6;font-family:"CW Inter",sans-serif;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;color:#172033;background:#f3f4f6}
.document-export{
  margin:32px auto;
  background:#fff;
  box-shadow:0 14px 40px rgba(15,23,42,.12);
  overflow-wrap:anywhere;
}
.profile-editor-faithful{
  width:800px;
  min-height:100vh;
  padding:48px 56px 72px;
  font-family:"CW Inter",sans-serif;
  font-size:16px;
  color:#e8edf7;
  background:#11131a;
  --color-card:#181b24;
  --color-chart-grid:#343947;
  --color-chart-axis:#71798b;
}
.profile-paper{
  width:min(100% - 48px, 760px);
  min-height:100vh;
  padding:64px 72px 80px;
  font-family:"CW Source Serif",serif;
  font-size:11.5pt;
  color:#1f2937;
  background:#fff;
}
.document-title{margin:0 0 2rem;font-size:2rem;line-height:1.15;font-weight:700;letter-spacing:-.025em}
.export-block{margin:0 0 1em}
.export-heading{font-family:"CW Inter",sans-serif;line-height:1.2;color:inherit;break-after:avoid-page}
.export-heading.level-1{margin:1.6em 0 .65em;font-size:2rem;letter-spacing:-.025em}
.export-heading.level-2{margin:1.45em 0 .55em;font-size:1.5rem;letter-spacing:-.018em}
.export-heading.level-3{margin:1.25em 0 .45em;font-size:1.15rem}
.paragraph-block{column-gap:2rem;column-rule:1px solid rgba(127,137,155,.22)}
.paragraph-run{margin:.55em 0;white-space:pre-wrap;min-height:1em}
.paragraph-run:first-child{margin-top:0}
.paragraph-run:last-child{margin-bottom:0}
.legacy-block{display:block}
a{color:#2563eb;text-decoration:underline;text-underline-offset:.13em}
code,kbd{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}
mark{background:#fef3c7;color:inherit}
.export-list{margin:.4em 0 .9em;padding-left:1.6em}.export-list .export-list{margin:.2em 0}.export-list li{margin:.18em 0}.export-list li>.paragraph-run{margin:0}.todo-list{list-style:none;padding-left:.4em}.todo-item{display:flex;gap:.55em;align-items:baseline}.todo-item>.todo-box{flex:none}.todo-item.is-checked>.paragraph-run{opacity:.6;text-decoration:line-through}.list-spacer{list-style:none}.export-quote{margin:1em 0;padding:.1em 0 .1em 1.1em;border-left:3px solid currentColor;border-left-color:rgba(127,137,155,.55)}.export-callout{margin:1em 0;padding:.75em 1em;border:1px solid rgba(127,137,155,.35);border-radius:8px;background:rgba(127,137,155,.08)}.export-code{margin:1em 0;padding:.85em 1em;border-radius:8px;background:rgba(127,137,155,.12);overflow-x:auto;white-space:pre;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;line-height:1.55;tab-size:4}.export-divider{border:0;border-top:1px solid currentColor;opacity:.28;margin:1.7em 0}
/* Drawings are sized by their root <svg> only (child selectors): KaTeX draws
   radicals, over-arrows and wide accents as inner <svg>s with extreme
   viewBoxes, which height:auto flattens to nothing. */
.export-diagram{margin:1.3em 0;display:flex;justify-content:center;break-inside:avoid-page}.export-diagram>svg{max-width:100%;height:auto}
/* Structured figures: drawn at natural size, shrunk only to fit the column;
   the caption centres when short and justifies when long (LaTeX's rule). */
.export-figure{margin:1.4em 0;break-inside:avoid-page}
.export-figure .figure-canvas{margin:0 auto;max-width:100%}
.export-figure .figure-canvas>svg{display:block;width:100%;height:auto}
.figure-caption{display:table;max-width:100%;margin:.65em auto 0;text-align:justify;hyphens:auto;font-size:.86em;line-height:1.45}
.figure-caption-number{font-weight:600}
.profile-paper .figure-caption{font-family:"CW Source Serif",serif}
${FIGURE_MATH_CSS}
.citation{white-space:normal}
/* A citation number is a link but reads as body text: underlining every one of
   them turns a cited paragraph into a rash of blue. */
.citation a{color:inherit;text-decoration:none}
.citation a:hover{text-decoration:underline}
.references{margin-top:2.2em;break-before:auto}
.references .export-heading{margin-top:0}
.reference-list{list-style:none;margin:0;padding:0;font-size:.92em}
.reference-item{display:flex;gap:.6em;margin:0 0 .55em;break-inside:avoid}
.reference-marker{flex:0 0 auto;min-width:2.2em;font-variant-numeric:tabular-nums;color:#596273}
.reference-marker:empty{display:none}
.reference-body{min-width:0}
.reference-link{overflow-wrap:anywhere}
.reference-backlinks{margin-left:.4em;white-space:nowrap}
.reference-backlink{margin-right:.25em;font-size:.85em;text-decoration:none;font-variant-numeric:tabular-nums}
.reference-backlink:hover{text-decoration:underline}
.profile-editor-faithful .reference-marker{color:#9aa3b4}
.display-equation{
  display:grid;
  grid-template-columns:1fr auto 1fr;
  align-items:center;
  gap:1rem;
  margin:1.2em 0;
  overflow-x:auto;
  break-inside:avoid-page;
}
.display-equation .math{grid-column:2}
.equation-number{grid-column:3;justify-self:end;font-family:"CW Inter",sans-serif;font-size:.9em}
.equation-error{font-family:ui-monospace,monospace;color:#b91c1c}
.export-table-figure,.export-graph{margin:1.3em 0;break-inside:auto}
.export-table{width:100%;border-collapse:collapse;font-family:"CW Inter",sans-serif;font-size:.88em}
.export-table caption,.export-graph figcaption{caption-side:bottom;text-align:left;margin-top:.55em;color:#596273;font-size:.86em}
.export-table th,.export-table td{border:1px solid #cbd2dc;padding:.48em .6em;vertical-align:top;white-space:pre-wrap}
.export-table th{background:#eef1f5;font-weight:600}
.export-table thead{display:table-header-group}
.export-table tr{break-inside:avoid}
.export-graph{border:1px solid #d8dee8;border-radius:7px;padding:.75em;background:var(--color-card);font-family:"CW Inter",sans-serif}
.graph-title{margin:0 0 .35em;font-size:.95em;font-weight:600}
.export-graph svg{display:block;width:100%;max-height:420px}
.export-graph .fill-muted-foreground{fill:#6b7280}
.export-graph .fill-foreground{fill:#1f2937}
.export-graph .w-full{width:100%}
.export-graph .h-40{height:10rem}
.export-graph .w-40{width:10rem}
.export-graph ul{list-style:none;margin:.5em 0 0;padding:0}
.export-graph li{display:flex;gap:.5em;align-items:center}
.ai-beat-card{margin:1em 0;padding:1em;border:1px dashed #94a3b8;border-radius:7px;background:#f8fafc}
.ai-beat-label{font-family:"CW Inter",sans-serif;font-size:.72em;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
.ai-beat-message{font-weight:600}
.export-warning{margin:1em 0;padding:.75em;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;font-family:"CW Inter",sans-serif;font-size:.85em}
.profile-editor-faithful .export-table th{background:#232733}
.profile-editor-faithful .export-table th,.profile-editor-faithful .export-table td{border-color:#3a4050}
.profile-editor-faithful .export-graph{border-color:#3a4050}
.profile-editor-faithful .export-graph .fill-muted-foreground{fill:#9aa3b4}
.profile-editor-faithful .export-graph .fill-foreground{fill:#e8edf7}
.profile-editor-faithful a{color:#79a7ff}
figure,.display-equation{break-inside:avoid-page}
h1,h2,h3{break-after:avoid-page}
p{orphans:3;widows:3}
@media print{
  html,body{background:#fff}
  .document-export{margin:0;box-shadow:none;min-height:0}
  .profile-paper{width:auto;padding:0}
  .profile-editor-faithful{width:800px;padding:48px 56px 72px;zoom:${scale}}
}
@media(max-width:860px){
  .document-export{width:100%;margin:0;box-shadow:none;padding:32px 24px}
}
`;
}
