import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { emailSchema } from "@/lib/validation/auth";

export const metadata: Metadata = { title: "Reset password", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { email } = await searchParams;
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Reset your password</CardTitle>
          <CardDescription>Start by telling us which email to send a code to.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/forgot-password">Continue</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Check your email</CardTitle>
        <CardDescription>
          If an account exists for <span className="font-medium text-foreground">{parsed.data}</span>, we sent it a
          6-digit code. Enter it below with your new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm email={parsed.data} />
      </CardContent>
      <CardFooter className="justify-center text-sm">
        <Link
          href={`/forgot-password?email=${encodeURIComponent(parsed.data)}`}
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          Use a different email
        </Link>
      </CardFooter>
    </Card>
  );
}
