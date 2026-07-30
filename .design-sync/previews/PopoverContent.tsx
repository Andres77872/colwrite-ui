import { Button, Input, Kbd, Popover, PopoverContent, PopoverTrigger } from 'colwrite-ui';
import { Download, Heading2, HelpCircle, ListTree, Pilcrow, Search, Sigma, Table2 } from 'lucide-react';

// The axis here is placement and width: `align`, `side`, `sideOffset` and the
// `className` width override. Every cell is the full compound with `open`
// forced, because the content portals to document.body and renders nothing
// when the root is closed.

export function AlignStart() {
  const hits = [
    { title: 'Attention Is All You Need', meta: 'Vaswani et al. · NeurIPS 2017' },
    { title: 'Sparse Retrieval for Long-Context QA', meta: 'Preprint · arXiv:2404.01822' },
    { title: 'Fusion-in-Decoder revisited', meta: 'Izacard & Grave · EACL 2021' },
  ];
  return (
    <div className="flex w-full justify-center">
      <Popover open>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Search />
            Find a reference
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-3">
          <Input className="h-8 text-xs" defaultValue="long-context" />
          <ul className="mt-2 space-y-1">
            {hits.map((hit) => (
              <li key={hit.title}>
                <button type="button" className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent">
                  <span className="block truncate text-xs font-medium text-foreground">{hit.title}</span>
                  <span className="mt-1 block truncate text-2xs text-muted-foreground">{hit.meta}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-border/60 pt-2 text-2xs text-muted-foreground">
            3 of 18 references match “long-context”.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function AlignEnd() {
  return (
    <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span className="mr-auto truncate text-sm text-muted-foreground">
        Draft · saved 2 minutes ago
      </span>
      <Popover open>
        <PopoverTrigger asChild>
          <Button size="sm">
            <Download />
            Export
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Export as
          </span>
          <div className="space-y-1">
            {[
              { label: 'LaTeX source (.tex)', hint: 'arXiv-ready, with a bibliography' },
              { label: 'Markdown (.md)', hint: 'Equations kept as $…$' },
              { label: 'Document JSON', hint: 'The raw block tree' },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
              >
                <span className="block text-xs font-medium text-foreground">{item.label}</span>
                <span className="mt-1 block text-2xs text-muted-foreground">{item.hint}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 border-t border-border/60 pt-2 text-2xs text-muted-foreground">
            Exports the current draft — unsaved blocks are included.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function SideRight() {
  const blocks = [
    { icon: Heading2, label: 'Heading', hint: 'Starts a numbered section' },
    { icon: Pilcrow, label: 'Paragraph', hint: 'Prose, citations and inline maths' },
    { icon: Sigma, label: 'Equation', hint: 'Display LaTeX, auto-numbered' },
    { icon: Table2, label: 'Table', hint: 'Captioned, referenced as Table N' },
  ];
  return (
    <Popover open>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Block types" className="text-muted-foreground">
          <HelpCircle />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="p-3">
        <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Block types
        </span>
        <ul className="space-y-2">
          {blocks.map((block) => {
            const Icon = block.icon;
            return (
              <li key={block.label} className="flex items-start gap-2">
                <Icon aria-hidden="true" className="mt-1 h-3.5 w-3.5 shrink-0 text-primary/70" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">{block.label}</span>
                  <span className="block text-2xs text-muted-foreground">{block.hint}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 flex items-center gap-1 border-t border-border/60 pt-2 text-2xs text-muted-foreground">
          Type <Kbd>/</Kbd> in an empty block to insert one.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function SideTopOffset() {
  const sections = [
    { label: '1 Introduction', blocks: '6 blocks' },
    { label: '2 Related Work', blocks: '11 blocks' },
    { label: '3 Method', blocks: '14 blocks' },
    { label: '4 Experiments', blocks: '9 blocks' },
    { label: '5 Conclusion', blocks: '3 blocks' },
  ];
  return (
    <div className="flex h-64 w-full flex-col justify-end">
      <p className="mb-auto max-w-md text-base leading-relaxed text-muted-foreground">
        We revisit the original encoder-decoder formulation under a 32k-token budget and
        show that the retrieval stage, not the attention pattern, dominates end-to-end
        latency on open-domain QA.
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <Popover open>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <ListTree />
              5 sections
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" sideOffset={10} align="start" className="w-80 p-2">
            <ul className="space-y-1">
              {sections.map((section) => (
                <li
                  key={section.label}
                  className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
                >
                  <span className="truncate text-xs text-foreground">{section.label}</span>
                  <span className="shrink-0 text-2xs text-muted-foreground">{section.blocks}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 border-t border-border/60 pt-2 text-2xs text-muted-foreground">
              43 blocks · numbering follows section order.
            </p>
          </PopoverContent>
        </Popover>
        <span className="ml-auto text-2xs text-muted-foreground">1 842 words</span>
      </div>
    </div>
  );
}
