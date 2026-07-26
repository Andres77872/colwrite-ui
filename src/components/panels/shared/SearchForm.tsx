import type { FormEvent } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

export const RESULT_LIMITS = [10, 20, 30, 40, 50] as const;

interface SearchFormProps {
  query: string;
  onQueryChange: (value: string) => void;
  limit: number;
  onLimitChange: (value: number) => void;
  onSubmit: () => void;
  loading: boolean;
  placeholder: string;
  /** Labels the limit control for screen readers, e.g. "arXiv results". */
  label: string;
}

/**
 * SearchForm — the query + result-count + submit row shared by the arXiv and
 * ColPali panels, which previously kept two drifting copies of it.
 */
export function SearchForm({
  query,
  onQueryChange,
  limit,
  onLimitChange,
  onSubmit,
  loading,
  placeholder,
  label,
}: SearchFormProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="flex items-center gap-2" onSubmit={handleSubmit} role="search">
      <div className="relative flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          className="pl-8"
          placeholder={placeholder}
          aria-label={placeholder}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          disabled={loading}
        />
      </div>

      <select
        // Native select inherits the page `color-scheme: dark`, so the popup
        // list matches the app instead of rendering as a white sheet.
        className="h-9 rounded-md border border-input bg-input px-2 text-sm text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        value={limit}
        aria-label={`Number of ${label} to return`}
        onChange={(event) => onLimitChange(Number(event.target.value))}
        disabled={loading}
      >
        {RESULT_LIMITS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      <Button type="submit" size="sm" disabled={loading || !query.trim()}>
        {loading && <Spinner />}
        {loading ? 'Searching…' : 'Search'}
      </Button>
    </form>
  );
}
