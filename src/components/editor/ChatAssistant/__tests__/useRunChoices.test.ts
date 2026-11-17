import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { catalogValue } from '@/components/preferences/assistantCatalogContextState';
import { catalogOf, PERSONAL_WORKSPACE_ID } from '@/dev/msw/fixtures';
import { useRunChoices } from '../useRunChoices';
import type { ConversationScope } from '../conversationScope';

const profile = catalogValue(catalogOf(PERSONAL_WORKSPACE_ID), false, null).profileEfforts('chat')!;
const scope = (over: Partial<ConversationScope> = {}): ConversationScope => ({
  workspace: 'w1', page: 'page-session', chat: null, chatEpoch: 0, ...over,
});
const setup = () => renderHook((value: ConversationScope) => useRunChoices(value, profile, true), { initialProps: scope() });

describe('conversation run choices', () => {
  it('uses the catalog’s default and offers exactly its profile tiers', () => {
    const hook = setup();
    expect(hook.result.current.effort).toBe(profile.defaultEffort);
    expect(hook.result.current.efforts).toEqual(profile.efforts);
    expect(hook.result.current.web).toBe(false);
    act(() => hook.result.current.setEffort('quick'));
    expect(hook.result.current.effort).toBe('quick');
  });

  it.each([
    scope({ workspace: 'w2' }), scope({ page: 'other-page' }),
    scope({ chat: 'c2' }), scope({ chatEpoch: 1 }),
  ])('resets when the conversation boundary changes to %j', (next) => {
    const hook = setup();
    act(() => { hook.result.current.setEffort('deep'); hook.result.current.setWeb(true); });
    hook.rerender(next);
    expect(hook.result.current.effort).toBe(profile.defaultEffort);
    expect(hook.result.current.web).toBe(false);
    hook.rerender(scope());
    expect(hook.result.current.effort).toBe(profile.defaultEffort);
  });

  it('adopts the chat created by the first turn, but not a different chat', () => {
    const hook = setup();
    act(() => { hook.result.current.setEffort('quick'); hook.result.current.setWeb(true); hook.result.current.adoptChat('created'); });
    hook.rerender(scope({ chat: 'created' }));
    expect(hook.result.current.effort).toBe('quick');
    expect(hook.result.current.web).toBe(true);
    hook.rerender(scope({ chat: 'another' }));
    expect(hook.result.current.effort).toBe(profile.defaultEffort);
    expect(hook.result.current.web).toBe(false);
  });

  it('keeps no choice across a remount', () => {
    const hook = setup();
    act(() => { hook.result.current.setEffort('deep'); hook.result.current.setWeb(true); });
    hook.unmount();
    expect(setup().result.current.effort).toBe(profile.defaultEffort);
    expect(setup().result.current.web).toBe(false);
  });

  it('clears Web when the catalog removes it and never silently re-enables it', () => {
    const hook = renderHook((available) => useRunChoices(scope(), profile, available), { initialProps: true });
    act(() => hook.result.current.setWeb(true));
    expect(hook.result.current.web).toBe(true);
    hook.rerender(false);
    expect(hook.result.current.web).toBe(false);
    act(() => hook.result.current.setWeb(true));
    expect(hook.result.current.web).toBe(false);
    hook.rerender(true);
    expect(hook.result.current.web).toBe(false);
  });

  it('offers nothing without a catalog and never selects a tier outside the profile', () => {
    const closed = renderHook(() => useRunChoices(scope(), undefined));
    expect(closed.result.current.effort).toBeUndefined();
    expect(closed.result.current.efforts).toEqual([]);
    act(() => closed.result.current.setEffort('deep'));
    expect(closed.result.current.effort).toBeUndefined();
    const quick = { efforts: profile.efforts.filter((row) => row.id === 'quick'), defaultEffort: 'quick' as const };
    const hook = renderHook((value) => useRunChoices(scope(), value), { initialProps: profile });
    act(() => hook.result.current.setEffort('deep'));
    hook.rerender(quick);
    expect(hook.result.current.effort).toBe('quick');
    act(() => hook.result.current.setEffort('deep'));
    expect(hook.result.current.effort).toBe('quick');
    hook.rerender(profile);
    expect(hook.result.current.effort).toBe(profile.defaultEffort);
  });
});
