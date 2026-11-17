// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The UI calls a document a "page" (docs/workspace_collection/14-ux-review.md §4).
 * This scans the source for copy an author can see and fails on the word
 * "document" or "documents". Code identifiers, the DOM's `document`, imports,
 * comments and CSS class names are not copy, so they are not read.
 *
 * What counts as copy:
 * - JSX text;
 * - any string literal written as prose (it has a space in it);
 * - any string literal, even one word, given to a UI prop or key (`UI_NAMES`),
 *   or placed straight into JSX as `{'…'}` or `{cond ? '…' : '…'}`.
 */

const SRC = resolve(__dirname, '..');

/** Files that are not author-facing copy. */
const EXEMPT_FILES: readonly RegExp[] = [
  /\.test\.tsx?$/,
  /(^|\/)__tests__\//,
  /^dev\//, // the in-browser mock API
  /^export\//, // HTML and print export internals
  /^components\/panels\/JsonPanel\//, // the developer view, "Document JSON"
  /^lib\/figure\//, // the figure spec language: the model's reference, sample figures, the `document` shape
  /^components\/editor\/blocks\/DiagramBlock\/diagramTemplates\.ts$/, // sample diagram code
];

/**
 * Files that build instructions for the model. Only their UI keys (a preset's
 * `label`, `description`, …) are copy; the rest is prompt text.
 */
const MODEL_TEXT_FILES: readonly RegExp[] = [/^components\/editor\/AskAi\/(presets|target)\.ts$/];

/** Object keys whose strings go to the model, never to the screen. */
const MODEL_KEYS = new Set(['instruction', 'prompt']);

/** Object keys whose strings are matched but never shown: search synonyms. */
const HIDDEN_KEYS = new Set(['keywords']);

/** JSX props and object keys whose string is shown, or read out, to the author. */
const UI_NAMES = new Set([
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'alt',
  'title',
  'placeholder',
  'label',
  'description',
  'hint',
  'confirmLabel',
  'cancelLabel',
  'group',
  'message',
  'detail',
  'regionLabel',
  'running',
]);

/** The only copy allowed to say "document": the developer view's name. */
const ALLOWED = new Set(['Document JSON']);

/** "document" as a word, not part of an identifier, a path or a class name. */
const WORD = /(?<![\w.\-/#])documents?(?![\w\-/])/i;

type Hit = { file: string; line: number; text: string };
type Context = 'ui' | 'model' | 'code' | 'other';

const PASS_THROUGH_OPERATORS = new Set([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.PlusToken,
]);

function nameOf(name: ts.Node): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isJsxNamespacedName(name)) return `${name.namespace.text}:${name.name.text}`;
  return '';
}

/**
 * Walks up from a string through expressions that pass it on unchanged
 * (`a ? b : c`, `a ?? b`, `(…)`, `${…}`, `as const`) and says where it lands.
 */
function contextOf(node: ts.Node): Context {
  let current: ts.Node = node;
  for (let parent = current.parent; parent; current = parent, parent = parent.parent) {
    const passes =
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isTemplateSpan(parent) ||
      ts.isTemplateExpression(parent) ||
      (ts.isConditionalExpression(parent) && parent.condition !== current) ||
      (ts.isBinaryExpression(parent) && PASS_THROUGH_OPERATORS.has(parent.operatorToken.kind));
    if (passes) continue;
    if (ts.isJsxAttribute(parent)) return UI_NAMES.has(nameOf(parent.name)) ? 'ui' : 'other';
    if (ts.isJsxExpression(parent)) {
      const holder = parent.parent;
      if (ts.isJsxAttribute(holder)) return UI_NAMES.has(nameOf(holder.name)) ? 'ui' : 'other';
      return ts.isJsxElement(holder) || ts.isJsxFragment(holder) ? 'ui' : 'other';
    }
    if (ts.isPropertyAssignment(parent)) {
      if (parent.name === current) return 'code';
      const key = nameOf(parent.name);
      if (HIDDEN_KEYS.has(key)) return 'code';
      return MODEL_KEYS.has(key) ? 'model' : UI_NAMES.has(key) ? 'ui' : 'other';
    }
    if (
      ts.isImportDeclaration(parent) ||
      ts.isExportDeclaration(parent) ||
      ts.isImportTypeNode(parent) ||
      ts.isElementAccessExpression(parent) ||
      ts.isPropertySignature(parent)
    ) {
      return 'code';
    }
    return 'other';
  }
  return 'other';
}

function templateText(node: ts.TemplateExpression): string {
  return node.head.text + node.templateSpans.map((span) => `\${…}${span.literal.text}`).join('');
}

function scan(file: string, text: string): Hit[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const modelFile = MODEL_TEXT_FILES.some((rule) => rule.test(file));
  const hits: Hit[] = [];

  const report = (node: ts.Node, copy: string) => {
    const trimmed = copy.replace(/\s+/g, ' ').trim();
    if (!WORD.test(trimmed) || ALLOWED.has(trimmed)) return;
    // The line of the word itself, so multi-line JSX text points at it.
    const start = node.getStart(sf);
    const at = sf.text.slice(start, node.getEnd()).search(WORD);
    const line = sf.getLineAndCharacterOfPosition(start + Math.max(at, 0)).line + 1;
    hits.push({ file, line, text: trimmed });
  };

  const readString = (node: ts.Node, copy: string) => {
    const context = contextOf(node);
    if (context === 'ui' || (!modelFile && context === 'other' && /\s/.test(copy.trim()))) report(node, copy);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (!modelFile) report(node, node.text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      readString(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      // The strings inside `${…}` are visited on their own below.
      readString(node, templateText(node));
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return hits;
}

function sourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .map((path) => path.split('\\').join('/'))
    .filter((path) => /\.tsx?$/.test(path) && !path.endsWith('.d.ts'))
    .filter((path) => !EXEMPT_FILES.some((rule) => rule.test(path)))
    .sort();
}

describe('UI copy', () => {
  it('calls a document a "page" outside the developer views', () => {
    const hits = sourceFiles().flatMap((file) => scan(file, readFileSync(resolve(SRC, file), 'utf8')));
    expect(hits.map((hit) => `src/${hit.file}:${hit.line}  ${hit.text}`)).toEqual([]);
  });

  it('reads JSX text, prose and UI props, and skips code, comments and prompts', () => {
    const sample = [
      "import { load } from '@/data/documents';", // 1
      '// a comment about the document', // 2
      "const kind = 'document';", // 3
      "const el = document.querySelector('.document-container');", // 4
      'export const A = () => (', // 5
      '  <div className="document-container" aria-label="Open document">', // 6
      '    Create your first document', // 7
      "    {busy ? 'Saving…' : 'Documents'}", // 8
      '  </div>', // 9
      ');', // 10
      "toast({ title: 'Document deleted' });", // 11
      "const preset = { label: 'Document JSON', instruction: 'Summarize the document.' };", // 12
      "const message = `Could not open ${name}, the document is gone.`;", // 13
      "type Kind = { 'document': string };", // 14
    ].join('\n');
    expect(scan('sample.tsx', sample).map((hit) => hit.line)).toEqual([6, 7, 8, 11, 13]);
  });
});
