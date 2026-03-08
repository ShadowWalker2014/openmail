import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Mail, ArrowLeft, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "@/lib/auth-client";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);

    const newPassword = passwordRef.current!.value;
    const confirm = confirmRef.current!.value;

    if (newPassword !== confirm) {
      setFieldError("Passwords do not match.");
      return;
    }
    if (!token) {
      setFieldError("Invalid or missing reset token. Please request a new link.");
      return;
    }

    setLoading(true);
    const { error } = await resetPassword({ newPassword, token });
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
    setDone(true);
  }

  if (!token) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{ background: "hsl(var(--background))" }}
      >
        <div className="w-full max-w-[340px] text-center">
          <div className="mb-4 mx-auto flex h-8 w-8 items-center justify-center rounded-[7px] border border-border bg-muted">
            <Mail className="h-4 w-4 text-foreground/80" />
          </div>
          <h1 className="text-[15px] font-semibold tracking-tight mb-1.5">
            Invalid reset link
          </h1>
          <p className="text-[12px] text-muted-foreground mb-5">
            This password reset link is invalid or has expired.
          </p>
          <Link
            to="/forgot-password"
            className="text-[13px] text-foreground/70 hover:text-foreground transition-colors cursor-pointer"
          >
            Request a new link →
          </Link>
        </div>
      </div>
    );
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
            {done ? "Password updated" : "Set new password"}
          </h1>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {done
              ? "Your password has been changed successfully."
              : "Choose a strong password for your account."}
          </p>
        </div>

        {done ? (
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/12 border border-emerald-500/20">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="text-[13px] text-foreground/80">
                You can now sign in with your new password.
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => router.navigate({ to: "/login" })}
            >
              Go to sign in
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    ref={passwordRef}
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    autoFocus
                    className="pr-9"
                    onChange={() => setFieldError(null)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground/70 transition-colors cursor-pointer"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  At least 8 characters
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <div className="relative">
                  <Input
                    id="confirm"
                    ref={confirmRef}
                    type={showConfirm ? "text" : "password"}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="pr-9"
                    onChange={() => setFieldError(null)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground/70 transition-colors cursor-pointer"
                    tabIndex={-1}
                  >
                    {showConfirm ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {fieldError && (
                <div className="rounded-md border border-destructive/20 bg-destructive/8 px-3 py-2 text-[12px] text-destructive">
                  {fieldError}
                </div>
              )}

              <Button
                type="submit"
                className="w-full mt-1"
                disabled={loading}
              >
                {loading ? "Updating…" : "Update password"}
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
