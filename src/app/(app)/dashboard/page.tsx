import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, CircleCheck, Clock, Eye, Plus, Radio, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StreamRow } from "@/components/streams/stream-row";
import { formatCount, formatDuration } from "@/lib/format";
import { PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { sweepHostStale } from "@/server/streams/broadcast";
import { getDashboardStats, listStreams } from "@/server/streams/queries";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const [user, params] = await Promise.all([requireUser("/dashboard"), searchParams]);
  await sweepHostStale(user.id, { ip: null, userAgent: null });
  const now = new Date();
  const [stats, recent] = await Promise.all([
    getDashboardStats(user.id, now),
    listStreams(user.id, { pageSize: 5 }),
  ]);
  const plan = PLANS[user.plan];
  const hoursUsed = stats.streamedSecondsThisMonth / 3600;
  const hasEverGoneLive = recent.items.some((s) => s.lastLiveAt != null);

  const steps = [
    { done: user.emailVerified, label: "Verify your email", hint: "Use the code in the banner above." },
    { done: stats.totalStreams > 0, label: "Create your first stream", hint: "Give it a title and choose who can watch." },
    { done: hasEverGoneLive, label: "Go live and share the link", hint: "Viewers just click. No sign-up." },
  ];
  const showChecklist = steps.some((s) => !s.done);

  return (
    <div className="grid gap-6">
      {params.verified === "1" && (
        <Alert variant="success">
          <CircleCheck />
          <AlertDescription>Your email is verified. You&apos;re ready to go live.</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {params.welcome === "1" ? "Welcome" : "Welcome back"}, {user.name.split(" ")[0]}
          </h1>
          <p className="text-muted-foreground">Here&apos;s how your streams are doing.</p>
        </div>
        <Button asChild>
          <Link href="/streams/new">
            <Plus aria-hidden /> New stream
          </Link>
        </Button>
      </div>

      {showChecklist && (
        <Card>
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>Three steps to your first live stream.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-3 sm:grid-cols-3">
              {steps.map((step, i) => (
                <li key={step.label} className={cn("flex gap-3 rounded-lg border p-3", step.done && "bg-muted/50")}>
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                      step.done && "border-success bg-success text-white",
                    )}
                    aria-hidden
                  >
                    {step.done ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <div>
                    <p className={cn("text-sm font-medium", step.done && "text-muted-foreground line-through")}>
                      {step.label}
                      <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
                    </p>
                    {!step.done && <p className="text-xs text-muted-foreground">{step.hint}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <section aria-label="Last 30 days" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Radio} label="Live now" value={String(stats.liveNow)} hint={`${stats.totalStreams} streams total`} live={stats.liveNow > 0} />
        <StatCard icon={Eye} label="Views" value={formatCount(stats.views30d)} hint="Last 30 days" />
        <StatCard icon={Clock} label="Watch time" value={formatDuration(stats.watchSeconds30d)} hint="Last 30 days" />
        <StatCard icon={Users} label="Peak viewers" value={formatCount(stats.peakViewers30d)} hint="Last 30 days" />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent streams</CardTitle>
            <CardDescription>Your latest activity.</CardDescription>
            {recent.total > 0 && (
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/streams">
                    View all <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {recent.items.length ? (
              <ul className="-mx-3 grid gap-1">
                {recent.items.map((s) => (
                  <StreamRow key={s.id} stream={s} now={now} />
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
                <Radio className="size-6 text-muted-foreground" aria-hidden />
                <div>
                  <p className="font-medium">No streams yet</p>
                  <p className="text-sm text-muted-foreground">Create a stream to get a shareable link.</p>
                </div>
                <Button asChild size="sm">
                  <Link href="/streams/new">
                    <Plus aria-hidden /> Create stream
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{plan.name} plan</CardTitle>
            <CardDescription>Usage this month</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <div className="flex justify-between text-sm">
                <span>Streaming time</span>
                <span className="text-muted-foreground">
                  {formatDuration(stats.streamedSecondsThisMonth)} / {plan.monthlyStreamHours}h
                </span>
              </div>
              <Progress value={(hoursUsed / plan.monthlyStreamHours) * 100} label="Streaming time used this month" />
            </div>
            <div className="grid gap-2">
              <div className="flex justify-between text-sm">
                <span>Streams</span>
                <span className="text-muted-foreground">
                  {stats.totalStreams} / {plan.maxStreams}
                </span>
              </div>
              <Progress value={(stats.totalStreams / plan.maxStreams) * 100} label="Streams created" />
            </div>
            <ul className="grid gap-1 text-sm text-muted-foreground">
              <li>Up to {plan.maxConcurrentViewers} viewers at once</li>
              <li>Recordings kept {plan.recordingRetentionDays} days</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  live,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  live?: boolean;
}) {
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="px-5">
        <CardDescription className="flex items-center gap-2">
          <Icon className={cn("size-4", live && "text-live")} aria-hidden />
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <p className={cn("text-2xl font-semibold tabular-nums", live && "text-live")}>{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
