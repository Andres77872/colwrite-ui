import {
  BookOpen,
  ChartNoAxesCombined,
  FileOutput,
  History,
  Layers3,
  LibraryBig,
  MessagesSquare,
  NotebookPen,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import type { ExampleId } from '@/examples/catalog';

export const samplePaper = '/examples/?view=paper';

export interface TourTopic {
  id: Exclude<ExampleId, 'overview'>;
  label: string;
  icon: LucideIcon;
  teaser: string;
  title: string;
  intro: string;
  details: readonly { label: string; text: string }[];
}

export const topics: readonly TourTopic[] = [
  {
    id: 'editor',
    label: 'Page editor',
    icon: NotebookPen,
    teaser: 'Blocks, equations, tables, and graphs',
    title: 'Put the results in the manuscript.',
    intro: 'Write in blocks and insert a citation, equation, table, or graph where it belongs in the text.',
    details: [
      {
        label: 'Build a section',
        text: 'Type / for headings, lists, callouts, code, and inline widgets. Use a block’s handle to move it or lay a paragraph out in columns.',
      },
      {
        label: 'Work with the numbers',
        text: 'Edit table cells directly, write equations in LaTeX, and choose a bar, line, area, or pie chart for your data.',
      },
      {
        label: 'Protect a passage',
        text: 'Use the block menu to lock its contents or hide the passage from the assistant.',
      },
    ],
  },
  {
    id: 'figures',
    label: 'Figures and images',
    icon: ChartNoAxesCombined,
    teaser: 'Structured figures, Mermaid, and image blocks',
    title: 'Draw a figure inside the paper.',
    intro:
      'Build an architecture diagram from connected parts, write a Mermaid diagram, or insert an image with alt text and a caption.',
    details: [
      {
        label: 'Edit the drawing',
        text: 'Choose Figure from the slash menu. Start from a template and select a node in the preview to edit its label, shape, or colour.',
      },
      {
        label: 'Use the figure elsewhere',
        text: 'Number a figure with its caption, download it as SVG, or copy TikZ for a LaTeX manuscript.',
      },
      {
        label: 'Bring in an image',
        text: 'Upload your own image. Where image generation is available, you can inspect a candidate before adding it to the paper.',
      },
    ],
  },
  {
    id: 'research',
    label: 'Papers and citations',
    icon: BookOpen,
    teaser: 'Paper search, claim checks, and references',
    title: 'Trace a claim to its source.',
    intro:
      'Search for a paper beside the draft, save it for later, or cite it at the cursor. Follow a result to its references and citing papers.',
    details: [
      {
        label: 'Find evidence',
        text: 'Research lists the providers behind each result. Check a claim shows the passages behind an assessment and when more evidence is needed.',
      },
      {
        label: 'Manage references',
        text: 'Sources holds the cited and saved works. Add an identifier, import BibTeX, choose a citation style, or check the page for reference issues.',
      },
      {
        label: 'Available sources',
        text: 'Paper providers depend on the server, your account settings, and the workspace’s outside-research policy.',
      },
    ],
  },
  {
    id: 'library',
    label: 'PDF library',
    icon: LibraryBig,
    teaser: 'PDF collections and passage search',
    title: 'Keep the readings with the draft.',
    intro:
      'See which PDFs a page can use, how it has access to them, and whether their text is ready to search.',
    details: [
      {
        label: 'File a reading',
        text: 'Upload a PDF to the page or a collection. Browse collections or open the Unfiled and All PDFs views.',
      },
      {
        label: 'Read a passage',
        text: 'Switch from Names to Inside PDFs to search extracted text. Attach a PDF to a chat when the assistant should work with that file.',
      },
    ],
  },
  {
    id: 'ai-actions',
    label: 'Writing assistant',
    icon: Sparkles,
    teaser: 'Selection edits, page chats, plans, and runs',
    title: 'Revise a passage or plan a draft.',
    intro: 'Select a sentence for Ask AI, or open a page chat to work through a longer writing task.',
    details: [
      {
        label: 'Work on a selection',
        text: 'Choose an editing action or give your own instruction. Compare the result, replace the selection, insert below, or discard it.',
      },
      {
        label: 'Plan in chat',
        text: 'Reference blocks and pages with #, attach PDFs or images, and follow the sources in a reply. Deep can plan sections. Runs can resume an interrupted run with a checkpoint.',
      },
      {
        label: 'Choose the tools',
        text: 'Settings shows the available engines, paper sources, Web, and Workers. Chat edits normally go to review. Turning on Auto can apply eligible edits in that chat when policy allows.',
      },
    ],
  },
  {
    id: 'review',
    label: 'Suggestions and reviews',
    icon: MessagesSquare,
    teaser: 'Proposed edits and shared review comments',
    title: 'Decide what changes in the draft.',
    intro:
      'Read a proposed edit where it lands. Use the suggestions list to move through a batch and see which decisions are still open.',
    details: [
      {
        label: 'Compare the wording',
        text: 'Inspect additions and deletions in context. Accept or reject a change individually, or review a group of eligible edits together.',
      },
      {
        label: 'Review the manuscript',
        text: 'Run a proofread, claims, sources, structure, or peer review. The Review panel keeps shared comments tied to the passages they discuss.',
      },
    ],
  },
  {
    id: 'history',
    label: 'Version history',
    icon: History,
    teaser: 'Saved revisions, comparisons, and recovery',
    title: 'See what changed between saves.',
    intro:
      'Follow the manuscript’s revisions, from its first save to an accepted suggestion or a later edit.',
    details: [
      {
        label: 'Compare revisions',
        text: 'Select an entry in History. This change compares it with its parent. Vs. current compares an older version with the page you have open.',
      },
      {
        label: 'Recover a version',
        text: 'Editors can restore an earlier version. A save conflict also offers a choice between the newer saved page and local edits.',
      },
      {
        label: 'Document JSON',
        text: 'Open the inspector from Page options to see the block structure and inline data behind the manuscript.',
      },
    ],
  },
  {
    id: 'workspaces',
    label: 'Workspaces and access',
    icon: Layers3,
    teaser: 'Collections, members, roles, and Trash',
    title: 'Organise a shared writing project.',
    intro:
      'Keep pages and reading collections in a personal or shared workspace. Switch projects from the workspace menu.',
    details: [
      {
        label: 'Organise the tree',
        text: 'Nest collections, move pages, and copy a page to another workspace. Open Trash to restore a recently deleted item.',
      },
      {
        label: 'Share a project',
        text: 'Owners and admins can invite members and manage roles. Viewers can read and review. Editors can also write and decide on suggestions.',
      },
      {
        label: 'Set workspace policy',
        text: 'Workspace settings govern outside research, web search, and Auto. Usage shows activity and storage for one workspace or the account.',
      },
    ],
  },
  {
    id: 'export',
    label: 'Export and disclosure',
    icon: FileOutput,
    teaser: 'PDF, HTML, Markdown, LaTeX, and AI use',
    title: 'Prepare a manuscript to share.',
    intro:
      'Export a reading copy, take the source to another editor, or prepare a statement about the assistant’s contribution.',
    details: [
      {
        label: 'Choose a format',
        text: 'Page options offers PDF through the print dialog, standalone HTML, Markdown, and LaTeX. For PDF or HTML, choose the paper or editor-faithful profile.',
      },
      {
        label: 'Check the references',
        text: 'Review the reference-health summary before export. Sources can also export the bibliography as BibTeX.',
      },
      {
        label: 'Disclose AI use',
        text: 'Open AI use from Page options to inspect the activity log and draft a statement for a selected venue.',
      },
    ],
  },
];

export function topicFromHash(hash: string) {
  const id = hash.slice(1);
  // Older landing links used Control for saves, block protection, and JSON.
  return topics.find((topic) => topic.id === (id === 'control' ? 'history' : id));
}
