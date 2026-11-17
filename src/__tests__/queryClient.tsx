import type { ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, renderHook, type RenderHookOptions, type RenderOptions } from '@testing-library/react';
import { createAppQueryClient } from '@/api/query';
import { TestWorkspace } from './workspace';

/** A fresh cache with the app's defaults, one per test. */
export function createTestQueryClient(): QueryClient {
  return createAppQueryClient();
}

/**
 * `ui` under its own query cache and in the test workspace (`TestWorkspace`),
 * as `App` puts the signed-in surface.
 */
export function withQueryClient(ui: ReactNode, client: QueryClient = createTestQueryClient()) {
  return (
    <QueryClientProvider client={client}>
      <TestWorkspace>{ui}</TestWorkspace>
    </QueryClientProvider>
  );
}

type Wrapper = (props: { children: ReactNode }) => ReactNode;

/**
 * A `wrapper` for `render` and `renderHook`, in the test workspace, around
 * the test's own `inner` wrapper if it has one.
 */
export function queryWrapper(client: QueryClient = createTestQueryClient(), inner?: Wrapper) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    const Inner = inner;
    return (
      <QueryClientProvider client={client}>
        <TestWorkspace>{Inner ? <Inner>{children}</Inner> : children}</TestWorkspace>
      </QueryClientProvider>
    );
  };
}

/** `render` with `ui` under its own query cache; the cache comes back with the result. */
export function renderWithQueryClient(
  ui: ReactNode,
  options: Omit<RenderOptions, 'wrapper'> & { queryClient?: QueryClient; wrapper?: Wrapper } = {},
) {
  const { queryClient = createTestQueryClient(), wrapper, ...renderOptions } = options;
  return { ...render(ui, { ...renderOptions, wrapper: queryWrapper(queryClient, wrapper) }), queryClient };
}

/** `renderHook` under its own query cache; the cache comes back with the result. */
export function renderHookWithQueryClient<Result, Props>(
  hook: (props: Props) => Result,
  options: Omit<RenderHookOptions<Props>, 'wrapper'> & { queryClient?: QueryClient; wrapper?: Wrapper } = {},
) {
  const { queryClient = createTestQueryClient(), wrapper, ...hookOptions } = options;
  return { ...renderHook(hook, { ...hookOptions, wrapper: queryWrapper(queryClient, wrapper) }), queryClient };
}
