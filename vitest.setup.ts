import { notifyManager } from '@tanstack/react-query'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server, stopRecording, takeUnhandled } from './src/__tests__/server'
import { resetMockApi } from './src/dev/msw/handlers'

// Enable act() support for React concurrent rendering in jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// The query cache tells its components about a result on the next tick, a
// `setTimeout(0)` that a test's fake timers would hold back. A microtask
// keeps that independent of the clock; the query timers (polling, garbage
// collection) still run on it.
notifyManager.setScheduler(queueMicrotask)

// jsdom does not implement CSS.escape; the editor escapes tool-payload ids
// into attribute selectors with it. Native browsers provide the real thing.
if (typeof globalThis.CSS === 'undefined') {
  (globalThis as { CSS?: Record<string, unknown> }).CSS = {};
}
if (typeof CSS.escape !== 'function') {
  CSS.escape = (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

// The network is the mock API (src/dev/msw), the same one the dev preview
// uses. A request it has no handler for fails, and fails the test that sent
// it even when the app swallows the error; a test's own handlers
// (`server.use`) and whatever it wrote are gone before the next.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  stopRecording()
  resetMockApi()
  const unhandled = takeUnhandled()
  if (unhandled.length > 0) throw new Error(`The mock API has no handler for ${unhandled.join(', ')}`)
})
afterAll(() => server.close())
