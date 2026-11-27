import { AppHeader } from "@/components/app/app-header";
import { VerifyEmailBanner } from "@/components/app/verify-email-banner";
import { requireUser } from "@/server/auth/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <AppHeader user={user} />
      {!user.emailVerified && <VerifyEmailBanner email={user.email} />}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
