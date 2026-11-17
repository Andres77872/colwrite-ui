/**
 * A workspace's icon, as the API stores it (`icon`, at most 64 characters,
 * never a URL): an emoji, or a colour tile named by a palette token
 * (`tint:<colour>`), which shows the workspace's initial. No icon is the
 * orange tile, the colour the personal workspace has always had.
 */

export const WORKSPACE_TINTS = ['orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red', 'brown', 'gray'] as const;
export type WorkspaceTint = (typeof WORKSPACE_TINTS)[number];

/** The tile classes per colour, written out so the stylesheet keeps them. */
export const TINT_CLASSES: Record<WorkspaceTint, string> = {
  orange: 'bg-tint-orange text-tint-orange-fg',
  yellow: 'bg-tint-yellow text-tint-yellow-fg',
  green: 'bg-tint-green text-tint-green-fg',
  blue: 'bg-tint-blue text-tint-blue-fg',
  purple: 'bg-tint-purple text-tint-purple-fg',
  pink: 'bg-tint-pink text-tint-pink-fg',
  red: 'bg-tint-red text-tint-red-fg',
  brown: 'bg-tint-brown text-tint-brown-fg',
  gray: 'bg-tint-gray text-tint-gray-fg',
};

/** The emoji the icon picker offers; any other emoji the API holds shows too. */
export const WORKSPACE_EMOJI = ['📚', '🧪', '📝', '🎓', '🔬', '💡', '📊', '🗂️', '🌱', '🚀', '🧠', '⭐'] as const;

const TINT_PREFIX = 'tint:';

export const tintToken = (tint: WorkspaceTint) => `${TINT_PREFIX}${tint}`;

export type IconLook = { kind: 'tint'; tint: WorkspaceTint } | { kind: 'emoji'; emoji: string };

/** How an icon looks: a known colour token, an emoji, or the default tile. */
export function iconLook(icon: string | null | undefined): IconLook {
  const value = icon?.trim() ?? '';
  if (!value) return { kind: 'tint', tint: 'orange' };
  if (value.startsWith(TINT_PREFIX)) {
    const tint = value.slice(TINT_PREFIX.length) as WorkspaceTint;
    return { kind: 'tint', tint: WORKSPACE_TINTS.includes(tint) ? tint : 'orange' };
  }
  return { kind: 'emoji', emoji: value };
}

/** One or two letters for a colour tile: the initials of the workspace's first two words. */
export function workspaceInitials(name: string): string {
  const words = name.replace(/[’']s\b/g, '').split(/[\s._-]+/).filter(Boolean);
  const first = words[0]?.[0] ?? 'W';
  const second = words.length > 1 ? (words[1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

/** What kind of workspace it is, in words, so the badge is never colour alone. */
export const kindLabel = (kind: 'personal' | 'shared') => (kind === 'personal' ? 'Personal' : 'Shared');
