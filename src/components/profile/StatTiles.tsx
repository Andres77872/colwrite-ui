import type { ElementType } from 'react';
import { formatCompact, formatCost } from '@/lib/text';
import type { UsageSummary } from '@/data/userProfile';
import {
  Bot,
  CircleDollarSign,
  Coins,
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
      label: 'Pages',
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
      value: formatCompact(summary.assistant_runs_total),
      hint:
        summary.assistant_runs_failed > 0
          ? `${formatCompact(summary.assistant_runs_failed)} did not finish`
          : `${formatCompact(summary.tool_calls_total)} tool calls`,
      icon: Bot,
    },
    {
      label: 'Tokens',
      value: formatCompact(tokens),
      hint: `${formatCompact(summary.tokens_input)} in · ${formatCompact(summary.tokens_output)} out`
        + (summary.tokens_cached > 0 ? ` · ${formatCompact(summary.tokens_cached)} cached` : ''),
      icon: Coins,
    },
    {
      label: 'Cost',
      value: formatCost(summary.cost),
      // What providers reported: a CLI engine's runs report none.
      hint: summary.llm_calls_total > 0 ? `Over ${formatCompact(summary.llm_calls_total)} model calls` : 'No model calls yet',
      icon: CircleDollarSign,
    },
  ];
}

/**
 * StatTiles — the KPI row.
 *
 * Six headline numbers, so this is a row of tiles rather than a chart: each
 * value is a single current quantity, and a bar chart of six unrelated units
 * would say less than the numbers do. The cost is what the providers
 * reported for the assistant's model calls. The PDF count and size are the
 * Storage section's, beside the way to the Library.
 */
export function StatTiles({ summary }: { summary: UsageSummary }) {
  return (
    <section aria-label="Usage summary">
      {/* One row of six once the dialog is wide enough beside its pane
          list; below that, three across. */}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles(summary).map((tile) => (
          <li
            key={tile.label}
            className="rounded-lg bg-subtle p-3"
          >
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <tile.icon aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="truncate text-xs" title={tile.label}>
                {tile.label}
              </span>
            </div>
            {/* Proportional figures: tabular-nums makes a standalone value
                like 121 read loose at this size. */}
            <p className="mt-1.5 text-2xl font-semibold leading-none">{tile.value}</p>
            {tile.hint && (
              // Titled because it truncates: at six columns "12.9K in · 4.2M
              // out" loses its second half with nothing to reveal it.
              <p className="mt-1.5 truncate text-2xs text-muted-foreground" title={tile.hint}>
                {tile.hint}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
