import type { ElementType } from 'react';
import { formatBytes, formatCompact } from '@/lib/text';
import type { UsageSummary } from '@/services/userProfile';
import {
  Bot,
  Coins,
  FileStack,
  FileText,
  MessagesSquare,
  Save,
} from 'lucide-react';

type Tile = {
  label: string;
  value: string;
  hint?: string;
  icon: ElementType;
};

function tiles(summary: UsageSummary): Tile[] {
  const tokens = summary.tokens_input + summary.tokens_output;
  return [
    {
      label: 'Documents',
      value: formatCompact(summary.documents_active),
      hint:
        summary.documents_deleted > 0
          ? `${formatCompact(summary.documents_deleted)} deleted`
          : 'None deleted',
      icon: FileText,
    },
    {
      label: 'Saves',
      value: formatCompact(summary.document_saves),
      hint: 'Revisions written',
      icon: Save,
    },
    {
      label: 'Chats',
      value: formatCompact(summary.chats_total),
      hint: `${formatCompact(summary.chat_messages_total)} messages`,
      icon: MessagesSquare,
    },
    {
      label: 'Assistant runs',
      value: formatCompact(summary.agent_runs_total),
      hint:
        summary.agent_runs_failed > 0
          ? `${formatCompact(summary.agent_runs_failed)} did not finish`
          : `${formatCompact(summary.tool_calls_total)} tool calls`,
      icon: Bot,
    },
    {
      label: 'Tokens',
      value: formatCompact(tokens),
      hint: `${formatCompact(summary.tokens_input)} in · ${formatCompact(
        summary.tokens_output,
      )} out`,
      icon: Coins,
    },
    {
      label: 'Uploads',
      value: formatCompact(summary.uploads_active),
      hint: formatBytes(summary.uploads_bytes),
      icon: FileStack,
    },
  ];
}

/**
 * StatTiles — the KPI row.
 *
 * Six headline numbers, so this is a row of tiles rather than a chart: each
 * value is a single current quantity, and a bar chart of six unrelated units
 * would say less than the numbers do.
 */
export function StatTiles({ summary }: { summary: UsageSummary }) {
  return (
    <section aria-label="Usage summary">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {tiles(summary).map((tile) => (
          <li
            key={tile.label}
            className="rounded-xl border border-border/60 bg-card p-3"
          >
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <tile.icon aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="truncate text-xs">{tile.label}</span>
            </div>
            {/* Proportional figures: tabular-nums makes a standalone value
                like 121 read loose at this size. */}
            <p className="mt-1.5 text-2xl font-semibold leading-none">{tile.value}</p>
            {tile.hint && (
              <p className="mt-1.5 truncate text-2xs text-muted-foreground">{tile.hint}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
