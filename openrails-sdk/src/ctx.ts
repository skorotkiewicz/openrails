/** Standalone clients have no worker invocation identity. Authorize users in your app. */
export const ctx = {
  user: null,
  trigger: 'http' as const,
  invocationId: 'local',
};
