import type { AgentEngineId, AgentEngineStatus } from '@/services/agentEngines';

export type EngineBadge = {
  label: string;
  variant: 'success' | 'warning' | 'secondary' | 'destructive';
};

/** The short state tag shown next to an engine's name. */
export function engineBadge(status: AgentEngineStatus | null): EngineBadge {
  switch (status?.state) {
    case 'ready':
      return { label: 'Ready', variant: 'success' };
    case 'unauthenticated':
      return { label: 'Sign-in needed', variant: 'warning' };
    case 'unsupported_auth':
      return { label: 'Account sign-in needed', variant: 'warning' };
    case 'not_installed':
      return { label: 'Not installed', variant: 'secondary' };
    case 'disabled':
      return { label: 'Unavailable', variant: 'secondary' };
    case 'error':
      return { label: 'Error', variant: 'destructive' };
    default:
      return { label: 'Checking…', variant: 'secondary' };
  }
}

const FALLBACK_NAMES: Record<AgentEngineId, string> = {
  legacy: 'ColWrite model gateway',
  claude: 'Claude Code',
  codex: 'Codex',
};

export function engineName(engine: AgentEngineId, status: AgentEngineStatus | null): string {
  return status?.name || FALLBACK_NAMES[engine];
}

/** What each engine is, in the author's terms. */
export const ENGINE_SUMMARY: Record<AgentEngineId, string> = {
  legacy: 'The model gateway this ColWrite server is configured with.',
  claude: 'Your own Claude Code CLI on this machine, under your Claude account.',
  codex: 'Your own Codex CLI on this machine, under your ChatGPT account.',
};

/** One line under a ready CLI: how it is signed in, plan and version. */
export function engineSignedInLine(status: AgentEngineStatus | null): string | null {
  if (!status || status.state !== 'ready' || status.engine === 'legacy') return null;
  const parts = [
    'Signed in',
    status.plan ? `${status.plan[0].toUpperCase()}${status.plan.slice(1)} plan` : null,
    status.version,
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * Claude Code's model aliases. Any other id Claude Code accepts (a full
 * model name) goes in "Other model…".
 */
export const CLAUDE_MODEL_ALIASES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'fable', label: 'Fable' },
];

/**
 * The server writes commands in backticks (“Run `codex login` …”); show
 * them as code rather than as literal backticks.
 */
export function inlineCodeParts(text: string): Array<{ code: boolean; text: string }> {
  return text
    .split('`')
    .map((part, index) => ({ code: index % 2 === 1, text: part }))
    .filter((part) => part.text !== '');
}
