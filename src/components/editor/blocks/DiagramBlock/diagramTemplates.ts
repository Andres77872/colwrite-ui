/**
 * Starting points for a new diagram, one per Mermaid diagram type an academic
 * document is likely to need. Each is small enough to read at a glance and
 * uses the syntax an author will want to copy — labelled edges, decisions,
 * notes — rather than the bare minimum that parses.
 */
export type DiagramTemplate = { id: string; label: string; source: string };

export const DIAGRAM_TEMPLATES: readonly DiagramTemplate[] = [
  {
    id: 'flowchart',
    label: 'Flowchart',
    source: [
      'flowchart LR',
      '  A[Research question] --> B{Enough data?}',
      '  B -- Yes --> C[Run analysis]',
      '  B -- No --> D[Collect more]',
      '  D --> B',
      '  C --> E([Write up])',
    ].join('\n'),
  },
  {
    id: 'sequence',
    label: 'Sequence',
    source: [
      'sequenceDiagram',
      '  participant A as Author',
      '  participant E as Editor',
      '  participant M as Assistant',
      '  A->>E: Ask for a summary',
      '  E->>M: Send the section',
      '  M-->>E: Proposed edit',
      '  E-->>A: Review the change',
    ].join('\n'),
  },
  {
    id: 'class',
    label: 'Class',
    source: [
      'classDiagram',
      '  class Document {',
      '    +string name',
      '    +save()',
      '  }',
      '  class Block {',
      '    +string id',
      '    +string type',
      '  }',
      '  Document "1" --> "*" Block : contains',
    ].join('\n'),
  },
  {
    id: 'state',
    label: 'State',
    source: [
      'stateDiagram-v2',
      '  [*] --> Draft',
      '  Draft --> Review : submit',
      '  Review --> Draft : request changes',
      '  Review --> Published : approve',
      '  Published --> [*]',
    ].join('\n'),
  },
  {
    id: 'er',
    label: 'Entity relationship',
    source: [
      'erDiagram',
      '  AUTHOR ||--o{ PAPER : writes',
      '  PAPER ||--|{ SECTION : contains',
      '  PAPER }o--o{ SOURCE : cites',
    ].join('\n'),
  },
  {
    id: 'gantt',
    label: 'Gantt',
    source: [
      'gantt',
      '  title Paper timeline',
      '  dateFormat YYYY-MM-DD',
      '  section Research',
      '  Literature review :a1, 2026-01-05, 14d',
      '  Experiments       :a2, after a1, 21d',
      '  section Writing',
      '  First draft       :after a2, 10d',
      '  Revisions         :7d',
    ].join('\n'),
  },
  {
    id: 'pie',
    label: 'Pie',
    source: [
      'pie title Where the time went',
      '  "Reading" : 40',
      '  "Experiments" : 35',
      '  "Writing" : 25',
    ].join('\n'),
  },
  {
    id: 'mindmap',
    label: 'Mind map',
    source: [
      'mindmap',
      '  root((Thesis))',
      '    Background',
      '      Prior work',
      '      Open problems',
      '    Method',
      '      Data',
      '      Model',
      '    Results',
    ].join('\n'),
  },
  {
    id: 'timeline',
    label: 'Timeline',
    source: [
      'timeline',
      '  title Milestones',
      '  2024 : Proposal',
      '  2025 : Experiments : First paper',
      '  2026 : Defence',
    ].join('\n'),
  },
];
