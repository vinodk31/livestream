import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";
import { safeRedirectPath } from "@/lib/utils";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeRedirectPath(params.next) : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Welcome back. Sign in to manage your streams.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {params.reset === "1" && (
          <Alert variant="success">
            <CircleCheck />
            <AlertDescription>Your password was changed. Sign in with your new password.</AlertDescription>
          </Alert>
        )}
        {params.verify === "invalid" && (
          <Alert variant="destructive">
            <AlertDescription>
              That verification link is invalid or has expired. Sign in to request a new one.
            </AlertDescription>
          </Alert>
        )}
        <LoginForm next={next} />
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        New to InstantLive?&nbsp;
        <Link href="/register" className="font-medium text-foreground underline-offset-4 hover:underline">
          Create an account
        </Link>
      </CardFooter>
    </Card>
  );
}
