import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Mail, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "@/lib/auth-client";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function getErrorMessage(error: unknown): string {
  if (!error) return "Something went wrong. Please try again.";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Something went wrong. Please try again.";
}

function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setLoading(true);

    const email = emailRef.current!.value.trim();
    const password = passwordRef.current!.value;

    if (mode === "login") {
      const { error } = await signIn.email({ email, password });
      if (error) {
        const msg = getErrorMessage(error);
        setFieldError(msg);
        toast.error(msg);
        setLoading(false);
        return;
      }
    } else {
      const name = nameRef.current!.value.trim();
      if (!name) {
        setFieldError("Name is required.");
        setLoading(false);
        return;
      }
      const { error } = await signUp.email({ email, password, name });
      if (error) {
        const msg = getErrorMessage(error);
        setFieldError(msg);
        toast.error(msg);
        setLoading(false);
        return;
      }
    }

    // Component unmounts after navigation — no need to reset loading state
    router.navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen bg-[hsl(var(--app-bg))] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Back */}
        <div className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to home
          </Link>
        </div>

        {/* Logo + heading */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg border bg-background">
            <Mail className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === "login" ? "Welcome back" : "Create account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "login"
              ? "Sign in to your OpenMail account"
              : "Get started with OpenMail"}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-lg border bg-background p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  ref={nameRef}
                  placeholder="Your name"
                  required
                  autoComplete="name"
                  onChange={() => setFieldError(null)}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                ref={emailRef}
                type="email"
                placeholder="you@company.com"
                required
                autoComplete="email"
                onChange={() => setFieldError(null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                ref={passwordRef}
                type="password"
                placeholder="••••••••"
                required
                minLength={8}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                onChange={() => setFieldError(null)}
              />
              {mode === "signup" && (
                <p className="text-xs text-muted-foreground">At least 8 characters</p>
              )}
            </div>

            {fieldError && (
              <div className="animate-in fade-in slide-in-from-top-1 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive duration-150">
                {fieldError}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? mode === "login"
                  ? "Signing in…"
                  : "Creating account…"
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>
        </div>

        {/* Toggle mode */}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setFieldError(null);
                }}
                className="font-medium text-foreground hover:underline cursor-pointer"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setFieldError(null);
                }}
                className="font-medium text-foreground hover:underline cursor-pointer"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
