import type { ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { TestWorkspace } from './workspace';

/** `render` in the test workspace, for a component that reads `useWorkspaceId`. */
export function renderInWorkspace(ui: ReactNode, options: Omit<RenderOptions, 'wrapper'> = {}) {
  return render(ui, { ...options, wrapper: TestWorkspace });
}
