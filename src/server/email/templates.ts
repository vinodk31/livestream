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

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#171717;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${escapeHtml(label)}</a></p>
<p style="font-size:13px;color:#525252">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(href)}</span></p>`;
}

export function verifyEmailMessage(to: string, name: string, link: string): EmailMessage {
  return {
    to,
    subject: "Verify your email for InstantLive",
    html: layout(
      "Confirm your email",
      `<p>Hi ${escapeHtml(name)}, confirm your email address to start going live.</p>${button(link, "Verify email")}<p style="font-size:13px;color:#525252">This link expires in 24 hours.</p>`,
    ),
    text: `Hi ${name},\n\nConfirm your email to start going live:\n${link}\n\nThis link expires in 24 hours.`,
  };
}

export function resetPasswordMessage(to: string, name: string, link: string): EmailMessage {
  return {
    to,
    subject: "Reset your InstantLive password",
    html: layout(
      "Reset your password",
      `<p>Hi ${escapeHtml(name)}, we received a request to reset your password.</p>${button(link, "Choose a new password")}<p style="font-size:13px;color:#525252">This link expires in 1 hour. If you didn't ask for this, you can ignore this email.</p>`,
    ),
    text: `Hi ${name},\n\nReset your password here:\n${link}\n\nThis link expires in 1 hour. If you didn't ask for this, ignore this email.`,
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
