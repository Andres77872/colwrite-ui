import {
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'colwrite-ui';
import { Bold, Download, Filter, Italic, Quote, Search, Sigma } from 'lucide-react';

// `open` is forced on every root: a closed Popover renders nothing and the
// panel is the point of the card. Radix Popover is non-modal by default, so
// there is no body scroll lock to blank a static capture — `modal` is left at
// its default. PopoverContent portals to document.body, which is why this
// component is cardMode "single" in .design-sync/config.json.

const REFERENCES = [
  {
    key: 'vaswani2017',
    title: 'Attention Is All You Need',
    meta: 'Vaswani et al. · NeurIPS 2017',
  },
  {
    key: 'izacard2021',
    title: 'Leveraging Passage Retrieval with Generative Models',
    meta: 'Izacard & Grave · EACL 2021',
  },
  {
    key: 'lewis2020',
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP',
    meta: 'Lewis et al. · NeurIPS 2020',
  },
];

export function CitationPicker() {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1.5 shadow-sm">
      <Button variant="ghost" size="icon-sm" aria-label="Bold">
        <Bold />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Italic">
        <Italic />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Inline equation">
        <Sigma />
      </Button>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border/60" />
      <Popover open>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="text-primary">
            <Quote />
            Cite
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input className="h-8 pl-8 text-xs" defaultValue="retrieval" />
          </div>
          <ul className="mt-2 space-y-1">
            {REFERENCES.map((ref) => (
              <li key={ref.key}>
                <button
                  type="button"
                  className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                >
                  <span className="block truncate text-xs font-medium text-foreground">
                    {ref.title}
                  </span>
                  <span className="mt-1 block truncate text-2xs text-muted-foreground">
                    {ref.meta}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2">
            <span className="text-2xs text-muted-foreground">18 references in this document</span>
            <Button variant="ghost" size="xs">
              Manage
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function SectionFilters() {
  const filters = [
    { id: 'ds-pop-f1', label: 'Only sections with citations', checked: true },
    { id: 'ds-pop-f2', label: 'Hide empty blocks', checked: true },
    { id: 'ds-pop-f3', label: 'Flagged by the assistant', checked: false },
    { id: 'ds-pop-f4', label: 'Changed since last export', checked: false },
  ];
  return (
    <div className="w-64 rounded-lg border border-border bg-card">
      <div className="flex h-11 items-center justify-between gap-2 border-b border-border/50 px-3">
        <h2 className="truncate text-sm font-medium text-foreground/90">Outline</h2>
        <Popover open>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Filter sections"
              className="text-muted-foreground"
            >
              <Filter />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-3">
            <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Show sections
            </span>
            <div className="space-y-2">
              {filters.map((filter) => (
                <label
                  key={filter.id}
                  htmlFor={filter.id}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <Checkbox id={filter.id} defaultChecked={filter.checked} />
                  {filter.label}
                </label>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2 border-t border-border/60 pt-2.5">
              <Button variant="ghost" size="sm">
                Reset
              </Button>
              <Button variant="outline" size="sm">
                Apply
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <ul className="space-y-1 p-2 text-sm">
        {['Abstract', 'Introduction', 'Related Work', 'Method', 'Experiments'].map((section) => (
          <li key={section} className="truncate rounded-sm px-2 py-1 text-muted-foreground">
            {section}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExportOptions() {
  const options = [
    { id: 'ds-pop-e1', label: 'Include figures', checked: true },
    { id: 'ds-pop-e2', label: 'Include reference list', checked: true },
    { id: 'ds-pop-e3', label: 'Inline equations as LaTeX', checked: false },
  ];
  return (
    <div className="flex w-full items-center justify-end gap-2">
      <span className="mr-auto truncate text-sm text-muted-foreground">
        Attention Is All You Need, Revisited
      </span>
      <Button variant="ghost" size="sm">
        Preview
      </Button>
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
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm">
              LaTeX
            </Button>
            <Button variant="ghost" size="sm">
              Markdown
            </Button>
          </div>
          <div className="space-y-2 border-t border-border/60 pt-2.5">
            {options.map((option) => (
              <label
                key={option.id}
                htmlFor={option.id}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <Checkbox id={option.id} defaultChecked={option.checked} />
                {option.label}
              </label>
            ))}
          </div>
          <Button className="mt-3 w-full" size="sm">
            Export attention-revisited.tex
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
