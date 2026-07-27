import { cva } from 'class-variance-authority';

export const alertVariants = cva(
  'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
  {
    variants: {
      variant: {
        destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
        warning: 'border-warning/40 bg-warning/10 text-warning',
        info: 'border-info/40 bg-info/10 text-info',
        success: 'border-success/40 bg-success/10 text-success',
      },
    },
    defaultVariants: { variant: 'destructive' },
  },
);
