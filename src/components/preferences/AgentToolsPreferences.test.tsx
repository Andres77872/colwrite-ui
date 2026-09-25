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
    requires_tools: options.requires_tools ?? [],
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
  catalog: AgentToolSettings = SETTINGS,
) {
  const value: AgentToolsContextValue = {
    settings: catalog,
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
    expect(screen.getAllByRole('switch')).toHaveLength(19);
    const semanticSource = screen.getByRole('switch', {
      name: /^Semantic Scholar Opt-in/,
    }) as HTMLButtonElement;
    expect(semanticSource.dataset.state).toBe('unchecked');
    expect(screen.getByText(/not a document-privacy switch/i)).toBeTruthy();
    // Exceptions only: no per-row "Available to agent" and no account chip.
    expect(screen.queryByText('Available to agent')).toBeNull();
    expect(screen.queryByText('Account-wide')).toBeNull();
  });

  it('saves source and individual research-tool selections', async () => {
    const updateSettings = vi.fn(async (_changes: AgentToolSettingsUpdate) => SETTINGS);
    renderPreferences(updateSettings);

    fireEvent.click(
      screen.getByRole('switch', { name: /^Semantic Scholar Opt-in/ }),
    );
    fireEvent.click(
      screen.getByRole('switch', { name: /^Search Semantic ScholarSearch/ }),
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

    const semantic = screen.getByRole('switch', {
      name: /^Semantic Scholar Opt-in/,
    });
    fireEvent.click(semantic);
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Storage unavailable');
    expect((semantic as HTMLButtonElement).dataset.state).toBe('checked');
  });
});

const CAPABILITY_SETTINGS: AgentToolSettings = {
  ...SETTINGS,
  skills: [{ id: 'editor-tools', label: 'Editor tools', description: 'Use structured editing safely.',
    default_enabled: true, enabled: true, available: true, effective_enabled: true,
    requires_tools: ['doc_read', 'doc_edit'], modes: ['assistant'], unavailable_reason: null }],
  features: [{ id: 'subagents', label: 'Research subagents', description: 'Delegate independent research.',
    default_enabled: false, enabled: false, available: true, effective_enabled: false,
    requires_tools: [], modes: ['assistant'], unavailable_reason: null }],
};

describe('skills and planning preferences', () => {
  it('saves explicit opt-out and opt-in selections with the tool draft', async () => {
    const update = vi.fn(async () => CAPABILITY_SETTINGS);
    renderPreferences(update, CAPABILITY_SETTINGS);
    fireEvent.click(screen.getByRole('switch', { name: /^Editor tools/ }));
    fireEvent.click(screen.getByRole('switch', { name: /^Research subagents/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({
      skills: { 'editor-tools': false }, features: { subagents: true },
    })));
  });
  it('shows unmet tool dependencies immediately and resets feature defaults', () => {
    renderPreferences(undefined, CAPABILITY_SETTINGS);
    fireEvent.click(screen.getByRole('switch', { name: /^Reload document snapshot/ }));
    expect(screen.getByText('Needs Reload document snapshot')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: /^Research subagents/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(screen.getByRole('switch', { name: /^Research subagents/ }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText('Needs Reload document snapshot')).toBeNull();
  });
});


describe('dependency availability', () => {
  const researchSettings: AgentToolSettings = {
    ...SETTINGS,
    categories: [{ id: 'research', label: 'Research tools', description: 'Research', tools: [
      tool('web_search', 'Search the web', 'research', {
        enabled: false, requires_sources: ['arxiv', 'semantic_scholar'], source_policy: 'any',
      }),
      tool('web_read', 'Read web pages', 'research', { requires_tools: ['web_search'] }),
    ] }],
    skills: [{ id: 'research', label: 'Research guide', description: 'Guide a research task.',
      default_enabled: true, enabled: true, available: true, effective_enabled: false,
      requires_tools: ['web_read'], modes: ['assistant'], unavailable_reason: null }],
  };

  it('propagates draft tool and source dependencies through tools and skills', () => {
    renderPreferences(undefined, researchSettings);
    expect(screen.getByText('Needs Search the web')).toBeTruthy();
    expect(screen.getByText('Needs Read web pages')).toBeTruthy();
    expect(screen.getByText('Enable Search the web and their dependencies below.')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: /^Search the web/ }));
    expect(screen.queryByText(/^Needs /)).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: /^arXiv/ }));
    expect(screen.getByText('Needs arXiv or Semantic Scholar')).toBeTruthy();
    expect(screen.getByText('Needs Search the web')).toBeTruthy();
    expect(screen.getByText('Needs Read web pages')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: /^Semantic Scholar Opt-in/ }));
    expect(screen.queryByText(/^Needs /)).toBeNull();
    expect(screen.getByRole('switch', { name: /^Research guide/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('keeps a selected skill ineffective when a required tool is unavailable', () => {
    const catalog = structuredClone(researchSettings);
    catalog.categories[0].tools[0].enabled = true;
    catalog.categories[0].tools[0].available = false;
    renderPreferences(undefined, catalog);
    expect((screen.getByRole('switch', { name: /^Search the web/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Needs Search the web')).toBeTruthy();
    expect(screen.getByText('Needs Read web pages')).toBeTruthy();
  });

  it.each(['skills', 'features'] as const)('makes unavailable %s explanations visible and linked to the disabled switch', (kind) => {
    const reason = 'Web research is not configured on this server.';
    const catalog: AgentToolSettings = { ...SETTINGS, [kind]: [{
      id: 'unavailable', label: 'Research capability', description: 'Research the public web.',
      default_enabled: true, enabled: true, available: false, effective_enabled: false,
      requires_tools: ['web_search'], modes: ['assistant'], unavailable_reason: reason,
    }] };
    renderPreferences(undefined, catalog);
    const control = screen.getByRole('switch', { name: /^Research capability/ }) as HTMLButtonElement;
    const explanation = screen.getByText(reason);
    expect(control.disabled).toBe(true);
    expect(control.getAttribute('aria-describedby')?.split(' ')).toContain(explanation.id);
    expect(explanation.className).not.toContain('line-clamp');
    expect(explanation.hidden).toBe(false);
    expect(screen.queryByText(/^Needs /)).toBeNull();
    fireEvent.click(control);
    expect(control.getAttribute('aria-checked')).toBe('true');
  });
});
