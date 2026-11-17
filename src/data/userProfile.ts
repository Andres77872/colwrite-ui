import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type {
  AccountDeletionResponse,
  AccountIdentity,
  ActivityDay as WireActivityDay,
  PageActivity,
  ToolUsage as WireToolUsage,
  UpdateUserProfileRequest,
  UsageSummary as WireUsageSummary,
  UserMeResponse,
  UserProfileModel,
} from '@/api/schema';

/**
 * The person (`/users/me`): the identity the session boot reads, and the
 * profile ColWrite stores itself. Usage is per workspace
 * (`workspaceUsageQuery` in `./workspaces`).
 *
 * Nothing here is a credential: the identity echoes the session the API
 * already validated. Username, email and password are owned by the auth
 * service, so they are absent from the profile update.
 */

export type UserIdentity = AccountIdentity;
export type UserProfile = UserProfileModel;
export type UserMe = UserMeResponse;
export type UsageSummary = WireUsageSummary;
/** One day of activity. Days with none are absent from the series. */
export type ActivityDay = WireActivityDay;
export type ToolUsage = WireToolUsage;
/** One page's recorded activity in the workspace. `id` is what `switchTo` accepts. */
export type UserDocument = PageActivity;
export type ProfileUpdate = UpdateUserProfileRequest;

/** The signed-in person: identity and profile. */
export async function getMe(init?: { signal?: AbortSignal }): Promise<UserMe> {
  return unwrap(api.GET('/users/me', { signal: init?.signal }));
}

/** Update the application-owned profile. Absent fields are left alone. */
export async function updateProfile(changes: ProfileUpdate): Promise<UserMe> {
  return unwrap(api.PATCH('/users/me', { body: changes }));
}

/**
 * Delete the account (`DELETE /users/me`), with its username typed exactly.
 * While a live shared workspace has it as its only owner, it is 409
 * `sole_owner` with those `workspace_ids`, and nothing changes. Otherwise the
 * personal workspace is purged, the account leaves every other workspace,
 * and the session ends: the server signs it out and clears both cookies.
 */
export async function deleteAccount(confirmUsername: string): Promise<AccountDeletionResponse> {
  return unwrap(api.DELETE('/users/me', { params: { query: { confirm_username: confirmUsername } } }));
}

/* An uploaded PDF is a resource: list, upload and delete it through `./resources`. */

export const userKeys = {
  /** Settings' Account pane. The person's, not one workspace's. */
  me: () => ['users', 'me'] as const,
};

export function meQuery() {
  return queryOptions({
    queryKey: userKeys.me(),
    queryFn: ({ signal }) => getMe({ signal }),
  });
}

/** Save the application-owned profile; the Account pane shows the saved one. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: ProfileUpdate) => updateProfile(changes),
    onSuccess: (me) => queryClient.setQueryData(userKeys.me(), me),
  });
}
