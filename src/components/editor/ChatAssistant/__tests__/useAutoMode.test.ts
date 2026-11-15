import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { autoStripMessage, useAutoMode, type AutoModeScope } from '../useAutoMode';

const scope = (over: Partial<AutoModeScope> = {}): AutoModeScope => ({ workspace: 'wsp-a', page: 'session-1', chat: null, chatEpoch: 0, ...over });

function setup(initial: AutoModeScope = scope()) {
  return renderHook((props: AutoModeScope) => useAutoMode(props), { initialProps: initial });
}

describe('useAutoMode', () => {
  it('is off until turned on', () => {
    const hook = setup();
    expect(hook.result.current.on).toBe(false);
    act(() => hook.result.current.turnOn());
    expect(hook.result.current.on).toBe(true);
    act(() => hook.result.current.turnOff());
    expect(hook.result.current.on).toBe(false);
  });

  it.each([
    ['another workspace', scope({ workspace: 'wsp-b' })],
    ['another page', scope({ page: 'session-2' })],
    ['another chat', scope({ chat: 'chat-2' })],
    ['a chat the author picked or started', scope({ chatEpoch: 1 })],
  ])('turns off for %s, and stays off on the way back', (_label, next) => {
    const hook = setup();
    act(() => hook.result.current.turnOn());
    hook.rerender(next);
    expect(hook.result.current.on).toBe(false);
    hook.rerender(scope());
    expect(hook.result.current.on).toBe(false);
  });

  it('starts off again after a reload', () => {
    const first = setup();
    act(() => first.result.current.turnOn());
    first.unmount();
    expect(setup().result.current.on).toBe(false);
  });

  it('carries over when the first message of a new chat creates it', () => {
    const hook = setup();
    act(() => hook.result.current.turnOn());
    // Rendered before the selection catches up, and still on.
    act(() => hook.result.current.adoptChat('chat-1'));
    expect(hook.result.current.on).toBe(true);
    hook.rerender(scope({ chat: 'chat-1' }));
    expect(hook.result.current.on).toBe(true);
    // From then on it belongs to that chat.
    hook.rerender(scope({ chat: 'chat-2' }));
    expect(hook.result.current.on).toBe(false);
  });

  it('does not carry over to a chat other than the one created', () => {
    const hook = setup();
    act(() => hook.result.current.turnOn());
    act(() => hook.result.current.adoptChat('chat-1'));
    hook.rerender(scope({ chat: 'chat-9' }));
    expect(hook.result.current.on).toBe(false);
  });

  it('does not carry over from a chat that already had an id', () => {
    const hook = setup(scope({ chat: 'chat-1' }));
    act(() => hook.result.current.turnOn());
    act(() => hook.result.current.adoptChat('chat-2'));
    hook.rerender(scope({ chat: 'chat-2' }));
    expect(hook.result.current.on).toBe(false);
  });

  it('keeps the reason the server paused it for the message, until the next one', () => {
    const hook = setup();
    act(() => hook.result.current.turnOn());
    act(() => hook.result.current.notePolicy('review', 'web_research'));
    expect(hook.result.current.blocked).toBe('web_research');
    act(() => hook.result.current.startTurn());
    expect(hook.result.current.blocked).toBeNull();
    act(() => hook.result.current.notePolicy('auto', null));
    expect(hook.result.current.blocked).toBeNull();
  });

  it('ignores a run’s policy while Auto is off', () => {
    const hook = setup();
    act(() => hook.result.current.notePolicy('review', 'policy'));
    expect(hook.result.current.blocked).toBeNull();
  });
});

describe('autoStripMessage', () => {
  it('says what Auto does, or why it is paused', () => {
    expect(autoStripMessage(null)).toBe('Auto is on: edits apply without asking');
    expect(autoStripMessage('web_research')).toBe('Auto is paused: web research is on for this message');
    expect(autoStripMessage('policy')).toBe("Auto isn't available in this workspace");
    expect(autoStripMessage('role')).toBe("Viewers can't use Auto");
  });
});
