import { describe, it, expect } from 'vitest';
import { jsonOf, pathOf, recordRequests } from '@/__tests__/server';
import { TEST_WORKSPACE_ID } from '@/__tests__/workspace';
import { getMe, updateProfile } from '../userProfile';
import { getWorkspaceUsage } from '../workspaces';

describe('the person', () => {
  it('reads the identity and the profile from /users/me', async () => {
    const sent = recordRequests();

    const read = await getMe();

    expect(pathOf(sent[0])).toBe('/api/users/me');
    expect(read.identity).toMatchObject({ username: 'Ada Author', email: 'ada@example.org' });
    expect(read.profile.headline).toBe('PhD student, efficient ML');
  });
});

describe('workspace usage', () => {
  it('requests the workspace’s usage with the day window', async () => {
    const sent = recordRequests();

    const usage = await getWorkspaceUsage(TEST_WORKSPACE_ID, 14);

    expect(pathOf(sent[0])).toBe(`/api/workspaces/${TEST_WORKSPACE_ID}/usage?days=14`);
    expect(usage.activity).toHaveLength(14);
    expect(usage.pages.length).toBeGreaterThan(0);
  });
});

describe('profile update', () => {
  it('PATCHes only the supplied fields as JSON', async () => {
    const sent = recordRequests();

    await updateProfile({ display_name: 'Ada', bio: '' });

    expect(pathOf(sent[0])).toBe('/api/users/me');
    expect(sent[0]?.method).toBe('PATCH');
    // An empty string is meaningful — it is how a field is cleared — so it
    // must survive serialisation rather than being dropped as falsy.
    expect(await jsonOf(sent[0])).toEqual({
      display_name: 'Ada',
      bio: '',
    });
  });

  it('sends the session cookie', async () => {
    const sent = recordRequests();

    await updateProfile({ headline: 'Researcher' });

    expect(sent[0]?.credentials).toBe('include');
  });
});
