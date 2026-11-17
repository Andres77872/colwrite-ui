import { agentHttp, server, serverError } from '@/__tests__/server';
import type { AgentEngineCatalog, AgentEngineId, AgentEngineStatus } from '../agentEngines';

/** The engine routes as a test's server answers them. */
export type AgentEngineServer = {
  list: () => AgentEngineCatalog | Promise<AgentEngineCatalog>;
  check: (engine: AgentEngineId) => AgentEngineStatus | Promise<AgentEngineStatus>;
};

/**
 * Answer `GET /api/agent/engines` with `engines.list()` and
 * `POST /api/agent/engines/{engine}/check` with `engines.check(engine)` for
 * the rest of the test. A handler that throws is the server failing, with
 * the error's message as the problem's detail.
 */

export function mockAgentEngines(engines: AgentEngineServer): void {
  server.use(
    agentHttp.get('/api/agent/engines', async ({ response }) => {
      try {
        return response(200).json(await engines.list());
      } catch (error) {
        return serverError(error);
      }
    }),
    agentHttp.post('/api/agent/engines/{engine_id}/check', async ({ params, response }) => {
      try {
        return response(200).json(await engines.check(params.engine_id as AgentEngineId));
      } catch (error) {
        return serverError(error);
      }
    }),
  );
}
