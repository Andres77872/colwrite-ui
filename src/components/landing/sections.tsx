import type { ElementType, ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  ChartColumn,
  Check,
  EyeOff,
  FlaskConical,
  Lock,
  MessageSquareText,
  PenLine,
  Quote,
  Save,
  Search,
  Shapes,
  Sigma,
  Sparkles,
  Table,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { panelMeta } from '@/components/panels/sidebarPanels';
import { SAMPLE_PAPER_HREF } from '@/site/links';
import { DOCS, DOCS_HOME, docHref, type DocSlug } from '@/docs/catalog';
import { DocCard } from '@/docs/DocCard';
import {
  AiActionMenuMock,
  AskAiResultMock,
  ChangeCardMock,
  EditorMock,
  LibraryMock,
  ManuscriptBlocksMock,
  PaperResultMock,
  ReviewPillMock,
  RewriteDiffBody,
  SourcesMock,
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
    <section id={id} aria-labelledby={labelledBy} className={cn('scroll-mt-14', className)}>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">{children}</div>
    </section>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
  className?: string;
}) {
  return (
    <div className={cn('max-w-2xl', className)}>
      <p className="text-sm font-medium text-link">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{lead}</p>
    </div>
  );
}

/** "Read the … docs": every section leads on to the docs page that covers it. */
function DocLink({ slug, hash, children }: { slug: DocSlug; hash?: string; children: ReactNode }) {
  return (
    <a
      href={`${docHref(slug)}${hash ? `#${hash}` : ''}`}
      className="group mt-6 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-link hover:underline hover:underline-offset-4"
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
    </a>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5">
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-link" />
          <span className="text-sm leading-relaxed text-muted-foreground">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function IconTile({ icon: Icon }: { icon: ElementType }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-link">
      <Icon aria-hidden="true" className="size-[18px]" />
    </span>
  );
}

function FeatureCard({
  icon,
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
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <IconTile icon={icon} />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
      {children}
    </Card>
  );
}

function AlphaPill({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
      <FlaskConical aria-hidden="true" className="size-3.5" />
      {children}
    </p>
  );
}

/* ----------------------------------------
   Hero
   ---------------------------------------- */

function HeroVisual() {
  return (
    <figure className="relative mx-auto mt-12 max-w-6xl px-4 sm:mt-16 sm:px-6">
      {/* The artwork leaves its lower half empty for the editor to sit in. */}
      <img
        src="/images/colwrite-hero-manuscript.webp"
        alt=""
        width="1440"
        height="960"
        fetchPriority="high"
        className="pointer-events-none mx-auto w-full max-w-5xl select-none [mask-image:radial-gradient(ellipse_52%_48%_at_50%_30%,black_62%,transparent_100%)]"
      />
      <div className="relative mx-auto -mt-[36%] max-w-3xl lg:-mt-[34%]">
        <div
          aria-hidden="true"
          className="absolute -inset-x-10 -top-10 bottom-0 -z-10 bg-[radial-gradient(50%_50%_at_50%_40%,var(--color-primary)_0%,transparent_70%)] opacity-[0.16] blur-2xl"
        />
        <EditorMock />
      </div>
      <figcaption className="sr-only">
        A manuscript open in the ColWrite editor: a selected sentence with the Ask AI toolbar, and the
        assistant’s suggested rewrite shown as a word-level change beside the text.
      </figcaption>
    </figure>
  );
}

export function HeroSection({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden pb-16 sm:pb-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(55%_60%_at_50%_0%,var(--color-primary)_0%,transparent_75%)] opacity-[0.14]"
      />
      <div className="relative mx-auto max-w-6xl px-4 pt-16 text-center sm:px-6 sm:pt-24">
        <div className="animate-slide-in-up">
          <AlphaPill>Invite-only alpha</AlphaPill>
          <h1
            id="hero-heading"
            className="mx-auto mt-5 max-w-3xl text-balance text-4xl font-semibold tracking-tight text-white sm:text-6xl sm:leading-[1.05]"
          >
            Write your research paper with its sources in view.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-lg leading-relaxed text-muted-foreground">
            Draft with citations, equations and figures in one editor. Ask the assistant to revise a
            passage, then review each change it proposes beside your manuscript.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" onClick={onSignIn}>
              Sign in to continue
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href={DOCS_HOME}>
                Read the docs <ArrowRight aria-hidden="true" />
              </a>
            </Button>
          </div>
        </div>
      </div>
      <div className="animate-slide-in-up [animation-delay:120ms] [animation-fill-mode:both]">
        <HeroVisual />
      </div>
    </section>
  );
}

/* ----------------------------------------
   What it does — the header's "Features"
   ---------------------------------------- */

const PILLARS = [
  {
    href: '#editor',
    icon: PenLine,
    title: 'Write',
    text: 'Citations, equations, tables and figures sit in the paragraph, not beside it.',
  },
  {
    href: '#ai-actions',
    icon: Sparkles,
    title: 'Ask AI',
    text: 'Select a passage, pick an action, and read the rewrite as a word-level diff.',
  },
  {
    href: '#review',
    icon: MessageSquareText,
    title: 'Review',
    text: 'Every assistant edit arrives as a suggestion you accept or reject.',
  },
  {
    href: '#research',
    icon: Search,
    title: 'Research',
    text: 'Search papers, check a claim, and keep your PDFs and sources at hand.',
  },
];

export function FeatureOverview() {
  return (
    <section id="features" aria-labelledby="features-heading" className="scroll-mt-14 border-y border-border">
      <h2 id="features-heading" className="sr-only">
        What ColWrite does
      </h2>
      {/* One-pixel gaps over the border colour draw the dividers at every column count. */}
      <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-border lg:grid-cols-4 xl:border-x xl:border-border">
        {PILLARS.map((pillar) => (
          <li key={pillar.href} className="bg-background">
            <a href={pillar.href} className="group flex h-full flex-col gap-3 px-4 py-6 transition-colors hover:bg-hover sm:px-6 sm:py-7">
              <IconTile icon={pillar.icon} />
              <span className="flex items-center gap-1.5 text-base font-semibold text-white">
                {pillar.title}
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                />
              </span>
              <span className="text-sm leading-relaxed text-muted-foreground">{pillar.text}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ----------------------------------------
   The editor's inline blocks
   ---------------------------------------- */

const BLOCKS = [
  { icon: Quote, title: 'Citations', text: 'Keyed by DOI or arXiv ID, in eight citation styles.' },
  { icon: Sigma, title: 'Equations', text: 'LaTeX inline, or numbered on a line of its own.' },
  { icon: Table, title: 'Tables', text: 'Editable cells, rows and columns, with a caption.' },
  { icon: ChartColumn, title: 'Charts', text: 'Bar, line, area or pie, drawn from plain data.' },
  { icon: Shapes, title: 'Figures', text: 'Diagrams and structured figures, as SVG or TikZ.' },
  { icon: Sparkles, title: 'AI Beats', text: 'A prompt and its draft, kept in the paragraph.' },
];

export function EditorSection() {
  return (
    <Section id="editor" labelledBy="editor-heading">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div>
          <SectionHeading
            id="editor-heading"
            eyebrow="Editor"
            title="A page model made for papers"
            lead="Paragraphs and headings, with what a paper needs inline. Press / anywhere to insert it."
          />
          <ul className="mt-8 grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {BLOCKS.map((block) => (
              <li key={block.title} className="flex items-start gap-3">
                <block.icon aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-link" />
                <span>
                  <span className="block text-sm font-semibold">{block.title}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{block.text}</span>
                </span>
              </li>
            ))}
          </ul>
          <DocLink slug="editor">Read the editor docs</DocLink>
        </div>
        <ManuscriptBlocksMock />
      </div>
    </Section>
  );
}

/* ----------------------------------------
   AI actions on selection
   ---------------------------------------- */

export function AiActionsSection() {
  return (
    <Section id="ai-actions" labelledBy="ai-actions-heading" className="border-t border-border">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div>
          <SectionHeading
            id="ai-actions-heading"
            eyebrow="Ask AI"
            title="Select text. Ask AI."
            lead="Ask AI leads the selection toolbar. Pick an action or type your own, and the result appears under your words as a word-level diff."
          />
          <div className="mt-8">
            <BulletList
              items={[
                'Actions to edit, explain and research a passage: improve, fix grammar, shorten, change tone, translate, check the claims.',
                'Replace the selection, insert the result below, try again, or ask a follow-up in the same bar.',
                'Nothing is written to the page until you choose to keep it.',
              ]}
            />
          </div>
          <DocLink slug="ask-ai">Read the Ask AI docs</DocLink>
        </div>
        <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
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
    <Section id="review" labelledBy="review-heading" className="border-t border-border">
      <div className="grid items-center gap-12 lg:grid-cols-2">
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
            eyebrow="Review"
            title="Review every change in the manuscript"
            lead="Each suggestion appears beside the text it would change. You choose which edits to keep."
          />
          <div className="mt-8">
            <BulletList
              items={[
                'Word-level diffs show exactly what changes: additions, rewrites, deletions and moves.',
                'Accept or reject each change where it lands, or step through them from the suggestions button in the top bar.',
                'A change that builds on another stays locked until that one is accepted.',
                'Run a named review (proofread, claims, sources, structure) and follow its comments back to the passage.',
              ]}
            />
          </div>
          <DocLink slug="suggestions">Read the suggestions docs</DocLink>
        </div>
      </div>
    </Section>
  );
}

/* ----------------------------------------
   Research tools
   ---------------------------------------- */

export function ResearchSection() {
  const papers = panelMeta('papers');
  const library = panelMeta('library');
  const sources = panelMeta('sources');

  return (
    <Section id="research" labelledBy="research-heading" className="border-t border-border">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-2">
        <SectionHeading
          id="research-heading"
          eyebrow="Research"
          title="Literature work without leaving the page"
          lead="The right sidebar keeps research, your sources and your PDFs one click from the text. Find papers, check a claim against the literature, and cite what you find."
        />
        <DocLink slug="paper-search">Read the paper search docs</DocLink>
      </div>

      <figure className="relative mt-10 min-h-64 overflow-hidden rounded-2xl border border-border bg-card shadow-lg sm:aspect-[21/9] sm:min-h-0">
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
          className="absolute inset-0 bg-[linear-gradient(180deg,transparent_40%,var(--color-background)_100%)] opacity-80"
        />
        <figcaption className="absolute inset-x-4 bottom-4 grid gap-2 sm:inset-x-6 sm:bottom-6 sm:grid-cols-3">
          {[
            ['01', 'Find relevant papers'],
            ['02', 'Check claims against the literature'],
            ['03', 'Write with the evidence in view'],
          ].map(([step, label]) => (
            <span
              key={step}
              className="flex items-center gap-2 rounded-md border border-border bg-background/80 px-3 py-2 text-xs text-foreground/85 shadow-sm backdrop-blur-sm"
            >
              <span className="font-mono text-link">{step}</span>
              {label}
            </span>
          ))}
        </figcaption>
      </figure>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <FeatureCard icon={papers.icon} title={papers.label} description={papers.description}>
          <PaperResultMock />
        </FeatureCard>
        <FeatureCard icon={library.icon} title={library.label} description={library.description}>
          <LibraryMock />
        </FeatureCard>
        <FeatureCard icon={sources.icon} title={sources.label} description={sources.description}>
          <SourcesMock />
        </FeatureCard>
      </div>
    </Section>
  );
}

/* ----------------------------------------
   Control
   ---------------------------------------- */

export function ControlSection() {
  const json = panelMeta('json');
  const controls = [
    {
      icon: EyeOff,
      title: 'Hide from assistant',
      text: 'Keep a block out of the AI’s context, so side notes and half-formed drafts stay out of the prompt.',
    },
    {
      icon: Lock,
      title: 'Lock block',
      text: 'A locked block is never modified, even when you ask the assistant to restructure the page.',
    },
    {
      icon: json.icon,
      title: json.label,
      text: 'A page is a clean JSON tree, the format the assistant reads and writes. Inspect it, edit it, apply it back.',
    },
    {
      icon: Save,
      title: 'Versioned saves',
      text: 'Autosave keeps every version, and a conflict with another tab is reported, never silently overwritten.',
    },
  ];

  return (
    <Section id="control" labelledBy="control-heading" className="border-t border-border">
      <SectionHeading
        id="control-heading"
        eyebrow="Control"
        title="You set the assistant’s boundaries"
        lead="The assistant sees and changes only what you allow: per block, per page, down to the raw JSON."
      />
      <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {controls.map((control) => (
          <li key={control.title} className="border-t border-border pt-6">
            <IconTile icon={control.icon} />
            <h3 className="mt-4 text-sm font-semibold">{control.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{control.text}</p>
          </li>
        ))}
      </ul>
      <DocLink slug="members" hash="workspace-policy">
        Read the roles and policy docs
      </DocLink>
    </Section>
  );
}

/* ----------------------------------------
   The docs — where the landing hands over to the feature docs
   ---------------------------------------- */

const FEATURED_DOCS: readonly DocSlug[] = ['quick-start', 'editor', 'citations', 'assistant', 'suggestions', 'export'];

export function DocsSection() {
  const featured = DOCS.filter((doc) => FEATURED_DOCS.includes(doc.slug));
  return (
    <section id="docs" aria-labelledby="docs-heading" className="scroll-mt-14 border-y border-border bg-sidebar/40">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <SectionHeading
            id="docs-heading"
            eyebrow="Docs"
            title="Every feature, documented"
            lead="One page per feature: what it does, how to use it, its options, and who in a workspace can use it."
          />
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" asChild>
              <a href={SAMPLE_PAPER_HREF}>
                Sample paper <ArrowUpRight aria-hidden="true" />
              </a>
            </Button>
            <Button variant="secondary" asChild>
              <a href={DOCS_HOME}>
                All docs <ArrowRight aria-hidden="true" />
              </a>
            </Button>
          </div>
        </div>
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((doc) => (
            <li key={doc.slug}>
              <DocCard doc={doc} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ----------------------------------------
   Alpha + final CTA
   ---------------------------------------- */

export function AlphaCtaSection({ onSignIn }: { onSignIn: () => void }) {
  return (
    <Section labelledBy="cta-heading">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card px-6 py-14 text-center sm:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(50%_60%_at_50%_0%,var(--color-primary)_0%,transparent_75%)] opacity-[0.14]"
        />
        <div className="relative">
          <AlphaPill>Alpha software</AlphaPill>
          <h2
            id="cta-heading"
            className="mx-auto mt-5 max-w-xl text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl"
          >
            Write your next paper with ColWrite
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Accounts are invite-only during alpha, and features and data formats may change. Sign in
            with the credentials you were given.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" onClick={onSignIn}>
              Sign in to continue
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href={docHref('quick-start')}>
                Quick start <ArrowRight aria-hidden="true" />
              </a>
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}
