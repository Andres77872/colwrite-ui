import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-120 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Filled variants use the `-strong` hues: the lighter `primary` and
        // `destructive` do not reach 4.5:1 against white at button text sizes.
        // One filled button per view; everything else in the chrome is ghost.
        default: 'bg-primary-strong text-primary-foreground hover:bg-primary-strong/90',
        destructive:
          'bg-destructive-strong text-destructive-foreground hover:bg-destructive-strong/90',
        // An inset ring rather than a border, so it takes no layout space and
        // lines up with a ghost button beside it.
        outline: 'text-foreground ring-1 ring-inset ring-border-strong hover:bg-hover',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-active',
        ghost: 'hover:bg-hover hover:text-accent-foreground',
        link: 'text-link underline-offset-4 hover:underline',
        // Icon-only chrome: a muted glyph that darkens on hover.
        // A trigger whose menu is open stays tinted, so the menu reads as
        // attached to it (as the workspace button already did).
        icon: 'text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-active aria-expanded:text-foreground',
        // Anything that talks to the model: the violet sparkle language.
        ai: 'text-ai hover:bg-ai/10',
      },
      // The two smallest sizes carry their own icon size: a 16px glyph in a
      // 24px box leaves no optical padding. Every other size inherits the
      // base `[&_svg]:size-4`, so an icon never needs a per-instance override.
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2',
        lg: 'h-9 px-4',
        xs: 'h-6 px-1.5 text-xs [&_svg]:size-3.5',
        icon: 'h-8 w-8',
        'icon-sm': 'h-7 w-7',
        'icon-xs': 'h-6 w-6 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
