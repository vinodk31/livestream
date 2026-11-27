"use client";

import { useEffect, useRef, useState } from "react";
import { RoomEvent, type Participant, type Room } from "livekit-client";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ChatMessage = { id: string; name: string; text: string; ts: number; fromHost: boolean; self: boolean };

const TOPIC = "chat";
const MAX_LEN = 300;
const MAX_MESSAGES = 200;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function cleanName(name: unknown): string {
  return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 40) || "Guest" : "Guest";
}

/** Live chat over LiveKit data messages. Nothing is stored server-side. */
export function ChatPanel({
  room,
  canSend,
  selfName,
  isHost = false,
  className,
  dark = false,
}: {
  room: Room | null;
  canSend: boolean;
  selfName: string;
  isHost?: boolean;
  className?: string;
  dark?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!room) return;
    const onData = (payload: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
      if (topic !== TOPIC) return;
      try {
        const data = JSON.parse(decoder.decode(payload)) as { text?: unknown; name?: unknown };
        const text = typeof data.text === "string" ? data.text.trim() : "";
        if (!text) return;
        const fromHost = participant?.identity === "host";
        setMessages((m) =>
          [
            ...m,
            {
              id: crypto.randomUUID(),
              // Host name comes from the server-issued token, so it can't be impersonated.
              name: fromHost ? cleanName(participant?.name) : cleanName(data.name ?? participant?.name),
              text: text.slice(0, MAX_LEN),
              ts: Date.now(),
              fromHost,
              self: false,
            },
          ].slice(-MAX_MESSAGES),
        );
      } catch {
        // Ignore malformed messages.
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim().slice(0, MAX_LEN);
    if (!room || !text || cooldown) return;
    setDraft("");
    setCooldown(true);
    setTimeout(() => setCooldown(false), 1000);
    setMessages((m) =>
      [...m, { id: crypto.randomUUID(), name: selfName, text, ts: Date.now(), fromHost: isHost, self: true }].slice(-MAX_MESSAGES),
    );
    try {
      await room.localParticipant.publishData(encoder.encode(JSON.stringify({ text, name: selfName })), {
        reliable: true,
        topic: TOPIC,
      });
    } catch (err) {
      console.error("[chat] send failed", err);
    }
  }

  return (
    <section
      aria-label="Live chat"
      className={cn("flex min-h-0 flex-col rounded-xl border", dark ? "border-white/10 bg-white/5" : "bg-card", className)}
    >
      <h2 className={cn("border-b px-4 py-2.5 text-sm font-medium", dark && "border-white/10")}>Live chat</h2>
      <div ref={listRef} className="min-h-40 flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
        {messages.length === 0 ? (
          <p className={cn("text-center text-xs", dark ? "text-white/50" : "text-muted-foreground")}>
            {room ? "No messages yet. Say hi!" : "Chat opens when the stream is live."}
          </p>
        ) : (
          messages.map((m) => (
            <p key={m.id} className="break-words">
              <span className={cn("mr-1.5 font-semibold", m.fromHost && "text-live")}>
                {m.name}
                {m.fromHost && (
                  <span className="ml-1 rounded bg-live px-1 py-px text-[10px] font-bold text-white uppercase">Host</span>
                )}
              </span>
              <span className={dark ? "text-white/90" : undefined}>{m.text}</span>
            </p>
          ))
        )}
      </div>
      {canSend && (
        <form onSubmit={send} className={cn("flex gap-2 border-t p-2", dark && "border-white/10")}>
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <Input
            id="chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_LEN}
            placeholder={room ? "Send a message" : "Waiting for the stream…"}
            disabled={!room}
            autoComplete="off"
            className={cn(dark && "border-white/15 bg-white/10 text-white placeholder:text-white/40")}
          />
          <Button type="submit" size="icon" disabled={!room || !draft.trim() || cooldown} aria-label="Send">
            <Send aria-hidden />
          </Button>
        </form>
      )}
    </section>
  );
}
