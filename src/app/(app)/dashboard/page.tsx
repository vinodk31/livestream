import type { Metadata } from "next";
import { CircleCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Dashboard" };

// Placeholder. The full dashboard (stats, recent streams, quick start) lands in module 3.
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const [user, params] = await Promise.all([requireUser("/dashboard"), searchParams]);
  return (
    <div className="grid gap-6">
      {params.verified === "1" && (
        <Alert variant="success">
          <CircleCheck />
          <AlertDescription>Your email is verified. You&apos;re ready to go live.</AlertDescription>
        </Alert>
      )}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {params.welcome === "1" ? "Welcome" : "Welcome back"}, {user.name.split(" ")[0]}
        </h1>
        <p className="text-muted-foreground">Here&apos;s what&apos;s happening with your streams.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Your streams will appear here</CardTitle>
          <CardDescription>Stream creation is coming in the next update.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
