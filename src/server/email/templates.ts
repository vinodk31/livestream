import type { EmailMessage } from "./index";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171717">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:12px;padding:32px">
<tr><td>
<p style="margin:0 0 24px;font-weight:700;font-size:18px">● InstantLive</p>
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>
${bodyHtml}
</td></tr></table>
<p style="color:#737373;font-size:12px;margin-top:16px">You received this because of activity on your InstantLive account.</p>
</td></tr></table></body></html>`;
}

function codeBlock(code: string): string {
  return `<p style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(code)}</p>`;
}

export function verifyEmailMessage(to: string, name: string, code: string): EmailMessage {
  return {
    to,
    subject: `${code} is your InstantLive verification code`,
    html: layout(
      "Confirm your email",
      `<p>Hi ${escapeHtml(name)}, enter this code in InstantLive to confirm your email:</p>${codeBlock(code)}<p style="font-size:13px;color:#525252">The code expires in 15 minutes. If you didn't sign up, you can ignore this email.</p>`,
    ),
    text: `Hi ${name},\n\nYour InstantLive verification code is: ${code}\n\nIt expires in 15 minutes. If you didn't sign up, ignore this email.`,
  };
}

export function resetPasswordMessage(to: string, name: string, code: string): EmailMessage {
  return {
    to,
    subject: `${code} is your InstantLive password reset code`,
    html: layout(
      "Reset your password",
      `<p>Hi ${escapeHtml(name)}, enter this code in InstantLive to choose a new password:</p>${codeBlock(code)}<p style="font-size:13px;color:#525252">The code expires in 15 minutes. If you didn't ask for this, you can ignore this email: your password won't change.</p>`,
    ),
    text: `Hi ${name},\n\nYour InstantLive password reset code is: ${code}\n\nIt expires in 15 minutes. If you didn't ask for this, ignore this email.`,
  };
}

export function passwordChangedMessage(to: string, name: string): EmailMessage {
  return {
    to,
    subject: "Your InstantLive password was changed",
    html: layout(
      "Password changed",
      `<p>Hi ${escapeHtml(name)}, your password was just changed and all other sessions were signed out.</p><p>If this wasn't you, reset your password immediately.</p>`,
    ),
    text: `Hi ${name},\n\nYour password was just changed and all other sessions were signed out. If this wasn't you, reset your password immediately.`,
  };
}
