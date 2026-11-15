import { describe, expect, it } from 'vitest';
import { HttpResponse, http, jsonOf, pathOf, recordRequests, server } from '@/__tests__/server';
import {
  getAgentToolSettings,
  updateAgentToolSettings,
} from '../agentTools';

const EMPTY = { version: 1, sources: [], categories: [], skills: [], features: [] };

describe('agent tool preferences service', () => {
  it('loads the authoritative account catalog', async () => {
    const sent = recordRequests();

    await getAgentToolSettings();

    expect(pathOf(sent[0])).toBe('/api/users/me/agent-tools');
    expect(sent[0]?.credentials).toBe('include');
  });

  it('reads the catalog with every list present', async () => {
    // An older server leaves the lists it has nothing for out.
    server.use(http.get('/users/me/agent-tools', ({ response }) => response.untyped(HttpResponse.json({
      version: 1,
      categories: [{ id: 'c', label: 'C', description: '', tools: [{ id: 't', label: 'T', description: '', category: 'c', default_enabled: true, enabled: true, available: true, effective_enabled: true, source_policy: 'all' }] }],
    }))));

    const settings = await getAgentToolSettings();

    expect(settings).toMatchObject({ sources: [], skills: [], features: [] });
    expect(settings.categories[0]?.tools[0]).toMatchObject({ modes: [], requires_sources: [], requires_tools: [] });
  });

  it('saves explicit false selections without dropping them', async () => {
    const sent = recordRequests();
    server.use(http.put('/users/me/agent-tools', ({ response }) => response(200).json(EMPTY)));

    await updateAgentToolSettings({
      sources: { semantic_scholar: false },
      tools: { doc_create: false },
    });

    expect(pathOf(sent[0])).toBe('/api/users/me/agent-tools');
    expect(sent[0]?.method).toBe('PUT');
    expect(await jsonOf(sent[0])).toEqual({
      sources: { semantic_scholar: false },
      tools: { doc_create: false },
    });
  });
});
