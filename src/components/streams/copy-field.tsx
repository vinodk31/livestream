"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Older browsers / insecure contexts: select the text so the user can copy manually.
      const el = document.getElementById("copy-field-input") as HTMLInputElement | null;
      el?.select();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="flex gap-2">
      <Input
        id="copy-field-input"
        value={value}
        readOnly
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="bg-muted/50 font-mono text-sm"
      />
      <Button type="button" variant="outline" onClick={copy} aria-live="polite" className="shrink-0">
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
      <Button type="button" variant="ghost" size="icon" asChild className="shrink-0">
        <a href={value} target="_blank" rel="noopener noreferrer" aria-label="Open viewer page in a new tab">
          <ExternalLink aria-hidden />
        </a>
      </Button>
    </div>
  );
}
