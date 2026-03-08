import { createAuthClient } from "better-auth/react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001"; // pragma: allowlist secret

export const authClient = createAuthClient({
  baseURL: API_URL,
  // Better Auth default base path is /api/auth — matches our API server
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  requestPasswordReset,
  resetPassword,
} = authClient;
