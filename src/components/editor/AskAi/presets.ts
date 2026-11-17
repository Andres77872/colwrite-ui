import type { ElementType } from 'react';
import {
  AlignLeft,
  ArrowRight,
  CheckCircle,
  FileText,
  HelpCircle,
  Languages,
  Lightbulb,
  List,
  ListTree,
  Maximize2,
  Minimize2,
  Mic2,
  Printer,
  Scale,
  SearchCheck,
  Shapes,
  Sparkles,
  Table2,
  Wand2,
} from 'lucide-react';
import { compileFigure } from '@/lib/figure/compile';
import { getFigureMeasurer } from '@/lib/figure/measure';
import type { TextMeasurer } from '@/lib/figure/types';
import type { AssistantPreset as CatalogPreset } from '@/data/assistant';

/**
 * What the prompt is about.
 *
 * - `selection` — text selected inside one block;
 * - `block` — the block the caret is in (no selection);
 * - `blocks` — several blocks selected as blocks;
 * - `empty` — an empty line: the prompt writes new content there.
 */
export type AskAiTargetKind = 'selection' | 'block' | 'blocks' | 'empty';

/**
 * What the result is for, which decides the primary action.
 *
 * `replace` — a new version of the target (Replace / Insert below);
 * `insert` — new content that goes after it (Insert below);
 * `note` — commentary about it (Insert as a callout below, or Copy).
 */
export type ResultUse = 'replace' | 'insert' | 'note';

/**
 * The server owns each preset's instruction, including figure grammar.
 * Only an author's custom request supplies its own message.
 */
export type AskAiAsk = { preset: string; message?: string } | { instruction: string };

export type AskAiPreset = {
  id: string;
  label: string;
  icon: ElementType;
  group: CatalogPreset['group'];
  keywords?: readonly string[];
  /** The targets the preset makes sense for. */
  applies: readonly AskAiTargetKind[];
  /** What the run asks; `null` for a submenu, which runs nothing itself. */
  ask: AskAiAsk | null;
  use: ResultUse;
  /** A submenu of variants (tone, language) instead of a task of its own. */
  children?: readonly AskAiPreset[];
  /** Offered only on a structured-figure block — and never on anything else. */
  forFigure?: boolean;
  /**
   * The reply is a structured figure; the server supplies its grammar.
   */
  drawsFigure?: boolean;
  /** Why the server would not run it here (the catalog's reason); offered disabled. */
  unavailable?: string;
};

const TEXT: readonly AskAiTargetKind[] = ['selection', 'block', 'blocks'];

/** Presets for a structured-figure block; the text presets make no sense on JSON. */
const FIGURE_OFFERS: Readonly<Record<string, Offer>> = {
  'figure-from-caption': {
    icon: Shapes,
    keywords: ['draw', 'generate', 'create', 'figure'],
    applies: ['block'],
    forFigure: true,
    drawsFigure: true,
    use: 'replace',
  },
  'figure-improve': {
    icon: Wand2,
    keywords: ['polish', 'better', 'clarity', 'layout'],
    applies: ['block'],
    forFigure: true,
    drawsFigure: true,
    use: 'replace',
  },
  'figure-fix': {
    icon: CheckCircle,
    keywords: ['error', 'repair', 'broken', 'invalid'],
    applies: ['block'],
    forFigure: true,
    drawsFigure: true,
    use: 'replace',
  },
  'figure-print': {
    icon: Printer,
    keywords: ['grayscale', 'greyscale', 'black and white', 'mono', 'accessible', 'colorblind'],
    applies: ['block'],
    forFigure: true,
    drawsFigure: true,
    use: 'replace',
  },
  'figure-simplify': {
    icon: Minimize2,
    keywords: ['shorter', 'simpler', 'cleaner', 'fewer'],
    applies: ['block'],
    forFigure: true,
    drawsFigure: true,
    use: 'replace',
  },
  'figure-explain': {
    icon: HelpCircle,
    keywords: ['describe', 'walk through', 'paragraph', 'alt text'],
    applies: ['block'],
    forFigure: true,
    use: 'insert',
  },
  figure: {
    icon: Shapes,
    keywords: ['figure', 'diagram', 'architecture', 'draw', 'illustrate', 'visualize', 'visualise', 'model', 'pipeline'],
    applies: TEXT,
    drawsFigure: true,
    use: 'insert',
  },
};

/**
 * How Ask AI offers each of the server's inline presets: its icon, the words
 * a search finds it by, the targets it makes sense for and what its result is
 * for. Its label and group are the catalog's. A preset the server adds that
 * this table does not know is still offered, as a note about the text.
 */
type Offer = Pick<AskAiPreset, 'icon' | 'keywords' | 'applies' | 'use' | 'forFigure' | 'drawsFigure'>;
const OFFERS: Readonly<Record<string, Offer>> = {
  ...FIGURE_OFFERS,
  'figure-custom': { icon: Shapes, applies: [], use: 'replace' },
  improve: { icon: Wand2, keywords: ['polish', 'better', 'clarity', 'rewrite'], applies: TEXT, use: 'replace' },
  grammar: { icon: CheckCircle, keywords: ['typo', 'spelling', 'proofread', 'punctuation'], applies: TEXT, use: 'replace' },
  shorter: { icon: Minimize2, keywords: ['concise', 'condense', 'trim', 'tighten'], applies: TEXT, use: 'replace' },
  longer: { icon: Maximize2, keywords: ['expand', 'elaborate', 'detail'], applies: TEXT, use: 'replace' },
  simplify: { icon: AlignLeft, keywords: ['plain', 'easier', 'readable'], applies: TEXT, use: 'replace' },
  bullets: { icon: List, keywords: ['list', 'points', 'bulletize'], applies: TEXT, use: 'replace' },
  table: { icon: Table2, keywords: ['tabulate', 'grid', 'compare'], applies: TEXT, use: 'replace' },
  // Not for a selection: it writes after the block, not after the words.
  continue: { icon: ArrowRight, keywords: ['next', 'more', 'keep going'], applies: ['block', 'blocks', 'empty'], use: 'insert' },
  summarize: { icon: FileText, keywords: ['tldr', 'summary', 'abstract'], applies: TEXT, use: 'insert' },
  explain: { icon: HelpCircle, keywords: ['what', 'meaning', 'clarify'], applies: TEXT, use: 'note' },
  check: { icon: SearchCheck, keywords: ['verify', 'fact', 'evidence', 'support', 'validate'], applies: TEXT, use: 'note' },
  counter: { icon: Scale, keywords: ['critique', 'weakness', 'objection', 'reviewer'], applies: TEXT, use: 'note' },
  outline: { icon: ListTree, keywords: ['structure', 'plan', 'sections', 'headings'], applies: ['empty'], use: 'insert' },
  introduction: { icon: FileText, keywords: ['intro', 'opening', 'motivation'], applies: ['empty'], use: 'insert' },
  abstract: { icon: FileText, keywords: ['summary', 'overview'], applies: ['empty'], use: 'insert' },
  'summary-so-far': { icon: FileText, keywords: ['recap', 'overview', 'tldr'], applies: ['empty'], use: 'insert' },
  brainstorm: { icon: Lightbulb, keywords: ['ideas', 'suggest', 'options'], applies: ['empty'], use: 'insert' },
};
const UNKNOWN_OFFER: Offer = { icon: Sparkles, applies: TEXT, use: 'note' };

/**
 * The server's variants that share one submenu: its id, name, icon and the
 * words it is found by. Each variant's label is the catalog's ("Academic").
 */
const SUBMENUS: ReadonlyArray<{ prefix: string; offer: Omit<AskAiPreset, 'group' | 'children' | 'unavailable'> }> = [
  {
    prefix: 'tone-',
    offer: { id: 'tone', label: 'Change tone', icon: Mic2, keywords: ['voice', 'style', 'formal', 'academic'], applies: TEXT, ask: null, use: 'replace' },
  },
  {
    prefix: 'translate-',
    offer: { id: 'translate', label: 'Translate', icon: Languages, keywords: ['language', 'english', 'spanish'], applies: TEXT, ask: null, use: 'replace' },
  },
];

/** One catalog preset as a menu entry, disabled with the server's reason when it would not run here. */
function catalogEntry(preset: CatalogPreset, offer: Offer): AskAiPreset {
  return {
    id: preset.id,
    label: preset.label,
    group: preset.group,
    ...offer,
    ask: { preset: preset.id },
    ...(preset.state !== 'on' ? { unavailable: preset.reason ?? 'Not available here.' } : {}),
  };
}

/**
 * Ask AI's menu: the server's inline presets in
 * the catalog's order, with its labels and groups, the tones and languages
 * gathered into their submenus.
 */
export function askAiPresets(catalog: readonly CatalogPreset[]): AskAiPreset[] {
  const entries: AskAiPreset[] = [];
  const submenus = new Map<string, AskAiPreset & { children: AskAiPreset[] }>();
  for (const preset of catalog) {
    if (preset.profile !== 'inline') continue;
    const submenu = SUBMENUS.find((candidate) => preset.id.startsWith(candidate.prefix));
    if (!submenu) {
      entries.push(catalogEntry(preset, OFFERS[preset.id] ?? UNKNOWN_OFFER));
      continue;
    }
    let parent = submenus.get(submenu.offer.id);
    if (!parent) {
      parent = { ...submenu.offer, group: preset.group, children: [] };
      submenus.set(submenu.offer.id, parent);
      entries.push(parent);
    }
    parent.children.push(catalogEntry(preset, { icon: submenu.offer.icon, applies: submenu.offer.applies, use: submenu.offer.use }));
  }
  return entries;
}

type PresetGroup = { id: AskAiPreset['group']; label: string };

const GROUP_LABELS: Record<AskAiPreset['group'], string> = {
  write: 'Write',
  edit: 'Edit or review',
  understand: 'Generate',
  research: 'Research',
};

/**
 * The suggestion groups in the order a target wants them: text to work on
 * leads with editing it, an empty line with writing something.
 */
export function presetGroupsFor(target: AskAiTargetKind): PresetGroup[] {
  const order: AskAiPreset['group'][] =
    target === 'empty' ? ['write', 'understand'] : ['edit', 'understand', 'research', 'write'];
  return order.map((id) => ({ id, label: GROUP_LABELS[id] }));
}

/**
 * The free-form prompt, as a preset, so one code path runs everything. On a
 * figure it asks for the changed figure back.
 */
export function customPreset(prompt: string, target: AskAiTargetKind, figure = false): AskAiPreset {
  return {
    id: 'custom',
    label: prompt,
    icon: Sparkles,
    group: 'write',
    applies: [target],
    ask: figure ? { preset: 'figure-custom', message: prompt } : { instruction: prompt },
    use: target === 'empty' ? 'insert' : 'replace',
    ...(figure ? { forFigure: true, drawsFigure: true } : {}),
  };
}

/** The presets of `presets` for a target; a structured figure gets its own set. */
export function presetsFor(presets: readonly AskAiPreset[], target: AskAiTargetKind, query: string, figure = false): AskAiPreset[] {
  const q = query.trim().toLowerCase();
  const applicable = presets.filter(
    (preset) => preset.applies.includes(target) && (preset.forFigure === true) === figure,
  );
  if (!q) return applicable;
  // Searching reaches into submenus, so "spanish" finds Translate › Spanish.
  const flat = applicable.flatMap((preset) =>
    preset.children
      ? preset.children.map((child) => ({ ...child, label: `${preset.label}: ${child.label}` }))
      : [preset],
  );
  return flat.filter(
    (preset) =>
      preset.label.toLowerCase().includes(q) ||
      (preset.keywords ?? []).some((keyword) => keyword.includes(q)),
  );
}

/**
 * What the compiler finds wrong with a figure, as *Fix problems* hands it to
 * the model: some of it (the printed size, a key the language does not have)
 * cannot be seen in the spec text alone. Notes are left out, and so is the
 * print-size warning while anything else is wrong: fixing it means laying
 * the figure out afresh, which a "change nothing else" repair must not do.
 */
export function figureProblems(source: string, measurer: TextMeasurer = getFigureMeasurer()): string[] {
  const found = compileFigure(source, measurer).diagnostics.filter((problem) => problem.severity !== 'info');
  const defects = found.filter((problem) => problem.code !== 'print.small-text');
  return (defects.length > 0 ? defects : found).map((problem) =>
    problem.line !== undefined ? `line ${problem.line}:${problem.column ?? 1} — ${problem.message}` : problem.message,
  );
}
