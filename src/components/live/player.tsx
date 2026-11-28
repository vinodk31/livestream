"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DisconnectReason, Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { Eye, Loader2, Maximize, Radio, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatPanel } from "./chat-panel";

type Status = "idle" | "live" | "ended" | "locked";
type Phase = "waiting" | "joining" | "watching" | "reconnecting" | "ended" | "full" | "error";

export type PlayerProps = {
  slug: string;
  initialStatus: Status;
  title: string;
  hostName: string;
  thumbnailUrl: string | null;
  chatEnabled: boolean;
  /** Latest recording, shown when the stream has ended. */
  replay?: { url: string; recordedAt: string } | null;
};

const NAME_KEY = "il_viewer_name";

function viewerName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
    const generated = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(NAME_KEY, generated);
    return generated;
  } catch {
    return "Guest";
  }
}

export function Player({ slug, initialStatus, title, hostName, thumbnailUrl, chatEnabled, replay }: PlayerProps) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [phase, setPhase] = useState<Phase>(initialStatus === "ended" ? "ended" : "waiting");
  const [room, setRoom] = useState<Room | null>(null);
  const [videoTrack, setVideoTrack] = useState<RemoteTrack | null>(null);
  const [muted, setMuted] = useState(true);
  const [viewers, setViewers] = useState(0);
  const [canChat, setCanChat] = useState(false);
  // Rendered client-only (see loaders.tsx), so reading localStorage here is safe.
  const [name] = useState(viewerName);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoEl = useRef<HTMLVideoElement>(null);
  const audioEls = useRef(new Map<string, HTMLMediaElement>());
  const stageRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const pingRef = useRef<{ viewerId: string; pingKey: string } | null>(null);
  const mutedRef = useRef(true);
  const joiningRef = useRef(false);
  const unmountedRef = useRef(false);


  // ----- Poll status while not watching -----
  useEffect(() => {
    if (phase === "watching" || phase === "joining" || phase === "reconnecting") return;
    if (status === "live" && phase === "waiting") return; // join effect handles it
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/public/watch/${slug}/state`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { status: Status };
        if (stopped) return;
        setStatus(body.status);
        if (body.status === "live" && (phase === "ended" || phase === "waiting" || phase === "full" || phase === "error")) {
          setPhase("waiting");
        }
      } catch {
        // Offline: try again next tick.
      }
    };
    const id = setInterval(poll, phase === "full" ? 10_000 : 5_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [phase, status, slug]);

  const countViewers = useCallback((r: Room) => {
    let n = 1; // me
    r.remoteParticipants.forEach((p) => {
      if (p.identity.startsWith("v_")) n++;
    });
    setViewers(n);
  }, []);

  const pickVideo = useCallback((r: Room) => {
    // Prefer a screen share, then the host camera, then OBS.
    let best: RemoteTrack | null = null;
    let bestRank = 99;
    r.remoteParticipants.forEach((p) => {
      p.trackPublications.forEach((pub) => {
        if (pub.kind !== Track.Kind.Video || !pub.track) return;
        const rank = pub.source === Track.Source.ScreenShare ? 0 : pub.source === Track.Source.Camera ? 1 : 2;
        if (rank < bestRank) {
          best = pub.track as RemoteTrack;
          bestRank = rank;
        }
      });
    });
    setVideoTrack(best);
  }, []);

  // ----- Join when live -----
  useEffect(() => {
    if (status !== "live" || phase !== "waiting" || joiningRef.current) return;
    // A ref, not effect cleanup, guards the in-flight join: setting "joining" re-runs this effect.
    joiningRef.current = true;
    const cancelled = () => unmountedRef.current;
    setPhase("joining");
    (async () => {
      try {
        const res = await fetch(`/api/public/watch/${slug}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: viewerName() }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          wsUrl?: string;
          token?: string;
          viewerId?: string;
          pingKey?: string;
          chatEnabled?: boolean;
          error?: string;
          message?: string;
        };
        if (cancelled()) return;
        if (!res.ok || !body.wsUrl || !body.token) {
          if (body.error === "full") return setPhase("full");
          if (body.error === "not_live") {
            setStatus("idle");
            return setPhase("waiting");
          }
          if (body.error === "locked") return window.location.reload();
          setErrorMsg(body.message ?? "Couldn't load the stream.");
          return setPhase("error");
        }
        pingRef.current = { viewerId: body.viewerId!, pingKey: body.pingKey! };
        setCanChat(!!body.chatEnabled);

        const r = new Room({ adaptiveStream: true, dynacast: true });
        r.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.muted = mutedRef.current;
            audioEls.current.set(track.sid ?? String(audioEls.current.size), el);
            document.body.appendChild(el);
          }
          pickVideo(r);
        });
        r.on(RoomEvent.TrackUnsubscribed, (track) => {
          if (track.kind === Track.Kind.Audio) {
            track.detach().forEach((el) => el.remove());
            audioEls.current.delete(track.sid ?? "");
          }
          pickVideo(r);
        });
        r.on(RoomEvent.ParticipantConnected, () => countViewers(r));
        r.on(RoomEvent.ParticipantDisconnected, () => {
          countViewers(r);
          pickVideo(r);
        });
        r.on(RoomEvent.Reconnecting, () => setPhase("reconnecting"));
        r.on(RoomEvent.Reconnected, () => setPhase("watching"));
        r.on(RoomEvent.Disconnected, (reason) => {
          audioEls.current.forEach((el) => el.remove());
          audioEls.current.clear();
          roomRef.current = null;
          setRoom(null);
          setVideoTrack(null);
          if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED) {
            setStatus("ended");
            setPhase("ended");
          } else {
            // Network trouble: go back to polling and rejoin if still live.
            setPhase("waiting");
            setStatus("idle");
          }
        });
        await r.connect(body.wsUrl, body.token);
        if (cancelled()) {
          r.disconnect();
          return;
        }
        roomRef.current = r;
        setRoom(r);
        countViewers(r);
        pickVideo(r);
        setPhase("watching");
      } catch (err) {
        if (cancelled()) return;
        console.error("[player] join failed", err);
        setErrorMsg("Couldn't connect to the stream. Check your connection and try again.");
        setPhase("error");
      } finally {
        joiningRef.current = false;
      }
    })();
  }, [status, phase, slug, pickVideo, countViewers]);

  // ----- Attach video -----
  useEffect(() => {
    const el = videoEl.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack]);

  // ----- Watch-time pings -----
  useEffect(() => {
    if (phase !== "watching") return;
    const ping = () => {
      const p = pingRef.current;
      if (!p) return;
      void fetch("/api/public/viewer/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
        keepalive: true,
      }).catch(() => {});
    };
    const id = setInterval(ping, 30_000);
    return () => {
      clearInterval(id);
      ping();
    };
  }, [phase]);

  useEffect(() => {
    unmountedRef.current = false; // React dev mode mounts twice
    return () => {
      unmountedRef.current = true;
      roomRef.current?.disconnect();
    };
  }, []);

  async function toggleSound() {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    audioEls.current.forEach((el) => {
      el.muted = next;
    });
    if (!next) await roomRef.current?.startAudio().catch(() => {});
  }

  function fullscreen() {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (el.requestFullscreen) void el.requestFullscreen();
    else (videoEl.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
  }

  const watching = phase === "watching" || phase === "reconnecting";
  const showReplay = !!replay && !watching && phase !== "joining" && (phase === "ended" || status === "ended");

  if (showReplay) {
    return (
      <div className="grid gap-4">
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video
            src={replay.url}
            controls
            playsInline
            preload="metadata"
            poster={thumbnailUrl ?? undefined}
            className="aspect-video w-full bg-black"
          />
          <span className="pointer-events-none absolute top-3 left-3 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white">
            REPLAY
          </span>
        </div>
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold break-words">{title}</h1>
          <p className="text-sm text-white/60">
            {hostName} · Streamed {new Date(replay.recordedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
          </p>
          <p className="text-xs text-white/50">This page switches to the live stream automatically if the host goes live again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("grid gap-4", chatEnabled && "lg:grid-cols-[1fr_340px]")}>
      <div className="grid content-start gap-4">
        <div
          ref={stageRef}
          className="group relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-neutral-900"
        >
          {thumbnailUrl && !watching && (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded thumbnail
            <img src={thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover opacity-30" />
          )}
          <video
            ref={videoEl}
            autoPlay
            playsInline
            muted
            className={cn("absolute inset-0 size-full bg-black object-contain", !(watching && videoTrack) && "invisible")}
          />

          {!watching || !videoTrack ? (
            <div className="relative grid justify-items-center gap-3 px-6 text-center text-white" aria-live="polite">
              {phase === "joining" ? (
                <>
                  <Loader2 className="size-8 animate-spin" aria-hidden />
                  <p className="font-medium">Joining the stream…</p>
                </>
              ) : watching ? (
                <>
                  <Loader2 className="size-8 animate-spin" aria-hidden />
                  <p className="font-medium">Waiting for the host&apos;s video…</p>
                </>
              ) : phase === "ended" || status === "ended" ? (
                <>
                  <Radio className="size-8" aria-hidden />
                  <p className="text-lg font-medium">This stream has ended</p>
                  <p className="text-sm text-white/70">Thanks for watching. This page will update if the host goes live again.</p>
                </>
              ) : phase === "full" ? (
                <>
                  <Eye className="size-8" aria-hidden />
                  <p className="text-lg font-medium">This stream is full right now</p>
                  <p className="text-sm text-white/70">We&apos;ll keep trying. A spot usually opens up soon.</p>
                </>
              ) : phase === "error" ? (
                <>
                  <p className="text-lg font-medium">Something went wrong</p>
                  <p className="text-sm text-white/70">{errorMsg}</p>
                  <Button variant="secondary" size="sm" onClick={() => setPhase("waiting")}>
                    Try again
                  </Button>
                </>
              ) : (
                <>
                  <Radio className="size-8" aria-hidden />
                  <p className="text-lg font-medium">This stream hasn&apos;t started yet</p>
                  <p className="text-sm text-white/70">Keep this page open. It will start when the host goes live.</p>
                </>
              )}
            </div>
          ) : null}

          {watching && (
            <>
              <div className="absolute top-3 left-3 flex items-center gap-2 text-xs font-semibold text-white">
                <span className="inline-flex items-center gap-1.5 rounded bg-live px-2 py-1">
                  <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden /> LIVE
                </span>
                <span className="inline-flex items-center gap-1 rounded bg-black/60 px-2 py-1" aria-label={`${viewers} watching`}>
                  <Eye className="size-3.5" aria-hidden /> {viewers}
                </span>
                {phase === "reconnecting" && <span className="rounded bg-black/60 px-2 py-1">Reconnecting…</span>}
              </div>
              {videoTrack && muted && (
                <button
                  onClick={toggleSound}
                  className="absolute inset-0 flex items-end justify-center pb-6 text-white sm:items-center sm:pb-0"
                >
                  <span className="inline-flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium backdrop-blur">
                    <VolumeX className="size-4" aria-hidden /> Tap for sound
                  </span>
                </button>
              )}
              <div className="absolute right-3 bottom-3 flex gap-2">
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={toggleSound}
                  aria-label={muted ? "Unmute" : "Mute"}
                  className="bg-black/60 text-white hover:bg-black/80"
                >
                  {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  onClick={fullscreen}
                  aria-label="Full screen"
                  className="bg-black/60 text-white hover:bg-black/80"
                >
                  <Maximize aria-hidden />
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="grid gap-1">
          <h1 className="text-xl font-semibold break-words">{title}</h1>
          <p className="text-sm text-white/60">{hostName}</p>
        </div>
      </div>

      {chatEnabled && (
        <ChatPanel room={room} canSend={canChat} selfName={name} dark className="h-[360px] lg:h-auto lg:max-h-[600px]" />
      )}
    </div>
  );
}
