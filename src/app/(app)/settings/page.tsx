import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChangePasswordForm,
  DeleteAccountForm,
  ProfileForm,
  RevokeSessionsForm,
} from "@/components/settings/settings-forms";
import { PLANS } from "@/lib/plans";
import { countActiveSessions } from "@/server/account/service";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  const activeSessions = await countActiveSessions(user.id);
  const plan = PLANS[user.plan];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and security.</p>
      </div>

      <Card id="profile">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your name is shown to viewers on your streams.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm name={user.name} email={user.email} />
        </CardContent>
      </Card>

      <Card id="password">
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Changing it signs you out everywhere except here.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card id="sessions">
        <CardHeader>
          <CardTitle>Devices</CardTitle>
          <CardDescription>Signed in somewhere you don&apos;t recognise? Sign out everywhere else.</CardDescription>
        </CardHeader>
        <CardContent>
          <RevokeSessionsForm otherDevices={Math.max(0, activeSessions - 1)} />
        </CardContent>
      </Card>

      <Card id="plan">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Plan <Badge variant="secondary">{plan.name}</Badge>
          </CardTitle>
          <CardDescription>Paid plans are coming soon.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            <li>{plan.monthlyStreamHours} streaming hours per month</li>
            <li>Up to {plan.maxConcurrentViewers} viewers at once</li>
            <li>Up to {plan.maxStreams} streams</li>
            <li>Recordings kept {plan.recordingRetentionDays} days</li>
          </ul>
        </CardContent>
      </Card>

      <Card id="delete" className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Delete account</CardTitle>
          <CardDescription>
            Permanently deletes your account, streams, recordings and stats. This can&apos;t be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccountForm email={user.email} />
        </CardContent>
      </Card>
    </div>
  );
}
