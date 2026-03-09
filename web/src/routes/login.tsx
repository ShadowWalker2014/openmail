import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { LogoIcon } from "@/components/logo-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp, useSession } from "@/lib/auth-client";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function getErrorMessage(error: unknown): string {
  if (!error) return "Something went wrong. Please try again.";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error)
    return String((error as { message: unknown }).message);
  return "Something went wrong. Please try again.";
}

function LoginPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isPending && session) router.navigate({ to: "/dashboard" });
  }, [session, isPending, router]);

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
      // session update from signIn propagates to useSession → the useEffect
      // above handles the redirect once isPending settles with a valid session
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
      // same — let session watcher handle navigation
    }
  }

  if (!isPending && session) return null;
  // Keep showing the form while loading (covers the "signed in, awaiting session" gap)

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "hsl(var(--background))" }}
    >
      {/* Subtle ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute left-1/2 top-0 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-violet-600/6 blur-[90px]" />
      </div>

      <div className="relative w-full max-w-[340px]">
        {/* Back */}
        <div className="mb-7">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to home
          </Link>
        </div>

        {/* Logo + heading */}
        <div className="mb-6">
          <LogoIcon size={32} className="mb-4 rounded-[7px]" />
          <h1 className="text-[15px] font-semibold tracking-tight text-foreground">
            {mode === "login" ? "Welcome back" : "Create account"}
          </h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {mode === "login"
              ? "Sign in to your OpenMail account"
              : "Get started with OpenMail"}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-3.5">
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
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "login" && (
                  <Link
                    to="/forgot-password"
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <Input
                id="password"
                ref={passwordRef}
                type="password"
                placeholder="••••••••"
                required
                minLength={8}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                onChange={() => setFieldError(null)}
              />
              {mode === "signup" && (
                <p className="text-[11px] text-muted-foreground">
                  At least 8 characters
                </p>
              )}
            </div>

            {fieldError && (
              <div className="animate-in fade-in slide-in-from-top-1 rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2 text-[12px] text-destructive duration-150">
                {fieldError}
              </div>
            )}

            <Button
              type="submit"
              className="w-full mt-1"
              disabled={loading}
            >
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
        <p className="mt-4 text-center text-[12px] text-muted-foreground">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => { setMode("signup"); setFieldError(null); }}
                className="text-foreground/80 hover:text-foreground cursor-pointer transition-colors"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => { setMode("login"); setFieldError(null); }}
                className="text-foreground/80 hover:text-foreground cursor-pointer transition-colors"
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
