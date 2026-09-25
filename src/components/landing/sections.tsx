import type { ElementType, ReactNode } from 'react';
import {
  ArrowRight,
  ChartColumn,
  Check,
  Columns2,
  EyeOff,
  FlaskConical,
  Lock,
  Quote,
  Save,
  Sigma,
  Sparkles,
  Table,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { APP_TAGLINE } from '@/components/common/Brand';
import { toolMeta } from '@/components/panels/toolsConfig';
import {
  AiActionMenuMock,
  AskAiResultMock,
  ArxivResultMock,
  ChangeCardMock,
  CitationPill,
  ColpaliResultMock,
  EditorMock,
  EquationChip,
  LibraryMock,
  ReviewPillMock,
  RewriteDiffBody,
  SidebarTabsMock,
} from './mocks';

/* ----------------------------------------
   Shared section scaffolding
   ---------------------------------------- */

function Section({
  id,
  labelledBy,
  className,
  children,
}: {
  id?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn('scroll-mt-16 border-t border-border', className)}
    >
      <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">{children}</div>
    </section>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-medium text-primary">{eyebrow}</p>
      <h2 id={id} className="mt-1 text-balance text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-2 text-md leading-relaxed text-muted-foreground">{lead}</p>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm leading-relaxed text-muted-foreground">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ElementType;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      {children}
    </Card>
  );
}

/* ----------------------------------------
   Hero
   ---------------------------------------- */

function HeroVisual() {
  return (
    <figure className="relative mx-auto aspect-[4/5] w-full max-w-[680px] overflow-hidden rounded-2xl border border-border bg-card shadow-xl sm:aspect-[6/5]">
      <img
        src="/images/colwrite-hero-manuscript.webp"
        alt="A manuscript connected to abstract charts, evidence and citation nodes"
        width="1440"
        height="960"
        fetchPriority="high"
        className="absolute inset-0 h-full w-full object-cover object-[62%_center]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,var(--color-background)_100%)] opacity-75"
      />

      <div
        aria-hidden="true"
        className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-border bg-background/70 px-3 py-1.5 text-xs text-foreground/80 shadow-md backdrop-blur-sm sm:left-6 sm:top-6"
      >
        <span>Evidence</span>
        <ArrowRight className="h-3.5 w-3.5 text-primary" />
        <span>Manuscript</span>
      </div>

      <div className="absolute bottom-4 left-4 w-[178%] origin-bottom-left scale-[0.54] sm:bottom-6 sm:left-6 sm:w-[142%] sm:scale-[0.68]">
        <EditorMock />
      </div>
      <figcaption className="sr-only">
        ColWrite keeps evidence, writing and review together while every AI edit remains a
        suggestion.
      </figcaption>
    </figure>
  );
}

export function HeroSection({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(55%_60%_at_50%_0%,var(--color-primary)_0%,transparent_75%)] opacity-[0.14]"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-14 sm:pt-20 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:pb-24">
        <div className="animate-slide-in-up">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
            <FlaskConical aria-hidden="true" className="h-3.5 w-3.5" />
            In alpha · invite-only
          </p>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            The writing environment where AI edits wait for your approval
          </h1>
          <p className="mt-4 max-w-xl text-md leading-relaxed text-muted-foreground">
            ColWrite is a focused editor for scientific documents — blocks, citations and LaTeX
            inline — with an assistant that drafts and rewrites, but saves nothing until you
            accept the suggestion.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={onSignIn}>
              Sign in to continue
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#editor">See how it works</a>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {APP_TAGLINE} · Autosave as you type · Documents as clean JSON
          </p>
        </div>

        <div className="animate-slide-in-up [animation-delay:120ms] [animation-fill-mode:both]">
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------
   Inline widgets
   ---------------------------------------- */

function MiniTable() {
  const cells = ['Model', 'Active', 'Score', 'MoE-8×7B', '12.9B', '81.4', 'Dense-34B', '34B', '80.1'];
  return (
    <div className="grid w-44 grid-cols-3 overflow-hidden rounded-md border border-border text-2xs">
      {cells.map((cell, index) => (
        <span
          key={index}
          className={cn(
            'border-b border-r border-border px-1.5 py-1',
            index < 3 && 'bg-subtle font-medium',
            index % 3 === 2 && 'border-r-0',
            index >= 6 && 'border-b-0',
          )}
        >
          {cell}
        </span>
      ))}
    </div>
  );
}

function MiniChart() {
  return (
    <div aria-hidden="true" className="flex h-16 items-end gap-1.5">
      {[45, 70, 55, 90, 65].map((height, index) => (
        <span
          key={index}
          className="w-5 rounded-sm bg-primary/70"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

const WIDGETS = [
  {
    icon: Quote,
    title: 'Citation',
    description: 'Inline citation tags — numeric, author–year or IEEE — keyed by DOI or arXiv ID.',
    demo: (
      <p className="text-sm leading-relaxed text-foreground/80">
        …decoupling parameter count from compute <CitationPill>[1]</CitationPill>.
      </p>
    ),
  },
  {
    icon: Sigma,
    title: 'Equation',
    description: 'LaTeX inline, with optional numbering and referenceable labels.',
    demo: <EquationChip>E = mc^2</EquationChip>,
  },
  {
    icon: Table,
    title: 'Table',
    description: 'Editable tables that live inside the paragraph flow, not next to it.',
    demo: <MiniTable />,
  },
  {
    icon: ChartColumn,
    title: 'Graph',
    description: 'Bar, line and pie mini-charts built from plain data.',
    demo: <MiniChart />,
  },
  {
    icon: Sparkles,
    title: 'AI Beat',
    description: 'Generate content in place from a prompt, then accept it into the text.',
    demo: (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-tint-purple px-2 py-1.5 text-xs text-tint-purple-fg">
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
        “Summarize the ablation in one sentence”
      </span>
    ),
  },
];

export function InlineWidgetsSection() {
  return (
    <Section id="editor" labelledBy="editor-heading">
      <SectionHeading
        id="editor-heading"
        eyebrow="Block editor"
        title="A document model made for papers"
        lead="Paragraphs, headings and dividers — with rich widgets that sit inline in the text. Press / inside a paragraph to insert any of them."
      />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {WIDGETS.map((widget) => (
          <FeatureCard key={widget.title} icon={widget.icon} title={widget.title} description={widget.description}>
            <div className="mt-3 flex min-h-16 items-center rounded-md border border-border bg-background/40 p-3">
              {widget.demo}
            </div>
          </FeatureCard>
        ))}
        <FeatureCard
          icon={Columns2}
          title="Multi-column blocks"
          description="Paragraphs reflow into up to four columns, so methods and results can sit side by side."
        >
          <div aria-hidden="true" className="mt-3 grid grid-cols-2 gap-2">
            <div className="space-y-1 rounded-md border border-border bg-background/40 p-2">
              <div className="h-1 w-full rounded-sm bg-border/70" />
              <div className="h-1 w-5/6 rounded-sm bg-border/70" />
              <div className="h-1 w-full rounded-sm bg-border/70" />
            </div>
            <div className="space-y-1 rounded-md border border-border bg-background/40 p-2">
              <div className="h-1 w-full rounded-sm bg-border/70" />
              <div className="h-1 w-4/6 rounded-sm bg-border/70" />
              <div className="h-1 w-5/6 rounded-sm bg-border/70" />
            </div>
          </div>
        </FeatureCard>
      </div>
    </Section>
  );
}

/* ----------------------------------------
   AI actions on selection
   ---------------------------------------- */

export function AiActionsSection() {
  return (
    <Section id="ai-actions" labelledBy="ai-actions-heading">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div>
          <SectionHeading
            id="ai-actions-heading"
            eyebrow="Inline AI"
            title="Select text. Ask AI."
            lead="Ask AI leads the selection toolbar. It opens a prompt right under your words: pick an action or type your own, and the result appears in place as a word-level diff."
          />
          <div className="mt-6">
            <BulletList
              items={[
                'Built-in actions to edit, explain and research a passage — improve, fix grammar, shorten, lengthen, simplify, change tone, translate, find citations, check claims.',
                'The result streams in under the original. Replace the selection, insert it below, try again, or type a follow-up in the same bar.',
                'Nothing is written to the document until you choose to keep it.',
              ]}
            />
          </div>
        </div>
        <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">On a selection</p>
            <AiActionMenuMock />
          </div>
          <div className="min-w-0 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">After a run</p>
            <AskAiResultMock />
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ----------------------------------------
   Review workflow
   ---------------------------------------- */

export function ReviewSection() {
  return (
    <Section id="review" labelledBy="review-heading">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div className="order-last flex flex-col gap-4 lg:order-first">
          <ReviewPillMock className="self-end" />
          <div className="space-y-3">
            <ChangeCardMock kind="replace">
              <RewriteDiffBody />
            </ChangeCardMock>
            <ChangeCardMock kind="insert" locked>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-diff-add-fg">
                We release code and routing traces to support reproduction of every result.
              </p>
            </ChangeCardMock>
          </div>
        </div>
        <div>
          <SectionHeading
            id="review-heading"
            eyebrow="Review workflow"
            title="The assistant proposes. You dispose."
            lead="Ask the assistant to rewrite, restructure or draft — every edit lands in the document as a suggested change, right where it would appear."
          />
          <div className="mt-6">
            <BulletList
              items={[
                'Word-level diffs show exactly what moved — additions, rewrites, deletions, moves and title changes.',
                'Accept or reject each change where it lands, or step through the batch from the suggestions pill in the top bar.',
                'Dependent changes stay locked until the change they build on is accepted.',
                'Chat with the document: reference it with #, then ask for suggestions, rewrites, structure, summaries or references.',
              ]}
            />
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ----------------------------------------
   Research tools
   ---------------------------------------- */

export function ResearchSection() {
  const arxiv = toolMeta('arxiv');
  const colpali = toolMeta('colpali');
  const library = toolMeta('library');

  return (
    <Section id="research" labelledBy="research-heading">
      <SectionHeading
        id="research-heading"
        eyebrow="Research tools"
        title="Literature work without leaving the document"
        lead="The right sidebar keeps the assistant, research, your sources and the document's history one click from the text. Find papers, pull up the exact page that answers a question, and keep your PDFs at hand."
      />
      <SidebarTabsMock className="mt-6" />

      <figure className="relative mt-8 min-h-64 overflow-hidden rounded-xl border border-border bg-card shadow-lg sm:aspect-[21/9] sm:min-h-0">
        <img
          src="/images/colwrite-research-flow.webp"
          alt="Research papers and data streams converging into a finished manuscript"
          width="1600"
          height="758"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,var(--color-background)_100%)] opacity-80"
        />
        <figcaption className="absolute inset-x-4 bottom-4 grid gap-2 sm:inset-x-6 sm:bottom-6 sm:grid-cols-3">
          {[
            ['01', 'Find relevant papers'],
            ['02', 'Retrieve the exact page'],
            ['03', 'Write with the evidence in view'],
          ].map(([step, label]) => (
            <span
              key={step}
              className="flex items-center gap-2 rounded-md border border-border bg-background/75 px-3 py-2 text-xs text-foreground/80 shadow-sm backdrop-blur-sm"
            >
              <span className="font-mono text-primary">{step}</span>
              {label}
            </span>
          ))}
        </figcaption>
      </figure>

      <div className="mt-8 grid gap-3 lg:grid-cols-3">
        <FeatureCard icon={arxiv.icon} title={arxiv.label} description={arxiv.description}>
          <ArxivResultMock />
        </FeatureCard>
        <FeatureCard icon={colpali.icon} title={colpali.label} description={colpali.description}>
          <ColpaliResultMock />
        </FeatureCard>
        <FeatureCard icon={library.icon} title={library.label} description={library.description}>
          <LibraryMock />
        </FeatureCard>
      </div>
    </Section>
  );
}

/* ----------------------------------------
   Control
   ---------------------------------------- */

export function ControlSection() {
  const json = toolMeta('json');

  return (
    <Section id="control" labelledBy="control-heading">
      <SectionHeading
        id="control-heading"
        eyebrow="Control"
        title="You set the assistant's boundaries"
        lead="The AI sees and touches only what you allow — per block, per document, down to the raw JSON."
      />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FeatureCard
          icon={EyeOff}
          title="Hide from assistant"
          description="Exclude any block from the AI context, so side notes and half-formed drafts stay out of the prompt."
        />
        <FeatureCard
          icon={Lock}
          title="Lock block"
          description="Locked blocks are never modified — even when you ask the assistant to restructure the whole document."
        />
        <FeatureCard
          icon={json.icon}
          title={json.label}
          description="Documents are a clean JSON tree — the same format the assistant reads and writes. Inspect it, edit it, apply it back."
        />
        <FeatureCard
          icon={Save}
          title="Versioned saves"
          description="Autosave runs as you type. Every save is versioned, and a conflict is reported instead of silently overwritten."
        />
      </div>
    </Section>
  );
}

/* ----------------------------------------
   Alpha + final CTA
   ---------------------------------------- */

export function AlphaCtaSection({ onSignIn }: { onSignIn: () => void }) {
  return (
    <Section>
      <div className="relative overflow-hidden rounded-xl border border-border bg-card px-6 py-12 text-center sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(50%_60%_at_50%_0%,var(--color-primary)_0%,transparent_75%)] opacity-[0.12]"
        />
        <div className="relative">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
            <FlaskConical aria-hidden="true" className="h-3.5 w-3.5" />
            Alpha software
          </p>
          <h2 className="mx-auto mt-4 max-w-xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Write your next paper with ColWrite
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-md leading-relaxed text-muted-foreground">
            Accounts are invite-only during alpha, and features and data formats may change. Sign
            in with the credentials you were given.
          </p>
          <div className="mt-6">
            <Button size="lg" onClick={onSignIn}>
              Sign in to continue
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}
