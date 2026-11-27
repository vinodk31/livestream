import { Ban, Globe, Link2, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status, disabled }: { status: "idle" | "live" | "ended"; disabled?: boolean }) {
  if (disabled) {
    return (
      <Badge variant="destructive">
        <Ban aria-hidden /> Disabled
      </Badge>
    );
  }
  if (status === "live") {
    return (
      <Badge variant="live">
        <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden /> LIVE
      </Badge>
    );
  }
  return <Badge variant="secondary">{status === "ended" ? "Ended" : "Ready"}</Badge>;
}

const PRIVACY = {
  public: { icon: Globe, label: "Public", hint: "Listed and visible to anyone" },
  unlisted: { icon: Link2, label: "Unlisted", hint: "Anyone with the link" },
  private: { icon: Lock, label: "Private", hint: "Link and passcode required" },
} as const;

export function PrivacyBadge({ privacy }: { privacy: keyof typeof PRIVACY }) {
  const { icon: Icon, label, hint } = PRIVACY[privacy];
  return (
    <Badge variant="outline" title={hint} className="text-muted-foreground">
      <Icon aria-hidden /> {label}
    </Badge>
  );
}
