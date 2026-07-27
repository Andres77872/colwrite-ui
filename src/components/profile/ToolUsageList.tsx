import { EmptyState } from '@/components/ui/empty-state';
import { formatNumber } from '@/components/editor/blocks/ParagraphBlock/Inlines/GraphInline/chartScale';
import type { ToolUsage } from '@/services/userProfile';
import { Wrench } from 'lucide-react';

/**
 * ToolUsageList — which assistant tools this account actually exercises.
 *
 * A ranked list rather than a bar chart: the reader wants the names and the
 * counts, and a chart of ten labelled rows would say the same thing with more
 * ink. The proportion bar behind each row is a magnitude cue, so it stays a
 * single hue — this is one measure, not ten categories.
 */
export function ToolUsageList({ tools }: { tools: ToolUsage[] }) {
  const peak = tools.reduce((best, tool) => Math.max(best, tool.call_count), 0);

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <h2 className="text-md font-semibold">Assistant tools</h2>
      <p className="text-xs text-muted-foreground">Most used first</p>

      {tools.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No tool runs yet"
          description="Tools the assistant runs on your documents are counted here."
        />
      ) : (
        <ul className="mt-3 space-y-2">
          {tools.map((tool) => (
            <li key={tool.tool_name}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-xs">{tool.tool_name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatNumber(tool.call_count)}
                  {tool.error_count > 0 && (
                    <span className="text-destructive"> · {tool.error_count} failed</span>
                  )}
                </span>
              </div>
              <div
                aria-hidden="true"
                className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${peak > 0 ? (tool.call_count / peak) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
