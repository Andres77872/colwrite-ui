import type { ReactNode } from 'react';
import type { DocSlug } from '../catalog';
import { assistantDocs } from './assistant';
import { citeDocs } from './cite';
import { manageDocs } from './manage';
import { reviewDocs } from './review';
import { startDocs } from './start';
import { writeDocs } from './write';

// Rendered inside the Vite config process (vite.docs.ts): relative imports
// only, never `@/`.

/** Each page's article, under the title the catalog gives it. */
export const docContent: Record<DocSlug, ReactNode> = {
  ...startDocs,
  ...writeDocs,
  ...citeDocs,
  ...assistantDocs,
  ...reviewDocs,
  ...manageDocs,
};
