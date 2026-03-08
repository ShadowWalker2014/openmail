export type ApiVariables = {
  workspaceId: string;
  // Set by sessionAuth; NOT set by workspaceApiKeyAuth
  userId?: string;
  user?: { id: string; name: string; email: string };
};
