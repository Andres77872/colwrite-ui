import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import type {
  AgentToolCategory,
  AgentToolOption,
  AgentToolSettings,
  AgentToolSettingsUpdate,
} from '@/services/agentTools';
import {
  AgentToolsContext,
  type AgentToolsContextValue,
} from './agentToolsContextState';
import { AgentToolsPreferences } from './AgentToolsPreferences';

function tool(
  id: string,
  label: string,
  category: string,
  options: Partial<AgentToolOption> = {},
): AgentToolOption {
  return {
    id,
    label,
    category,
    description: `${label} description`,
    default_enabled: options.default_enabled ?? true,
    enabled: options.enabled ?? options.default_enabled ?? true,
    available: options.available ?? true,
    effective_enabled:
      options.effective_enabled ?? options.enabled ?? options.default_enabled ?? true,
    modes: options.modes ?? ['assistant', 'rewrite'],
    requires_sources: options.requires_sources ?? [],
    source_policy: options.source_policy ?? 'all',
  };
}

const categories: AgentToolCategory[] = [
  {
    id: 'writing',
    label: 'Writing tools',
    description: 'Writing',
    tools: [
      tool('add_details', 'Add details', 'writing'),
      tool('more_concise', 'Make more concise', 'writing'),
      tool('aibeat', 'Run an AI instruction', 'writing'),
    ],
  },
  {
    id: 'research',
    label: 'Research tools',
    description: 'Research',
    tools: [
      tool('search_citations', 'Find and insert citations', 'research', {
        requires_sources: ['arxiv', 'semantic_scholar'],
        source_policy: 'any',
      }),
      ...[
        ['semantic_scholar_search', 'Search Semantic Scholar'],
        ['semantic_scholar_paper', 'Inspect paper metadata'],
        ['semantic_scholar_graph', 'Explore citation graph'],
        ['semantic_scholar_recommendations', 'Find related papers'],
        ['semantic_scholar_snippets', 'Retrieve paper evidence'],
        ['validate_claim', 'Validate a claim'],
      ].map(([id, label]) =>
        tool(id, label, 'research', {
          default_enabled: false,
          enabled: false,
          effective_enabled: false,
          requires_sources: ['semantic_scholar'],
        }),
      ),
    ],
  },
  {
    id: 'library',
    label: 'PDF library tools',
    description: 'Library',
    tools: [
      tool('resource_ls', 'List available PDFs', 'library'),
      tool('resource_read', 'Read a PDF', 'library'),
      tool('resource_retrieve', 'Retrieve relevant PDF passages', 'library'),
      tool('resource_search', 'Search exact text in PDFs', 'library'),
    ],
  },
  {
    id: 'document',
    label: 'Document tools',
    description: 'Documents',
    tools: [
      tool('doc_read', 'Reload document snapshot', 'document', {
        modes: ['assistant'],
      }),
      tool('doc_edit', 'Propose document edits', 'document', {
        modes: ['assistant'],
      }),
      tool('doc_create', 'Create documents', 'document', {
        modes: ['assistant'],
      }),
    ],
  },
];

const SETTINGS: AgentToolSettings = {
  version: 1,
  sources: [
    {
      id: 'arxiv',
      label: 'arXiv',
      description: 'Search arXiv.',
      default_enabled: true,
      enabled: true,
      available: true,
      effective_enabled: true,
    },
    {
      id: 'semantic_scholar',
      label: 'Semantic Scholar',
      description: 'Search Semantic Scholar.',
      default_enabled: false,
      enabled: false,
      available: true,
      effective_enabled: false,
    },
  ],
  categories,
};

function renderPreferences(
  updateSettings: AgentToolsContextValue['updateSettings'] = async () => SETTINGS,
) {
  const value: AgentToolsContextValue = {
    settings: SETTINGS,
    loading: false,
    loaded: true,
    error: null,
    refresh: vi.fn(async () => SETTINGS),
    updateSettings,
    isSourceEnabled: (id) =>
      SETTINGS.sources.find((source) => source.id === id)?.effective_enabled === true,
    isToolEnabled: (id) =>
      SETTINGS.categories
        .flatMap((category) => category.tools)
        .find((candidate) => candidate.id === id)?.effective_enabled === true,
  };
  return {
    updateSettings,
    ...render(
      <ToastProvider>
        <AgentToolsContext.Provider value={value}>
          <AgentToolsPreferences />
        </AgentToolsContext.Provider>
      </ToastProvider>,
    ),
  };
}

afterEach(cleanup);

describe('AgentToolsPreferences', () => {
  it('renders the complete categorized catalog with Semantic Scholar off', () => {
    renderPreferences();

    for (const category of [
      'Writing tools',
      'Research tools',
      'PDF library tools',
      'Document tools',
    ]) {
      expect(screen.getByRole('heading', { name: category })).toBeTruthy();
    }
    expect(screen.getAllByRole('checkbox')).toHaveLength(19);
    const semanticSource = screen.getByRole('checkbox', {
      name: /^Semantic Scholar Opt-in/,
    }) as HTMLButtonElement;
    expect(semanticSource.dataset.state).toBe('unchecked');
    expect(screen.getByText(/not a document-privacy switch/i)).toBeTruthy();
  });

  it('saves source and individual research-tool selections', async () => {
    const updateSettings = vi.fn(async (_changes: AgentToolSettingsUpdate) => SETTINGS);
    renderPreferences(updateSettings);

    fireEvent.click(
      screen.getByRole('checkbox', { name: /^Semantic Scholar Opt-in/ }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: /^Search Semantic ScholarSearch/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    const update = updateSettings.mock.calls[0]?.[0];
    expect(update).toBeDefined();
    if (!update) return;
    expect(update?.sources?.semantic_scholar).toBe(true);
    expect(update?.sources?.arxiv).toBe(true);
    expect(update?.tools?.semantic_scholar_search).toBe(true);
    expect(Object.keys(update?.tools ?? {})).toHaveLength(17);
  });

  it('shows a save error without discarding the draft', async () => {
    const updateSettings = vi.fn(async () => {
      throw new Error('Storage unavailable');
    });
    renderPreferences(updateSettings);

    const semantic = screen.getByRole('checkbox', {
      name: /^Semantic Scholar Opt-in/,
    });
    fireEvent.click(semantic);
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Storage unavailable');
    expect((semantic as HTMLButtonElement).dataset.state).toBe('checked');
  });
});
