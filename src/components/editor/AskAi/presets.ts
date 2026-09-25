import type { ElementType } from 'react';
import {
  AlignLeft,
  ArrowRight,
  BookMarked,
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
import { FIGURE_SPEC_PROMPT, figureRepairInstruction } from '@/lib/figure/prompt';
import type { TextMeasurer } from '@/lib/figure/types';

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

export type AskAiPreset = {
  id: string;
  label: string;
  icon: ElementType;
  group: 'edit' | 'understand' | 'research' | 'write';
  keywords?: readonly string[];
  /** The targets the preset makes sense for. */
  applies: readonly AskAiTargetKind[];
  /** The task, as an instruction to the model. */
  instruction: string;
  use: ResultUse;
  /** A submenu of variants (tone, language) instead of a task of its own. */
  children?: readonly AskAiPreset[];
  /**
   * Routes through the citation pipeline, whose output is tagged text rather
   * than markdown. Needs the `search_citations` tool enabled.
   */
  citations?: boolean;
  /** Offered only on a structured-figure block — and never on anything else. */
  forFigure?: boolean;
  /**
   * The reply is a structured figure: the message carries the spec language
   * and asks for exactly one ```figure fence.
   */
  drawsFigure?: boolean;
};

const TEXT: readonly AskAiTargetKind[] = ['selection', 'block', 'blocks'];

function tone(id: string, label: string, description: string): AskAiPreset {
  return {
    id: `tone-${id}`,
    label,
    icon: Mic2,
    group: 'edit',
    applies: TEXT,
    instruction: `Rewrite the passage in a ${description} tone. Keep its meaning, claims, terminology and notation.`,
    use: 'replace',
  };
}

function language(id: string, label: string): AskAiPreset {
  return {
    id: `translate-${id}`,
    label,
    icon: Languages,
    group: 'edit',
    applies: TEXT,
    instruction: `Translate the passage into ${label}. Keep mathematics, citation markers and proper names as they are.`,
    use: 'replace',
  };
}

/** Presets for a structured-figure block; the text presets make no sense on JSON. */
const FIGURE_PRESETS: readonly AskAiPreset[] = [
  {
    id: 'figure-from-caption',
    label: 'Draw from the caption',
    icon: Shapes,
    group: 'write',
    keywords: ['draw', 'generate', 'create', 'figure'],
    applies: ['block'],
    forFigure: true,
    drawsFigure: true,
    instruction:
      'Draw the figure its caption describes (or, when there is no caption, the figure the surrounding section needs). Keep the caption, sharpening it if it is vague.',
    use: 'replace',
  },
  {
    id: 'figure-improve',
    label: 'Improve the figure',
    icon: Wand2,
    group: 'edit',
    keywords: ['polish', 'better', 'clarity', 'layout'],
    applies: ['block'],
    forFigure: true,
    drawsFigure: true,
    instruction:
      'Improve the figure for a paper: short clear labels, roles used consistently, maths in labels where the text uses notation, a legend when a pattern or line style carries meaning, and a caption that says what to notice. Keep what it shows.',
    use: 'replace',
  },
  {
    id: 'figure-fix',
    label: 'Fix problems',
    icon: CheckCircle,
    group: 'edit',
    keywords: ['error', 'repair', 'broken', 'invalid'],
    applies: ['block'],
    forFigure: true,
    drawsFigure: true,
    instruction:
      'Fix the figure spec so that it is valid JSON, uses only documented keys, and every edge names an existing node (correct misspelt ids). Change nothing the figure shows.',
    use: 'replace',
  },
  {
    id: 'figure-print',
    label: 'Make print-safe',
    icon: Printer,
    group: 'edit',
    keywords: ['grayscale', 'greyscale', 'black and white', 'mono', 'accessible', 'colorblind'],
    applies: ['block'],
    forFigure: true,
    drawsFigure: true,
    instruction:
      'Make the figure legible in grayscale print and for colour-blind readers: set "palette": "mono", make every distinction that relies on colour also visible through a pattern, border or line style, and add a legend where needed.',
    use: 'replace',
  },
  {
    id: 'figure-simplify',
    label: 'Simplify the figure',
    icon: Minimize2,
    group: 'edit',
    keywords: ['shorter', 'simpler', 'cleaner', 'fewer'],
    applies: ['block'],
    forFigure: true,
    drawsFigure: true,
    instruction:
      'Simplify the figure: merge minor steps, shorten labels, drop decoration that carries no meaning, and keep the essential structure.',
    use: 'replace',
  },
  {
    id: 'figure-explain',
    label: 'Explain the figure',
    icon: HelpCircle,
    group: 'understand',
    keywords: ['describe', 'walk through', 'paragraph', 'alt text'],
    applies: ['block'],
    forFigure: true,
    instruction:
      'Write one paragraph for the paper that walks the reader through this figure, in the order the data flows, referring to it as "the figure".',
    use: 'insert',
  },
];

export const ASK_AI_PRESETS: readonly AskAiPreset[] = [
  ...FIGURE_PRESETS,
  // ── Edit ──
  {
    id: 'improve',
    label: 'Improve writing',
    icon: Wand2,
    group: 'edit',
    keywords: ['polish', 'better', 'clarity', 'rewrite'],
    applies: TEXT,
    instruction: 'Improve the clarity, flow and precision of the passage. Keep its meaning, claims and register.',
    use: 'replace',
  },
  {
    id: 'grammar',
    label: 'Fix spelling & grammar',
    icon: CheckCircle,
    group: 'edit',
    keywords: ['typo', 'spelling', 'proofread', 'punctuation'],
    applies: TEXT,
    instruction: 'Fix spelling, grammar and punctuation. Change nothing else.',
    use: 'replace',
  },
  {
    id: 'shorter',
    label: 'Make shorter',
    icon: Minimize2,
    group: 'edit',
    keywords: ['concise', 'condense', 'trim', 'tighten'],
    applies: TEXT,
    instruction: 'Make the passage shorter and more concise while keeping every key point.',
    use: 'replace',
  },
  {
    id: 'longer',
    label: 'Make longer',
    icon: Maximize2,
    group: 'edit',
    keywords: ['expand', 'elaborate', 'detail'],
    applies: TEXT,
    instruction: 'Expand the passage with more explanation and detail, without adding claims it cannot support.',
    use: 'replace',
  },
  {
    id: 'simplify',
    label: 'Simplify language',
    icon: AlignLeft,
    group: 'edit',
    keywords: ['plain', 'easier', 'readable'],
    applies: TEXT,
    instruction: 'Rewrite the passage in plainer, easier language for a non-specialist reader. Keep it accurate.',
    use: 'replace',
  },
  {
    id: 'tone',
    label: 'Change tone',
    icon: Mic2,
    group: 'edit',
    keywords: ['voice', 'style', 'formal', 'academic'],
    applies: TEXT,
    instruction: '',
    use: 'replace',
    children: [
      tone('academic', 'Academic', 'formal academic'),
      tone('professional', 'Professional', 'clear, professional'),
      tone('confident', 'Confident', 'confident, direct'),
      tone('neutral', 'Neutral', 'neutral, measured'),
      tone('friendly', 'Friendly', 'warm, approachable'),
    ],
  },
  {
    id: 'translate',
    label: 'Translate',
    icon: Languages,
    group: 'edit',
    keywords: ['language', 'english', 'spanish'],
    applies: TEXT,
    instruction: '',
    use: 'replace',
    children: [
      language('en', 'English'),
      language('es', 'Spanish'),
      language('fr', 'French'),
      language('de', 'German'),
      language('pt', 'Portuguese'),
      language('it', 'Italian'),
      language('zh', 'Chinese (Simplified)'),
      language('ja', 'Japanese'),
    ],
  },
  {
    id: 'bullets',
    label: 'Turn into bullet points',
    icon: List,
    group: 'edit',
    keywords: ['list', 'points', 'bulletize'],
    applies: TEXT,
    instruction: 'Restate the passage as a concise Markdown bulleted list.',
    use: 'replace',
  },
  {
    id: 'table',
    label: 'Turn into a table',
    icon: Table2,
    group: 'edit',
    keywords: ['tabulate', 'grid', 'compare'],
    applies: TEXT,
    instruction: 'Restate the information in the passage as a Markdown pipe table with a header row.',
    use: 'replace',
  },
  {
    id: 'figure',
    label: 'Draw as a figure',
    icon: Shapes,
    group: 'understand',
    keywords: ['figure', 'diagram', 'architecture', 'draw', 'illustrate', 'visualize', 'visualise', 'model', 'pipeline'],
    applies: TEXT,
    drawsFigure: true,
    instruction:
      'Draw what the passage describes — the architecture, mechanism, pipeline or workflow it explains — as one structured figure with a caption. Use the passage\'s own names and notation.',
    use: 'insert',
  },
  {
    id: 'continue',
    label: 'Continue writing',
    icon: ArrowRight,
    group: 'understand',
    keywords: ['next', 'more', 'keep going'],
    // Not for a selection: it writes after the block, not after the words.
    applies: ['block', 'blocks', 'empty'],
    instruction:
      'Continue the text from where it ends, in the same voice, as the next one or two paragraphs. Return only the new text, not the passage itself.',
    use: 'insert',
  },

  // ── Understand ──
  {
    id: 'summarize',
    label: 'Summarize',
    icon: FileText,
    group: 'understand',
    keywords: ['tldr', 'summary', 'abstract'],
    applies: TEXT,
    instruction: 'Summarize the passage in two or three sentences.',
    use: 'insert',
  },
  {
    id: 'explain',
    label: 'Explain this',
    icon: HelpCircle,
    group: 'understand',
    keywords: ['what', 'meaning', 'clarify'],
    applies: TEXT,
    instruction:
      'Explain the passage for a reader new to the topic: what it says, the terms it relies on and why it matters. Be brief.',
    use: 'note',
  },

  // ── Research ──
  {
    id: 'cite',
    label: 'Find citations',
    icon: BookMarked,
    group: 'research',
    keywords: ['cite', 'references', 'sources', 'papers', 'bibliography'],
    applies: ['selection', 'block'],
    instruction: 'Use the search_citations tool on the passage.',
    use: 'replace',
    citations: true,
  },
  {
    id: 'check',
    label: 'Check the claims',
    icon: SearchCheck,
    group: 'research',
    keywords: ['verify', 'fact', 'evidence', 'support', 'validate'],
    applies: TEXT,
    instruction:
      'List the factual claims the passage makes and, for each, say whether the literature supports it, contradicts it, or whether the evidence is insufficient. Use the research tools available to you and name the sources you relied on. Do not invent sources.',
    use: 'note',
  },
  {
    id: 'counter',
    label: 'Find counterarguments',
    icon: Scale,
    group: 'research',
    keywords: ['critique', 'weakness', 'objection', 'reviewer'],
    applies: TEXT,
    instruction:
      'As a critical reviewer, give the strongest objections, limitations or counterarguments to the passage, briefly.',
    use: 'note',
  },

  // ── Write (empty line) ──
  {
    id: 'outline',
    label: 'Draft an outline',
    icon: ListTree,
    group: 'write',
    keywords: ['structure', 'plan', 'sections', 'headings'],
    applies: ['empty'],
    instruction:
      'Draft an outline for this document as Markdown headings with one-line notes under each, based on its title and what is written so far.',
    use: 'insert',
  },
  {
    id: 'introduction',
    label: 'Write an introduction',
    icon: FileText,
    group: 'write',
    keywords: ['intro', 'opening', 'motivation'],
    applies: ['empty'],
    instruction:
      'Write an introduction for this document based on its title and content so far: the problem, why it matters, and what the document contributes.',
    use: 'insert',
  },
  {
    id: 'abstract',
    label: 'Write an abstract',
    icon: FileText,
    group: 'write',
    keywords: ['summary', 'overview'],
    applies: ['empty'],
    instruction: 'Write a single-paragraph abstract (at most 200 words) of this document as it stands.',
    use: 'insert',
  },
  {
    id: 'summary-so-far',
    label: 'Summarize the document',
    icon: FileText,
    group: 'understand',
    keywords: ['recap', 'overview', 'tldr'],
    applies: ['empty'],
    instruction: 'Summarize the document so far in a short paragraph.',
    use: 'insert',
  },
  {
    id: 'brainstorm',
    label: 'Brainstorm ideas',
    icon: Lightbulb,
    group: 'write',
    keywords: ['ideas', 'suggest', 'options'],
    applies: ['empty'],
    instruction: 'Brainstorm ideas for what this part of the document could cover next, as a short Markdown bulleted list.',
    use: 'insert',
  },
];

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
    instruction: prompt,
    use: target === 'empty' ? 'insert' : 'replace',
    ...(figure ? { forFigure: true, drawsFigure: true } : {}),
  };
}

/** The presets for a target; a structured figure gets its own set. */
export function presetsFor(target: AskAiTargetKind, query: string, figure = false): AskAiPreset[] {
  const q = query.trim().toLowerCase();
  const applicable = ASK_AI_PRESETS.filter(
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

/**
 * The message for a rewrite-mode run.
 *
 * The server injects the stored document into the model's context, so the
 * message only names the task and quotes the target. The format rules matter
 * more than they look: the reply is parsed as markdown into real blocks, so a
 * preamble ("Here is the improved version:") would land in the document.
 */
export function buildAskAiMessage({
  preset,
  target,
  markdown,
  anchorText,
  previous,
  problems,
}: {
  preset: AskAiPreset;
  target: AskAiTargetKind;
  /** The target as markdown (empty for an empty line). */
  markdown: string;
  /** For an empty line: the text of the block just above, if any. */
  anchorText?: string;
  /** A refinement: the previous result the author wants changed. */
  previous?: string;
  /** For *Fix problems* on a figure: the compiler's findings (`figureProblems`). */
  problems?: readonly string[];
}): string {
  if (preset.citations) {
    return [
      preset.instruction,
      'Reply with the replacement text only — no preamble, no explanation, no quotes, no markdown fences.',
      '',
      markdown,
    ].join('\n');
  }

  const where =
    target === 'empty'
      ? anchorText
        ? `The author's caret is on an empty line directly after this text in the document: "${anchorText.slice(-400)}"`
        : "The author's caret is on an empty line at the start of the document."
      : target === 'selection'
        ? 'The passage is text the author selected in the document.'
        : 'The passage is part of the document.';

  const format = preset.drawsFigure
    ? [
        'Reply with exactly one ```figure fenced block holding the complete JSON spec of the figure, and nothing',
        'else: no preamble, no explanation after it.',
      ].join(' ')
    : [
        'Reply with the result only, as Markdown: paragraphs, "#"/"##"/"###" headings, "-" or "1." lists,',
        '"- [ ]" to-dos, "> " quotes, pipe tables, fenced code, and $…$ / $$…$$ for mathematics.',
        'No preamble, no closing remarks, no code fence around the whole reply.',
        'Citation markers such as [@10.1145/3442188] refer to the document\'s real sources: keep every one',
        'that still applies exactly as written, and never invent a new one.',
      ].join(' ');

  const about = preset.forFigure
    ? 'The passage is a structured figure in the document: a ```figure block whose JSON spec the editor lays out and draws.'
    : where;
  const lines = [`Task: ${preset.instruction}`, about, format];
  if (preset.drawsFigure) lines.push('', FIGURE_SPEC_PROMPT);
  if (problems?.length) lines.push('', figureRepairInstruction(problems));
  if (previous) {
    lines.push('', 'Your previous result, which the author wants changed as described in the task:', previous);
  }
  if (markdown.trim()) {
    lines.push('', 'Passage:', markdown);
  }
  return lines.join('\n');
}
