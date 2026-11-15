import { itemAt } from '@/lib/itemAt';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import type {
  AgentToolCategory,
  AgentToolOption,
  AgentToolSettings,
  AgentToolSettingsUpdate,
} from '@/data/agentTools';
import {
  AgentToolsContext,
  type AgentToolsContextValue,
} from './agentToolsContextState';
import { AgentToolsPreferences } from './AgentToolsPreferences';
import { ApiError } from '@/api/errors';

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
        tool(id ?? '', label ?? '', 'research', {
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
  skills: [],
  features: [],
};

/** The catalog after a PUT, as the API answers it: selections merged in. */
function applyUpdate(catalog: AgentToolSettings, changes: AgentToolSettingsUpdate): AgentToolSettings {
  const next = structuredClone(catalog);
  const set = <T extends { id: string; enabled: boolean; available: boolean; effective_enabled: boolean }>(
    options: T[] | undefined,
    selection: Record<string, boolean> | null | undefined,
  ) => {
    for (const option of options ?? []) {
      const chosen = selection?.[option.id];
      if (typeof chosen === 'boolean') option.enabled = chosen;
      option.effective_enabled = option.enabled && option.available;
    }
  };
  set(next.sources, changes.sources);
  set(next.categories.flatMap((category) => category.tools), changes.tools);
  set(next.skills, changes.skills);
  set(next.features, changes.features);
  return next;
}

/**
 * The preferences inside a context that behaves like the real provider: a
 * successful save replaces `settings` with the server's answer. `updateSettings`
 * sees every request first; when it throws, the save fails.
 */
function Harness({
  catalog,
  updateSettings,
}: {
  catalog: AgentToolSettings;
  updateSettings: (changes: AgentToolSettingsUpdate) => Promise<unknown>;
}) {
  const [settings, setSettings] = useState(catalog);
  const value: AgentToolsContextValue = {
    settings,
    loading: false,
    loaded: true,
    error: null,
    refresh: vi.fn(async () => settings),
    updateSettings: async (changes) => {
      await updateSettings(changes);
      let saved = settings;
      setSettings((current) => (saved = applyUpdate(current, changes)));
      return saved;
    },
    isSourceEnabled: (id) => settings.sources.find((source) => source.id === id)?.effective_enabled === true,
    isToolEnabled: (id) =>
      settings.categories
        .flatMap((category) => category.tools)
        .find((candidate) => candidate.id === id)?.effective_enabled === true,
    policy: { web_search: true, outside_research: true, auto: true },
    switchedOffBy: () => null,
  };
  return (
    <AgentToolsContext.Provider value={value}>
      <AgentToolsPreferences />
    </AgentToolsContext.Provider>
  );
}

function renderPreferences(
  updateSettings: (changes: AgentToolSettingsUpdate) => Promise<unknown> = vi.fn(async () => undefined),
  catalog: AgentToolSettings = SETTINGS,
) {
  return {
    updateSettings,
    ...render(
      <ToastProvider>
        <Harness catalog={catalog} updateSettings={updateSettings} />
      </ToastProvider>,
    ),
  };
}

const state = (name: RegExp) => screen.getByRole('switch', { name }).getAttribute('aria-checked');

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
    expect(screen.getByText(/does not keep the page private/i)).toBeTruthy();
    // Exceptions only: no per-row "Available to agent" and no account chip.
    expect(screen.queryByText('Available to agent')).toBeNull();
    expect(screen.queryByText('Account-wide')).toBeNull();
  });

  it('saves each switch as it changes, one request at a time, in order', async () => {
    let release: () => void = () => {};
    const updateSettings = vi.fn(
      (_changes: AgentToolSettingsUpdate) =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    renderPreferences(updateSettings);

    fireEvent.click(screen.getByRole('switch', { name: /^Semantic Scholar Opt-in/ }));
    fireEvent.click(screen.getByRole('switch', { name: /^Search Semantic ScholarSearch/ }));

    // Both show at once; the second waits for the first.
    expect(state(/^Semantic Scholar Opt-in/)).toBe('true');
    expect(state(/^Search Semantic ScholarSearch/)).toBe('true');
    expect(screen.getByText('Saving…')).toBeTruthy();
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenNthCalledWith(1, { sources: { semantic_scholar: true } });

    await act(async () => release());
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(2));
    expect(updateSettings).toHaveBeenNthCalledWith(2, { tools: { semantic_scholar_search: true } });
    await act(async () => release());

    expect(await screen.findByText('Changes are saved as you make them.')).toBeTruthy();
    expect(state(/^Semantic Scholar Opt-in/)).toBe('true');
    expect(state(/^Search Semantic ScholarSearch/)).toBe('true');
    expect(screen.queryByRole('button', { name: 'Save preferences' })).toBeNull();
  });

  it('puts a switch back and says why beside it when its save fails', async () => {
    const updateSettings = vi.fn(async () => {
      throw new ApiError('Storage unavailable', 503, null);
    });
    renderPreferences(updateSettings);

    fireEvent.click(screen.getByRole('switch', { name: /^Semantic Scholar Opt-in/ }));
    expect(state(/^Semantic Scholar Opt-in/)).toBe('true');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Not saved');
    expect(alert.textContent).toContain('Storage unavailable');
    expect(state(/^Semantic Scholar Opt-in/)).toBe('false');
    expect(
      screen.getByRole('switch', { name: /^Semantic Scholar Opt-in/ }).getAttribute('aria-describedby'),
    ).toContain(alert.id);
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
  it('saves explicit opt-out and opt-in selections as they change', async () => {
    const update = vi.fn(async () => undefined);
    renderPreferences(update, CAPABILITY_SETTINGS);
    fireEvent.click(screen.getByRole('switch', { name: /^Editor tools/ }));
    fireEvent.click(screen.getByRole('switch', { name: /^Research subagents/ }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenNthCalledWith(1, { skills: { 'editor-tools': false } });
    expect(update).toHaveBeenNthCalledWith(2, { features: { subagents: true } });
  });
  it('shows unmet tool dependencies immediately, and resets to defaults in one save with an undo', async () => {
    const update = vi.fn(async (_changes: AgentToolSettingsUpdate) => undefined);
    renderPreferences(update, CAPABILITY_SETTINGS);
    fireEvent.click(screen.getByRole('switch', { name: /^Reload document snapshot/ }));
    expect(screen.getByText('Needs Reload document snapshot')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: /^Research subagents/ }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    await screen.findByText('Changes are saved as you make them.');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(state(/^Research subagents/)).toBe('false');
    expect(screen.queryByText('Needs Reload document snapshot')).toBeNull();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
    expect(update).toHaveBeenNthCalledWith(3, { tools: { doc_read: true }, features: { subagents: false } });

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(4));
    expect(update).toHaveBeenNthCalledWith(4, { tools: { doc_read: false }, features: { subagents: true } });
    await waitFor(() => expect(state(/^Research subagents/)).toBe('true'));
    expect((screen.getByRole('button', { name: 'Reset to defaults' }) as HTMLButtonElement).disabled).toBe(false);
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
    itemAt(itemAt(catalog.categories, 0).tools, 0).enabled = true;
    itemAt(itemAt(catalog.categories, 0).tools, 0).available = false;
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
