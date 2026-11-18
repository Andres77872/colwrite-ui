import {
  Download,
  FolderTree,
  History,
  Image,
  Library,
  ListChecks,
  MessageSquare,
  MessageSquareText,
  PanelsTopLeft,
  PenLine,
  Quote,
  Rocket,
  ScanSearch,
  Search,
  Settings,
  Shapes,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Users,
} from 'lucide-react';

/**
 * The feature docs, in reading order. Each page documents one feature: what
 * it does, how to use it, its options and who may use it.
 *
 * Imported by the Vite config process: relative imports only, never `@/`.
 */

export const DOC_GROUPS = [
  { id: 'start', label: 'Get started' },
  { id: 'write', label: 'Write' },
  { id: 'cite', label: 'Cite and research' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'review', label: 'Review and history' },
  { id: 'manage', label: 'Workspaces and export' },
] as const;

export type DocGroupId = (typeof DOC_GROUPS)[number]['id'];

export const DOCS = [
  { slug: 'quick-start', title: 'Quick start', group: 'start', icon: Rocket, summary: 'From sign-in to a cited, exported page.' },
  { slug: 'interface', title: 'The interface', group: 'start', icon: PanelsTopLeft, summary: 'The sidebar, the page, the side panels, the palette and the shortcuts.' },
  { slug: 'editor', title: 'Editor and blocks', group: 'write', icon: PenLine, summary: 'Block types, the / menu, formatting, locking and hiding blocks.' },
  { slug: 'equations', title: 'Equations', group: 'write', icon: Sigma, summary: 'Inline and display LaTeX, numbering and references.' },
  { slug: 'tables-charts', title: 'Tables and charts', group: 'write', icon: Table2, summary: 'Tables with captions, and bar, line, area and pie charts.' },
  { slug: 'diagrams-figures', title: 'Diagrams and figures', group: 'write', icon: Shapes, summary: 'Mermaid diagrams and structured figures, with SVG and TikZ.' },
  { slug: 'images', title: 'Images', group: 'write', icon: Image, summary: 'Uploaded and generated images, captions, widths and alt text.' },
  { slug: 'citations', title: 'Citations and references', group: 'cite', icon: Quote, summary: 'Citing works, the Sources panel, citation styles and BibTeX.' },
  { slug: 'reference-check', title: 'Reference check', group: 'cite', icon: ShieldCheck, summary: 'Retracted, out-of-date, duplicate and missing references.' },
  { slug: 'paper-search', title: 'Paper search', group: 'cite', icon: Search, summary: 'OpenAlex, the arXiv index and Semantic Scholar, merged.' },
  { slug: 'claim-check', title: 'Claim check and Find citations', group: 'cite', icon: ScanSearch, summary: 'Test a sentence against the literature, or find works to cite.' },
  { slug: 'library', title: 'PDF library', group: 'cite', icon: Library, summary: 'Upload PDFs, file them, and choose which pages may read them.' },
  { slug: 'assistant', title: 'Assistant chat', group: 'assistant', icon: MessageSquare, summary: 'Ask about the page, research, draft and plan, with sources.' },
  { slug: 'ask-ai', title: 'Ask AI and AI beats', group: 'assistant', icon: Sparkles, summary: 'One-shot rewrites on a selection or a block.' },
  { slug: 'suggestions', title: 'Suggestions and Auto', group: 'assistant', icon: ListChecks, summary: 'Review the assistant’s edits, or let Auto apply them.' },
  { slug: 'assistant-settings', title: 'AI and tools settings', group: 'assistant', icon: SlidersHorizontal, summary: 'Switches, paper sources, engines and assistant instructions.' },
  { slug: 'reviews', title: 'Reviews and comments', group: 'review', icon: MessageSquareText, summary: 'Proofreading, claims, sources, structure and peer review.' },
  { slug: 'history', title: 'Version history', group: 'review', icon: History, summary: 'Revisions, diffs, restores and save conflicts.' },
  { slug: 'workspaces', title: 'Workspaces, collections and Trash', group: 'manage', icon: FolderTree, summary: 'Organise pages, copy them, export a workspace, restore from Trash.' },
  { slug: 'members', title: 'Members, roles and policy', group: 'manage', icon: Users, summary: 'Invite people, set roles, transfer ownership, limit the assistant.' },
  { slug: 'export', title: 'Export and AI use', group: 'manage', icon: Download, summary: 'HTML, PDF, Markdown, LaTeX and BibTeX, and the AI-use statement.' },
  { slug: 'account', title: 'Settings, usage and account', group: 'manage', icon: Settings, summary: 'Appearance, usage and cost, your profile, deleting the account.' },
] as const;

export type Doc = (typeof DOCS)[number];
export type DocSlug = Doc['slug'];

export const DOCS_HOME = '/docs/';
export const docHref = (slug: DocSlug) => `/docs/${slug}.html`;
export const docsIn = (group: DocGroupId) => DOCS.filter((doc) => doc.group === group);

/** Where each page of the old user wiki now lives. */
export const WIKI_REDIRECTS: Record<string, DocSlug | 'index'> = {
  index: 'index',
  'getting-started': 'quick-start',
  editor: 'editor',
  figures: 'diagrams-figures',
  research: 'paper-search',
  library: 'library',
  'ai-actions': 'assistant',
  review: 'reviews',
  history: 'history',
  workspaces: 'workspaces',
  settings: 'account',
  export: 'export',
};
