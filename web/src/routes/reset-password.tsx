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
      setFieldError("Invalid or missing reset token. Please request a new reset link.");
      return;
    }

    setLoading(true);

    const { error } = await resetPassword({ newPassword, token });

    setLoading(false);

    if (error) {
      const msg = typeof error === "object" && "message" in error
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
      <div className="min-h-screen bg-[hsl(var(--app-bg))] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mb-4 mx-auto flex h-10 w-10 items-center justify-center rounded-lg border bg-background">
            <Mail className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight mb-2">Invalid reset link</h1>
          <p className="text-sm text-muted-foreground mb-6">
            This password reset link is invalid or has expired.
          </p>
          <Link
            to="/forgot-password"
            className="text-sm font-medium text-foreground hover:underline cursor-pointer"
          >
            Request a new reset link
          </Link>
        </div>
      </div>
    );
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
            {done ? "Password updated" : "Set new password"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {done
              ? "Your password has been changed successfully."
              : "Choose a strong password for your account."}
          </p>
        </div>

        {done ? (
          <div className="rounded-lg border bg-background p-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              You can now sign in with your new password.
            </p>
            <Button
              className="w-full"
              onClick={() => router.navigate({ to: "/login" })}
            >
              Go to sign in
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border bg-background p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
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
                    className="pr-10"
                    onChange={() => setFieldError(null)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">At least 8 characters</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm new password</Label>
                <div className="relative">
                  <Input
                    id="confirm"
                    ref={confirmRef}
                    type={showConfirm ? "text" : "password"}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="pr-10"
                    onChange={() => setFieldError(null)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    tabIndex={-1}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {fieldError && (
                <div className="animate-in fade-in slide-in-from-top-1 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive duration-150">
                  {fieldError}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Updating…" : "Update password"}
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
