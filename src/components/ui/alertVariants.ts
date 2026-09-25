import { cva } from 'class-variance-authority';

/** A tinted note with no border: the fill alone sets it apart from the page. */
export const alertVariants = cva(
  'flex items-start gap-2 rounded-md px-3 py-2 text-sm',
  {
    variants: {
      variant: {
        destructive: 'bg-tint-red text-tint-red-fg',
        warning: 'bg-tint-yellow text-tint-yellow-fg',
        info: 'bg-tint-blue text-tint-blue-fg',
        success: 'bg-tint-green text-tint-green-fg',
      },
    },
    defaultVariants: { variant: 'destructive' },
  },
);
