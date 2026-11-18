/**
 * What a page can hold, each drawn by the editor's own block, for the docs
 * to embed beside the feature it shows. Only document content belongs here:
 * the app's panels and dialogs are described in the docs, not imitated.
 */
export const examples = {
  equation: {
    title: 'Equations',
    action: 'Select an equation to edit its LaTeX, switch it between inline and display, or number it.',
    height: 300,
  },
  table: {
    title: 'Table',
    action: 'Select the table to edit its cells, add or remove rows and columns, or change its caption.',
    height: 300,
  },
  chart: {
    title: 'Chart',
    action: 'Select the chart to change its type, values, labels and axis titles.',
    height: 380,
  },
  diagram: {
    title: 'Mermaid diagram',
    action: 'Open “Edit the source” and change the diagram: the drawing follows as you type.',
    height: 420,
  },
  figure: {
    title: 'Structured figure',
    action: 'Select a box or an arrow to edit it, or open “Edit the source” to change the figure’s spec.',
    height: 500,
  },
  citations: {
    title: 'Citations and the reference list',
    action: 'Pick another citation style: the citations in the text and the reference list are set again.',
    height: 480,
  },
} as const;

export type ExampleId = keyof typeof examples;
export function isExampleId(value: string): value is ExampleId {
  return Object.hasOwn(examples, value);
}
export const exampleUrl = (id: ExampleId) => `/examples/?view=${id}`;
