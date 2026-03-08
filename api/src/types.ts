export type ApiVariables = {
  workspaceId: string;
  // Set by sessionAuth; NOT set by workspaceApiKeyAuth
  userId?: string;
  user?: { id: string; name: string; email: string };
  workspaceMember?: { id: string; workspaceId: string; userId: string; role: string; createdAt: Date };
};
