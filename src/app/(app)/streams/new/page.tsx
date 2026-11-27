import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "New stream" };

// Placeholder: the create-stream form ships in module 4.
export default function NewStreamPage() {
  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <Button variant="ghost" size="sm" asChild className="w-fit">
        <Link href="/streams">
          <ArrowLeft aria-hidden /> My Streams
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Create a stream</CardTitle>
          <CardDescription>Stream creation is coming in the next update.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You&apos;ll be able to set a title, description, privacy (public, unlisted or passcode-protected) and a
          thumbnail, and get a shareable link and QR code.
        </CardContent>
      </Card>
    </div>
  );
}
