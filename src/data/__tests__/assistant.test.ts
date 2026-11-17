import { describe, expect, it } from 'vitest';
import { jsonOf, pathOf, recordRequests } from '@/__tests__/server';
import { problemCode } from '@/api/errors';
import { LAB_WORKSPACE_ID, PERSONAL_WORKSPACE_ID, VIEWER_WORKSPACE_ID, fixtures } from '@/dev/msw/fixtures';
import { fillDetailTemplate, getAssistantCatalog, getAssistantSettings, updateAssistantSettings } from '../assistant';
import { resolveSource } from '../sources';

/**
 * The assistant's switches and catalog, read through the app's request
 * functions from the mock API, which computes them as the API does.
 */

describe('the account’s switches', () => {
  it('reads the four switches, Papers with its sources, outside any workspace', async () => {
    const sent = recordRequests();
    const settings = await getAssistantSettings();
    expect(pathOf(sent[0])).toBe('/api/users/me/assistant');
    expect(settings.switches.map((row) => [row.id, row.enabled, row.state])).toEqual([
      ['papers', true, 'on'], ['web', false, 'off'], ['workers', false, 'off'], ['images', false, 'unavailable'],
    ]);
    // Every paper source on by default; one the server lacks is unavailable.
    expect(settings.switches[0]?.sources.map((source) => [source.id, source.enabled, source.state, source.reason])).toEqual([
      ['openalex', true, 'on', null], ['arxiv_index', true, 'unavailable', 'Not configured on this server.'], ['semantic_scholar', true, 'on', null],
    ]);
    // Nothing is blocked outside a workspace.
    expect(settings.switches.some((row) => row.state === 'blocked')).toBe(false);
  });

  it('changes only what it names, and keeps only choices that differ from the defaults', async () => {
    const sent = recordRequests();
    const settings = await updateAssistantSettings({ web: true, sources: { semantic_scholar: false } });
    expect(await jsonOf(sent[0])).toEqual({ web: true, sources: { semantic_scholar: false } });
    expect(settings.switches.find((row) => row.id === 'web')).toMatchObject({ enabled: true, state: 'on' });
    expect(fixtures.assistant).toEqual({ switches: { web: true }, sources: { semantic_scholar: false } });
  });

  it('refuses a field the request model does not have, as the API does (422)', async () => {
    const refused = await updateAssistantSettings({ tools: { web_search: true } } as never).catch((error: unknown) => error);
    expect(problemCode(refused)).toBe('invalid_request');
  });
});

describe('the workspace’s catalog', () => {
  it('is read through the workspace, for an engine, with the role and policy there', async () => {
    const sent = recordRequests();
    const catalog = await getAssistantCatalog(LAB_WORKSPACE_ID, 'claude');
    expect(pathOf(sent[0])).toBe(`/api/workspaces/${LAB_WORKSPACE_ID}/assistant/catalog?engine=claude`);
    expect(catalog).toMatchObject({ engine: 'claude', role: 'editor', policy: { web_search: false, outside_research: false, auto: true } });
    expect(catalog.toolsets.find((row) => row.id === 'web')).toMatchObject({ state: 'blocked', reason: 'Web search is switched off in this workspace.' });
  });

  it('answers a viewer, with what writes blocked by the role', async () => {
    const catalog = await getAssistantCatalog(VIEWER_WORKSPACE_ID, 'gateway');
    expect(catalog.role).toBe('viewer');
    expect(catalog.tools.find((row) => row.id === 'doc_edit')).toMatchObject({ state: 'blocked', reason: 'Needs the editor role.' });
    expect(catalog.presets.find((row) => row.id === 'tighten-page')).toMatchObject({ state: 'blocked' });
  });

  it('follows the account’s switches', async () => {
    await updateAssistantSettings({ workers: true });
    const catalog = await getAssistantCatalog(PERSONAL_WORKSPACE_ID, 'gateway');
    expect(catalog.toolsets.find((row) => row.id === 'delegation')).toMatchObject({ state: 'on', reason: null });
  });

  it('is not found through a workspace the account is not in', async () => {
    const refused = await getAssistantCatalog('wsp-missing', 'gateway').catch((error: unknown) => error);
    expect(problemCode(refused)).toBe('workspace_not_found');
  });
});

describe('resolving a source through the workspace', () => {
  it('resolves through the workspace, and is refused where outside research is off', async () => {
    const sent = recordRequests();
    const resolved = await resolveSource(PERSONAL_WORKSPACE_ID, '10.1000/xyz', { title: 'A resolved paper', firstAuthor: 'Author', year: 2024 });
    expect(pathOf(sent[0])).toBe(
      `/api/workspaces/${PERSONAL_WORKSPACE_ID}/sources/resolve?identifier=10.1000%2Fxyz&title=A%20resolved%20paper&first_author=Author&year=2024`,
    );
    // The checked reference, as the editor holds it.
    expect(resolved.record).toMatchObject({ key: 'doi:10.1000/xyz', provider: 'crossref', state: 'needs_review', csl: { id: 'doi:10.1000/xyz', DOI: '10.1000/xyz' } });
    expect(resolved).toMatchObject({ aliases: [], notes: [] });
    const refused = await resolveSource(LAB_WORKSPACE_ID, '10.1000/xyz').catch((error: unknown) => error);
    expect(refused).toMatchObject({ status: 403, data: { code: 'workspace_policy', policy: 'outside_research' } });
  });
});

describe('a detail line', () => {
  it('fills the first template whose placeholders all have a value', () => {
    const templates = ['Published {year_from}–{year_to}', 'Published from {year_from}', 'Published up to {year_to}'];
    expect(fillDetailTemplate(templates, { year_from: 2019, year_to: 2023 })).toBe('Published 2019–2023');
    expect(fillDetailTemplate(templates, { year_from: 2019 })).toBe('Published from 2019');
    expect(fillDetailTemplate(templates, { year_to: 2023, query_redacted: true })).toBe('Published up to 2023');
    expect(fillDetailTemplate(templates, { query_redacted: true })).toBeUndefined();
    expect(fillDetailTemplate(['On {url_host}'], { url_host: '' })).toBeUndefined();
    expect(fillDetailTemplate(['Following {relation}'], { relation: 'citations' })).toBe('Following citations');
    // An enum's value in the words the display gives it; one it does not name, as sent.
    const words = { relation: { citations: 'the papers citing it' } };
    expect(fillDetailTemplate(['Following {relation}'], { relation: 'citations' }, words)).toBe('Following the papers citing it');
    expect(fillDetailTemplate(['Following {relation}'], { relation: 'related' }, words)).toBe('Following related');
    expect(fillDetailTemplate(['Up to {limit} results'], undefined)).toBeUndefined();
  });
});
