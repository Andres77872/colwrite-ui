import { cva } from 'class-variance-authority';

/**
 * Tags, not pills: a small radius, a tint fill and a regular weight, so a
 * row of them reads as metadata rather than as a row of buttons. Every
 * text/fill pair is a `tint-*` pair tuned to 4.5:1.
 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-xs whitespace-nowrap transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
  {
    variants: {
      variant: {
        default: 'bg-tint-blue text-tint-blue-fg',
        secondary: 'bg-tint-gray text-tint-gray-fg',
        destructive: 'bg-tint-red text-tint-red-fg',
        outline: 'text-muted-foreground ring-1 ring-inset ring-border-strong',
        success: 'bg-tint-green text-tint-green-fg',
        warning: 'bg-tint-yellow text-tint-yellow-fg',
        info: 'bg-tint-blue text-tint-blue-fg',
        ai: 'bg-tint-purple text-tint-purple-fg',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
