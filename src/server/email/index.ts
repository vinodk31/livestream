import "server-only";
import { Resend } from "resend";
import { env } from "../env";

export type EmailMessage = { to: string; subject: string; html: string; text: string };

let client: Resend | null | undefined;

function resend(): Resend | null {
  if (client === undefined) {
    client = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  }
  return client;
}

/** Test hook: captures messages instead of sending. */
export const sentEmails: EmailMessage[] = [];

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    sentEmails.push(message);
    return;
  }
  const r = resend();
  if (!r) {
    if (env.isProd) {
      console.error("[email] RESEND_API_KEY is not set; email NOT sent:", message.subject);
      throw new Error("Email is not configured");
    } else {
      console.info(`\n[email:dev] To: ${message.to}\nSubject: ${message.subject}\n${message.text}\n`);
    }
    return;
  }
  const { error } = await r.emails.send({
    from: env.emailFrom,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  if (error) {
    console.error("[email] send failed", error);
    throw new Error("Failed to send email");
  }
}
