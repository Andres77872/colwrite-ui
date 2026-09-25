import { useId, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/components/ui/toastContext';
import { cn } from '@/lib/utils';
import {
  AGENT_ENGINE_IDS,
  type AgentEngineId,
  type AgentEngineStatus,
} from '@/services/agentEngines';
import {
  CLAUDE_MODEL_ALIASES,
  ENGINE_SUMMARY,
  engineBadge,
  engineName,
  engineSignedInLine,
  inlineCodeParts,
} from './agentEngineCopy';
import { useAgentEngine } from './agentEngineContextState';

/**
 * Settings → AI & tools → Agent engine.
 *
 * Rendered only when the API runs locally: a deployed ColWrite has one engine
 * and nothing to choose, and Claude Code / Codex cannot be turned on there.
 * The choice applies at once and is kept on this device.
 */
export function AgentEnginePreferences() {
  const engines = useAgentEngine();
  const { prefs, selectable, statusOf, setChatEngine, setInlineEngine } = engines;
  const inlineId = useId();

  if (!selectable) return null;

  const chatStatus = statusOf(prefs.chat);
  const inlineOptions = AGENT_ENGINE_IDS.filter(
    (engine) => statusOf(engine)?.available || engine === prefs.inline,
  );

  return (
    <section aria-labelledby="agent-engine-title">
      <h2 id="agent-engine-title" className="text-sm font-semibold text-foreground">
        Agent engine
      </h2>
      <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
        What runs the assistant on this machine. Claude Code and Codex use your own CLI sign-in;
        ColWrite never signs in for you or reads those logins. Applies right away, on this device.
      </p>

      <div
        role="radiogroup"
        aria-labelledby="agent-engine-title"
        className="mt-2 flex flex-col divide-y divide-border border-y border-border"
      >
        {AGENT_ENGINE_IDS.map((engine) => (
          <EngineRow
            key={engine}
            engine={engine}
            status={statusOf(engine)}
            selected={prefs.chat === engine}
            onSelect={() => setChatEngine(engine)}
          />
        ))}
      </div>

      {chatStatus && !chatStatus.available && (
        <Alert variant="warning" className="mt-3">
          <span>
            The assistant is set to {engineName(prefs.chat, chatStatus)}, which cannot run yet:{' '}
            <InlineCode text={chatStatus.message} />
          </span>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-6 py-3 max-sm:flex-col max-sm:items-stretch max-sm:gap-2.5">
        <div className="min-w-0">
          <label htmlFor={inlineId} className="text-sm font-medium text-foreground">
            Inline AI
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ask AI, selection rewrites and AI beats. A local CLI takes a few seconds to start, so
            quick rewrites may suit the gateway better.
          </p>
        </div>
        <NativeSelect
          id={inlineId}
          className="w-full shrink-0 sm:w-60"
          value={prefs.inline}
          onChange={(event) => setInlineEngine(event.target.value as AgentEngineId | 'chat')}
        >
          <option value="chat">Same as assistant</option>
          {inlineOptions.map((engine) => (
            <option key={engine} value={engine}>
              {engineName(engine, statusOf(engine))}
              {statusOf(engine)?.available ? '' : ` (${engineBadge(statusOf(engine)).label.toLowerCase()})`}
            </option>
          ))}
        </NativeSelect>
      </div>
    </section>
  );
}

function EngineRow({
  engine,
  status,
  selected,
  onSelect,
}: {
  engine: AgentEngineId;
  status: AgentEngineStatus | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const { checking, checkError, check } = useAgentEngine();
  const radioId = useId();
  const badge = engineBadge(status);
  const available = status?.available === true;
  const isCli = engine !== 'legacy';
  const signedIn = engineSignedInLine(status);

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-start gap-3">
        <input
          id={radioId}
          type="radio"
          name="agent-engine"
          value={engine}
          checked={selected}
          // A CLI that cannot run is not offered; once it is ready, it can be.
          disabled={!available && !selected}
          onChange={onSelect}
          aria-describedby={`${radioId}-summary`}
          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary-strong disabled:cursor-not-allowed"
        />
        <div className="min-w-0 flex-1">
          <label
            htmlFor={radioId}
            className={cn(
              'flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium text-foreground',
              available || selected ? 'cursor-pointer' : 'cursor-not-allowed',
            )}
          >
            {engineName(engine, status)}
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </label>
          <p id={`${radioId}-summary`} className="mt-0.5 text-xs text-muted-foreground">
            {ENGINE_SUMMARY[engine]}
            {signedIn ? ` ${signedIn}.` : ''}
          </p>
          {/* Signed out: the login row below says it all. Otherwise (a key
              login, not installed, local-only) the server's reason. */}
          {status && !available && status.state !== 'unauthenticated' && (
            <p className="mt-1 text-xs text-foreground">
              <InlineCode text={status.message} />
            </p>
          )}
          {status?.login_command && <LoginCommand command={status.login_command} />}
          {checkError[engine] && (
            <p className="mt-1 text-xs text-destructive">{checkError[engine]}</p>
          )}
        </div>
        {isCli && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => void check(engine)}
            disabled={checking === engine}
            aria-label={`Check ${engineName(engine, status)} again`}
          >
            {checking === engine ? <Spinner /> : <RefreshCw aria-hidden="true" />}
            {checking === engine ? 'Checking…' : 'Check again'}
          </Button>
        )}
      </div>
      {available && (
        <div className="pl-7">
          <ModelField engine={engine} />
        </div>
      )}
    </div>
  );
}

function InlineCode({ text }: { text: string }) {
  return (
    <>
      {inlineCodeParts(text).map((part, index) =>
        part.code ? (
          <code key={index} className="rounded-sm bg-subtle px-1 font-mono">
            {part.text}
          </code>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** The official sign-in command, to run in your own terminal. */
function LoginCommand({ command }: { command: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Could not copy', description: command, variant: 'error' });
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs text-foreground">
        Not signed in. To use it, run this in a terminal on this machine
      </span>
      <code className="rounded-sm bg-subtle px-1.5 py-0.5 font-mono text-xs text-foreground ring-1 ring-inset ring-border">
        {command}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => void copy()}
        aria-label={`Copy ${command}`}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <span className="text-xs text-muted-foreground">
        and sign in with your own account, then choose Check again.
      </span>
    </div>
  );
}

const OTHER = '__other__';

/** Per-engine model override. Empty means the engine's own default. */
function ModelField({ engine }: { engine: AgentEngineId }) {
  const { prefs, setModel } = useAgentEngine();
  const saved = prefs.models[engine] ?? '';
  const [draft, setDraft] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const isAlias = CLAUDE_MODEL_ALIASES.some((alias) => alias.value === saved);
  const [other, setOther] = useState(engine === 'claude' && saved !== '' && !isAlias);
  const inputId = useId();
  const errorId = useId();

  const commit = (value: string) => {
    const next = setModel(engine, value);
    setProblem(next);
    if (!next) setDraft(value.trim());
  };

  const placeholder =
    engine === 'legacy' ? 'Server default' : engine === 'claude' ? 'claude-sonnet-5' : 'Codex default';
  const hint =
    engine === 'legacy'
      ? 'A gateway model id for this server. Empty uses the server default.'
      : engine === 'claude'
        ? 'Empty uses Claude Code’s own default. Your Claude Code settings file is not read.'
        : 'A Codex model id. Empty uses Codex’s own default for your plan.';

  const textField = (
    <Input
      id={inputId}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      aria-label={engine === 'claude' ? 'Claude Code model id' : undefined}
      aria-invalid={problem ? true : undefined}
      aria-describedby={problem ? errorId : `${inputId}-hint`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit(draft);
        }
      }}
      className="w-full sm:w-56"
    />
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={engine === 'claude' ? `${inputId}-alias` : inputId} className="w-12 text-xs text-muted-foreground">
          Model
        </label>
        {engine === 'claude' ? (
          <>
            <NativeSelect
              id={`${inputId}-alias`}
              className="w-full sm:w-44"
              value={other ? OTHER : isAlias ? saved : ''}
              onChange={(event) => {
                const value = event.target.value;
                if (value === OTHER) {
                  setOther(true);
                  return;
                }
                setOther(false);
                commit(value);
              }}
            >
              <option value="">Claude Code default</option>
              {CLAUDE_MODEL_ALIASES.map((alias) => (
                <option key={alias.value} value={alias.value}>
                  {alias.label}
                </option>
              ))}
              <option value={OTHER}>Other model…</option>
            </NativeSelect>
            {other && textField}
          </>
        ) : (
          textField
        )}
      </div>
      {problem ? (
        <p id={errorId} className="pl-14 text-xs text-destructive max-sm:pl-0">
          {problem} Still using {saved || 'the default'}.
        </p>
      ) : (
        <p id={`${inputId}-hint`} className="pl-14 text-xs text-muted-foreground max-sm:pl-0">
          {hint}
        </p>
      )}
    </div>
  );
}
