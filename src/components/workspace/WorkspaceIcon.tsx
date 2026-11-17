import { cn } from '@/lib/utils';
import { TINT_CLASSES, iconLook, workspaceInitials } from './workspaceIcon';

const SIZES = {
  sm: 'size-[18px] rounded-[4px] text-[9px]',
  md: 'size-[22px] rounded-[5px] text-2xs',
  lg: 'size-8 rounded-md text-xs',
} as const;

/**
 * A workspace's tile: its emoji, or its initials on its colour. Decorative:
 * the name beside it says which workspace it is.
 */
export function WorkspaceIcon({
  workspace,
  size = 'md',
  className,
}: {
  workspace: { name: string; icon: string | null };
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const look = iconLook(workspace.icon);
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center font-semibold leading-none',
        SIZES[size],
        look.kind === 'tint' ? TINT_CLASSES[look.tint] : 'bg-subtle',
        className,
      )}
    >
      {look.kind === 'emoji' ? <span className={size === 'lg' ? 'text-base' : 'text-xs'}>{look.emoji}</span> : workspaceInitials(workspace.name)}
    </span>
  );
}
