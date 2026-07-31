import { createContext, useContext } from 'react';
import type {
  AgentToolSettings,
  AgentToolSettingsUpdate,
} from '@/services/agentTools';

export type AgentToolsContextValue = {
  settings: AgentToolSettings | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<AgentToolSettings | null>;
  updateSettings: (changes: AgentToolSettingsUpdate) => Promise<AgentToolSettings>;
  isSourceEnabled: (sourceId: string) => boolean;
  isToolEnabled: (toolId: string) => boolean;
};

export const AgentToolsContext = createContext<AgentToolsContextValue | undefined>(undefined);

export function useAgentTools(): AgentToolsContextValue {
  const context = useContext(AgentToolsContext);
  if (!context) throw new Error('useAgentTools must be used within AgentToolsProvider');
  return context;
}
