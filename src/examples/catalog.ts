/** The same working specimens are embedded in the product tour and the wiki. */
export const examples = {
  overview: {
    title: 'Figure 1 · Sparse Routing for Long-Context Pretraining',
    action: 'Inspect the routing diagram or download its SVG.',
    height: 440,
  },
  editor: {
    title: 'Tables, equations, and charts',
    action: 'Change a cell, edit the LaTeX, or insert a chart. Download the paper with your edits.',
    height: 400,
  },
  figures: {
    title: 'The manuscript’s figures',
    action: 'Select a node to edit its label, or switch drawings and edit their source.',
    height: 500,
  },
  research: {
    title: 'Papers and citation styles',
    action: 'Explore the sample results or change the style of a reference.',
    height: 430,
  },
  library: {
    title: 'PDFs in the sample workspace',
    action: 'Filter the readings by name and open a PDF’s extracted text.',
    height: 385,
  },
  'ai-actions': {
    title: 'A recorded reply about related work',
    action: 'Follow a citation in the reply or expand its tasks and run details.',
    height: 445,
  },
  review: {
    title: 'A proposed rewrite of the abstract',
    action: 'Compare the original wording and the proposal from Camera-ready edits.',
    height: 265,
  },
  history: {
    title: 'Three saved revisions',
    action: 'Select a revision to inspect its changes.',
    height: 395,
  },
  workspaces: {
    title: 'Collections and workspace activity',
    action: 'Expand Thesis to browse its chapters, or inspect workspace activity as a chart or table.',
    height: 400,
  },
  export: {
    title: 'Export the sample paper',
    action: 'Choose a format and generate a file from the manuscript.',
    height: 330,
  },
} as const;

export type ExampleId = keyof typeof examples;
export function isExampleId(value: string): value is ExampleId {
  return Object.hasOwn(examples, value);
}
export const exampleUrl = (id: ExampleId) => `/examples/?view=${id}`;
