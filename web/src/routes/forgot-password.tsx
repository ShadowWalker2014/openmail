import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/auth-client";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setLoading(true);

    const email = emailRef.current!.value.trim();

    const { error } = await requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (error) {
      const msg = typeof error === "object" && "message" in error
        ? String(error.message)
        : "Something went wrong. Please try again.";
      setFieldError(msg);
      toast.error(msg);
      return;
    }

    setSent(true);
  }

  return (
    <div className="min-h-screen bg-[hsl(var(--app-bg))] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Back */}
        <div className="mb-8">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sign in
          </Link>
        </div>

        {/* Logo + heading */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg border bg-background">
            <Mail className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {sent ? "Check your email" : "Forgot password?"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {sent
              ? "We've sent a password reset link to your email."
              : "Enter your email and we'll send you a reset link."}
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg border bg-background p-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              If an account exists for{" "}
              <span className="font-medium text-foreground">
                {emailRef.current?.value}
              </span>
              , you'll receive a reset link shortly.
            </p>
            <p className="text-xs text-muted-foreground">
              Didn't get the email? Check your spam folder or{" "}
              <button
                type="button"
                onClick={() => setSent(false)}
                className="font-medium text-foreground hover:underline cursor-pointer"
              >
                try again
              </button>
              .
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-background p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  ref={emailRef}
                  type="email"
                  placeholder="you@company.com"
                  required
                  autoComplete="email"
                  autoFocus
                  onChange={() => setFieldError(null)}
                />
              </div>

              {fieldError && (
                <div className="animate-in fade-in slide-in-from-top-1 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive duration-150">
                  {fieldError}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
