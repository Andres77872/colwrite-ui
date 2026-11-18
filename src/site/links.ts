import { buttonVariants } from '../components/ui/buttonVariants';

// Imported by the Vite config process (vite.docs.ts): relative imports only, never `@/`.

export const SAMPLE_PAPER_HREF = '/examples/?view=paper';
/** The landing opens the sign-in dialog when it is reached with this hash. */
export const SIGN_IN_HASH = '#sign-in';

/** The primary call to action's look, for an `<a>` or a `<button>`. */
export const signInClass = (size: 'sm' | 'lg' = 'sm') => buttonVariants({ size });
