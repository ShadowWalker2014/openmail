/**
 * Platform transactional mailer — used for system emails sent by OpenMail itself:
 * invite emails, password resets, etc.
 *
 * This is separate from workspace-level campaign emails (which use each
 * workspace's own Resend key configured in Settings → Email Sending).
 *
 * Required env vars:
 *   RESEND_API_KEY       — Resend API key (get one at resend.com)
 *   PLATFORM_FROM_EMAIL  — Verified sender address (e.g. noreply@yourdomain.com)
 *   PLATFORM_FROM_NAME   — Sender display name (e.g. "OpenMail")  [optional]
 */

import { getResend } from "./resend.js";

function platformFrom(): string {
  const email = process.env.PLATFORM_FROM_EMAIL ?? process.env.DEFAULT_FROM_EMAIL ?? "noreply@openmail.dev";
  const name  = process.env.PLATFORM_FROM_NAME  ?? process.env.DEFAULT_FROM_NAME  ?? "OpenMail";
  return `${name} <${email}>`;
}

export async function sendPasswordResetEmail({ to, resetUrl }: { to: string; resetUrl: string }) {
  const resend = getResend();
  if (!resend) throw new Error("RESEND_API_KEY is not configured — cannot send email");
  await resend.emails.send({
    from:    platformFrom(),
    to,
    subject: "Reset your OpenMail password",
    html:    buildPasswordResetHtml({ url: resetUrl, email: to }),
  });
}

export async function sendWorkspaceInviteEmail({
  to,
  inviteUrl,
  workspaceName,
  role,
}: {
  to: string;
  inviteUrl: string;
  workspaceName: string;
  role: string;
}) {
  const resend = getResend();
  if (!resend) throw new Error("RESEND_API_KEY is not configured — cannot send email");
  await resend.emails.send({
    from:    platformFrom(),
    to,
    subject: `You've been invited to join ${workspaceName} on OpenMail`,
    html:    buildInviteHtml({ workspaceName, inviteUrl, role, email: to }),
  });
}

// ── HTML templates ────────────────────────────────────────────────────────────

const BASE_CSS = `
  body { margin:0; padding:0; background:#f5f5f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .wrapper { max-width:520px; margin:40px auto; background:#fff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb; }
  .header { background:#08080a; padding:28px 40px; }
  .logo { color:#fff; font-size:15px; font-weight:600; letter-spacing:-0.02em; text-decoration:none; }
  .body { padding:36px 40px; }
  h1 { margin:0 0 12px; font-size:21px; font-weight:600; color:#111827; letter-spacing:-0.02em; }
  p { margin:0 0 18px; font-size:14px; line-height:1.6; color:#6b7280; }
  .highlight { color:#374151; font-weight:500; }
  .btn { display:inline-block; background:#111827; color:#fff; text-decoration:none; padding:11px 24px; border-radius:8px; font-size:13px; font-weight:600; }
  .btn-violet { background:#7c3aed; }
  hr { border:none; border-top:1px solid #f3f4f6; margin:24px 0; }
  .footer { padding:0 40px 28px; }
  .footer p { font-size:12px; color:#9ca3af; margin:0 0 6px; }
  .link { color:#6366f1; text-decoration:none; word-break:break-all; font-size:12px; }
  .meta { font-size:12px; color:#9ca3af; margin-top:4px; }
  .badge { display:inline-block; background:#f3f4f6; border:1px solid #e5e7eb; border-radius:4px; padding:2px 8px; font-size:11px; font-weight:500; color:#374151; text-transform:capitalize; }
`;

function buildPasswordResetHtml({ url, email }: { url: string; email: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Reset your password</title><style>${BASE_CSS}</style></head>
<body>
  <div class="wrapper">
    <div class="header"><a href="https://openmail.win" class="logo">OpenMail</a></div>
    <div class="body">
      <h1>Reset your password</h1>
      <p>We received a request to reset the password for <span class="highlight">${email}</span>.
         Click the button below to choose a new password.</p>
      <a href="${url}" class="btn">Reset password</a>
      <hr>
    </div>
    <div class="footer">
      <p>If the button doesn't work, copy and paste this link:</p>
      <a href="${url}" class="link">${url}</a>
      <p class="meta">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.</p>
    </div>
  </div>
</body></html>`;
}

function buildInviteHtml({
  workspaceName, inviteUrl, role, email,
}: { workspaceName: string; inviteUrl: string; role: string; email: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>You're invited</title><style>${BASE_CSS}</style></head>
<body>
  <div class="wrapper">
    <div class="header"><a href="https://openmail.win" class="logo">OpenMail</a></div>
    <div class="body">
      <h1>You've been invited</h1>
      <p>You've been invited to join <span class="highlight">${workspaceName}</span> on OpenMail
         as a <span class="badge">${role}</span>.</p>
      <p>Click below to accept the invitation and start collaborating.</p>
      <a href="${inviteUrl}" class="btn btn-violet">Accept invitation</a>
      <hr>
    </div>
    <div class="footer">
      <p>This invitation was sent to <span class="highlight">${email}</span>.</p>
      <p>If the button doesn't work, copy and paste this link:</p>
      <a href="${inviteUrl}" class="link">${inviteUrl}</a>
      <p class="meta">This invitation expires in 7 days. If you weren't expecting this, you can ignore it.</p>
    </div>
  </div>
</body></html>`;
}
