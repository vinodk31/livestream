import { AppHeader } from "@/components/app/app-header";
import { VerifyEmailBanner } from "@/components/app/verify-email-banner";
import { requireUser } from "@/server/auth/session";
import { isTestLoginEnabled } from "@/server/auth/test-login";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      {isTestLoginEnabled() && (
        <div role="alert" className="bg-destructive px-4 py-1.5 text-center text-xs font-medium text-white">
          Test sign-in link is enabled. Remove TEST_LOGIN_KEY in Vercel before inviting real users.
        </div>
      )}
      <AppHeader user={user} />
      {!user.emailVerified && <VerifyEmailBanner email={user.email} />}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
