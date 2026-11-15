import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { TINT_CLASSES, WORKSPACE_EMOJI, WORKSPACE_TINTS, iconLook, tintToken, workspaceInitials } from './workspaceIcon';

const TINT_NAMES: Record<(typeof WORKSPACE_TINTS)[number], string> = {
  orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple',
  pink: 'Pink', red: 'Red', brown: 'Brown', gray: 'Gray',
};

/**
 * The icon of a workspace: a colour tile with its initials, or an emoji.
 * One radio group, one tab stop, the arrow keys move between the choices
 * and pick them. The chosen one is announced as checked, and it carries a
 * ring as well as its colour.
 */
export function WorkspaceIconPicker({
  name,
  value,
  onChange,
  disabled = false,
  labelledBy,
}: {
  name: string;
  value: string | null;
  onChange: (icon: string) => void;
  disabled?: boolean;
  labelledBy?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const look = iconLook(value);
  const options = [
    ...WORKSPACE_TINTS.map((tint) => ({ token: tintToken(tint), label: `${TINT_NAMES[tint]} tile`, tint, emoji: null })),
    ...WORKSPACE_EMOJI.map((emoji) => ({ token: emoji, label: emoji, tint: null, emoji })),
  ];
  const current = look.kind === 'tint' ? tintToken(look.tint) : look.emoji;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.token === current));
  const initials = workspaceInitials(name.trim() || 'Workspace');

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
        : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.token);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : 'Icon'}
      className="flex flex-wrap gap-1.5"
    >
      {options.map((option, index) => {
        const checked = index === selectedIndex;
        return (
          <button
            key={option.token}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            disabled={disabled}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.token)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              'grid size-8 place-items-center rounded-md text-xs font-semibold outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              option.tint ? TINT_CLASSES[option.tint] : 'bg-subtle text-base',
              checked ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background' : 'hover:ring-1 hover:ring-border-strong',
            )}
          >
            <span aria-hidden="true">{option.emoji ?? initials}</span>
          </button>
        );
      })}
    </div>
  );
}
