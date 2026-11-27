import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy Policy" };

// TODO(before launch): replace with your lawyer-reviewed Privacy Policy.
export default function Page() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">← Home</Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-4 text-muted-foreground">
        This page is a placeholder. Publish your final Privacy Policy here before opening InstantLive to the public.
      </p>
    </main>
  );
}
