import { ChevronDown } from 'lucide-react';
import type { CatalogEffort } from '@/api/schema';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type ComposerEffort = {
  value: CatalogEffort['id'] | undefined;
  choices: readonly CatalogEffort[];
  onChange: (id: CatalogEffort['id']) => void;
};

/** All choices, their descriptions and ceilings come from this engine's catalog. */
export function EffortSwitcher({ effort, disabled }: { effort: ComposerEffort; disabled: boolean }) {
  const selected = effort.choices.find((row) => row.id === effort.value);
  if (!selected) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`Assistant effort: ${selected.label}`}
          className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {selected.label}<ChevronDown aria-hidden="true" className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Effort for this conversation</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={selected.id} onValueChange={(value) => {
          const chosen = effort.choices.find((row) => row.id === value);
          if (chosen) effort.onChange(chosen.id);
        }}>
          {effort.choices.map((row) => (
            <DropdownMenuRadioItem key={row.id} value={row.id} indicator className="items-start">
              <span className="flex flex-col gap-0.5">
                <span>{row.label}</span>
                <span className="text-xs text-muted-foreground">{row.description}</span>
                <span className="text-xs text-muted-foreground">
                  {row.budget.cost_limit === null ? '' : `Up to $${row.budget.cost_limit.toFixed(2)} · `}
                  {Math.ceil(row.budget.wall_clock_seconds / 60)} min limit
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
