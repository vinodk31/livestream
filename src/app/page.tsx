import Link from "next/link";
import { Link2, MonitorSmartphone, ShieldCheck, Zap } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: Link2, title: "One link, instant viewing", body: "Viewers click and watch. No account, no app, no sign-up." },
  { icon: Zap, title: "Sub-second latency", body: "Real-time WebRTC delivery, so your audience reacts as it happens." },
  { icon: MonitorSmartphone, title: "Go live from anywhere", body: "Phone, laptop webcam, screen share, or OBS and hardware encoders." },
  { icon: ShieldCheck, title: "Private when you need it", body: "Public, unlisted, or passcode-protected streams. No ads, ever." },
];

export default function Home() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center px-4">
        <Logo />
        <nav className="ml-auto flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/register">Get started</Link>
          </Button>
        </nav>
      </header>
      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:py-28">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-live" aria-hidden /> Live streaming without the friction
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Go live. Share a link. That&apos;s it.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-pretty text-muted-foreground">
            Start a live stream from your browser in seconds. Anyone with the link can watch instantly on any
            device: no accounts, no downloads.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button size="lg" variant="live" asChild>
              <Link href="/register">Start streaming free</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">I have an account</Link>
            </Button>
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-24 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border bg-card p-6">
              <Icon className="mb-4 size-5" aria-hidden />
              <h2 className="font-medium">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-6 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} InstantLive</span>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
        </div>
      </footer>
    </div>
  );
}
