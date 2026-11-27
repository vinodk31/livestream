import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Service" };

// TODO(before launch): replace with your lawyer-reviewed Terms of Service.
export default function Page() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">← Home</Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-4 text-muted-foreground">
        This page is a placeholder. Publish your final Terms of Service here before opening InstantLive to the public.
      </p>
    </main>
  );
}
