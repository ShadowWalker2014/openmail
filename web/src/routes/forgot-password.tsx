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
      const msg =
        typeof error === "object" && "message" in error
          ? String(error.message)
          : "Something went wrong. Please try again.";
      setFieldError(msg);
      toast.error(msg);
      return;
    }
    setSent(true);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "hsl(var(--background))" }}
    >
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute left-1/2 top-0 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-violet-600/6 blur-[90px]" />
      </div>

      <div className="relative w-full max-w-[340px]">
        <div className="mb-7">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to sign in
          </Link>
        </div>

        <div className="mb-6">
          <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-[7px] border border-border bg-muted">
            <Mail className="h-4 w-4 text-foreground/80" />
          </div>
          <h1 className="text-[15px] font-semibold tracking-tight text-foreground">
            {sent ? "Check your email" : "Forgot password?"}
          </h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {sent
              ? "We've sent a password reset link."
              : "Enter your email and we'll send you a reset link."}
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/12 border border-emerald-500/20">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="text-[13px] text-foreground/80">
                If{" "}
                <span className="font-medium text-foreground">
                  {emailRef.current?.value}
                </span>{" "}
                exists, you'll receive a link shortly.
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Didn't get it? Check spam or{" "}
              <button
                type="button"
                onClick={() => setSent(false)}
                className="text-foreground/70 hover:text-foreground transition-colors cursor-pointer"
              >
                try again
              </button>
              .
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-3.5">
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
                <div className="rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2 text-[12px] text-destructive">
                  {fieldError}
                </div>
              )}

              <Button type="submit" className="w-full mt-1" disabled={loading}>
                {loading ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
