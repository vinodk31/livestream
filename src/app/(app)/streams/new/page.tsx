import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StreamForm } from "@/components/streams/stream-form";
import { createStreamAction } from "../actions";

export const metadata: Metadata = { title: "New stream" };

export default function NewStreamPage() {
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link href="/streams">
          <ArrowLeft aria-hidden /> My Streams
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Create a stream</CardTitle>
          <CardDescription>You&apos;ll get a link to share right away, and can go live whenever you&apos;re ready.</CardDescription>
        </CardHeader>
        <CardContent>
          <StreamForm mode="create" action={createStreamAction} />
        </CardContent>
      </Card>
    </div>
  );
}
