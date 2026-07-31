import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAgentToolSettings,
  updateAgentToolSettings,
} from '../agentTools';

beforeEach(() => {
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('agent tool preferences service', () => {
  it('loads the authoritative account catalog', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ version: 1, sources: [], categories: [] }),
    );

    await getAgentToolSettings();

    expect(String(fetchSpy.mock.calls[0][0])).toBe('/api/users/me/agent-tools');
    expect((fetchSpy.mock.calls[0][1] as RequestInit).credentials).toBe('include');
  });

  it('saves explicit false selections without dropping them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ version: 1, sources: [], categories: [] }),
    );

    await updateAgentToolSettings({
      sources: { semantic_scholar: false },
      tools: { doc_create: false },
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('/api/users/me/agent-tools');
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      sources: { semantic_scholar: false },
      tools: { doc_create: false },
    });
  });
});
