import { describe, expect, it } from 'vitest';
import {
  checkAgentEngine,
  engineModelProblem,
  gatewayModelsFor,
  getAgentEngines,
  isAgentEngineId,
} from '../agentEngines';
import { pathOf, recordRequests } from '@/__tests__/server';

describe('agent engines service', () => {
  it('lists engines from the agent route the dev proxy forwards unchanged', async () => {
    const sent = recordRequests();

    await getAgentEngines();

    expect(pathOf(sent[0])).toBe('/api/agent/engines');
    expect(sent[0]?.credentials).toBe('include');
  });

  it('re-checks one engine with a POST', async () => {
    const sent = recordRequests();

    const status = await checkAgentEngine('codex');

    expect(pathOf(sent[0])).toBe('/api/agent/engines/codex/check');
    expect(sent[0]?.method).toBe('POST');
    // The preview's Codex reports itself signed in once checked again.
    expect(status.state).toBe('ready');
  });

  it('recognises engine ids', () => {
    expect(isAgentEngineId('claude')).toBe(true);
    expect(isAgentEngineId('gpt')).toBe(false);
    expect(isAgentEngineId(undefined)).toBe(false);
  });

  it('applies the server’s model rules', () => {
    expect(engineModelProblem('claude', '')).toBeNull();
    expect(engineModelProblem('claude', 'sonnet')).toBeNull();
    expect(engineModelProblem('claude', 'claude-sonnet-5')).toBeNull();
    expect(engineModelProblem('claude', 'claude-opus-4-6[1m]')).toBeNull();
    expect(engineModelProblem('codex', 'gpt-6-astra')).toBeNull();
    // Gateway ids are for the gateway only.
    expect(engineModelProblem('claude', '~anthropic/claude-haiku-latest')).toMatch(/gateway id/);
    expect(engineModelProblem('codex', '--dangerous')).not.toBeNull();
    expect(engineModelProblem('gateway', '~anthropic/claude-haiku-latest')).toBeNull();
    expect(engineModelProblem('gateway', 'two words')).not.toBeNull();
  });

  it('uses only valid server catalog entries, deduplicated within each tier', () => {
    expect(gatewayModelsFor({
      runtime: 'deployed', default_engine: 'gateway', engines: [],
      gateway_models: { main: ['openai/gpt-6.1-sol', '', 'two words', 'openai/gpt-6.1-sol'], lite: ['openai/gpt-6-luna'] },
    }, 'main')).toEqual(['openai/gpt-6.1-sol']);
    expect(gatewayModelsFor(null, 'lite')).toEqual([]);
    expect(gatewayModelsFor({
      runtime: 'deployed', default_engine: 'gateway', engines: [], gateway_models: { main: [], lite: [] },
    }, 'lite')).toEqual([]);
  });
});
