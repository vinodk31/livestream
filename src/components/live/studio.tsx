"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  createLocalTracks,
  type RemoteTrack,
} from "livekit-client";
import {
  ArrowLeft,
  Camera,
  CameraOff,
  Check,
  Copy,
  Eye,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  Radio,
  RefreshCw,
  SwitchCamera,
  Timer,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChatPanel } from "./chat-panel";

type Phase = "setup" | "connecting" | "live" | "ended";
type Mode = "camera" | "obs";

export type StudioProps = {
  streamId: string;
  title: string;
  watchUrl: string;
  chatEnabled: boolean;
  hostName: string;
  initiallyLive: boolean;
  canGoLive: boolean;
  blockedReason?: string;
};

type ApiError = { error: string; message?: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) throw new Error(body.message ?? "Something went wrong. Please try again.");
  return body;
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
}

function mediaErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError")
    return "Camera or microphone access was blocked. Allow access in your browser's site settings, then reload.";
  if (name === "NotFoundError") return "No camera or microphone was found. Plug one in, or use OBS instead.";
  if (name === "NotReadableError") return "Your camera is being used by another app. Close it and reload.";
  return "Couldn't start your camera. Reload the page to try again, or use OBS instead.";
}

export function Studio(props: StudioProps) {
  const { streamId, title, watchUrl, chatEnabled, hostName, canGoLive } = props;
  const [mode, setMode] = useState<Mode>("camera");
  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    props.initiallyLive ? "This stream is marked live. Start again to reconnect, or end it." : null,
  );

  // Local media (camera mode)
  const [videoTrack, setVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [audioTrack, setAudioTrack] = useState<LocalAudioTrack | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>("");
  const [micId, setMicId] = useState<string>("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [sharing, setSharing] = useState(false);
  const canShareScreen = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

  // Live session
  const [room, setRoom] = useState<Room | null>(null);
  const [viewers, setViewers] = useState(0);
  const [peak, setPeak] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [obsTrack, setObsTrack] = useState<RemoteTrack | null>(null);

  // OBS settings
  const [obs, setObs] = useState<{ url: string; streamKey: string } | null>(null);
  const [obsLoading, setObsLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const videoEl = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<Room | null>(null);
  const endingRef = useRef(false);

  // ----- Camera preview -----
  useEffect(() => {
    if (mode !== "camera" || phase === "ended") return;
    let cancelled = false;
    let created: (LocalVideoTrack | LocalAudioTrack)[] = [];
    (async () => {
      try {
        created = (await createLocalTracks({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: { facingMode: "user", resolution: VideoPresets.h720.resolution },
        })) as (LocalVideoTrack | LocalAudioTrack)[];
        if (cancelled) {
          created.forEach((t) => t.stop());
          return;
        }
        setVideoTrack(created.find((t): t is LocalVideoTrack => t.kind === Track.Kind.Video) ?? null);
        setAudioTrack(created.find((t): t is LocalAudioTrack => t.kind === Track.Kind.Audio) ?? null);
        setMediaError(null);
        const [cams, ms] = await Promise.all([Room.getLocalDevices("videoinput"), Room.getLocalDevices("audioinput")]);
        if (!cancelled) {
          setCameras(cams);
          setMics(ms);
        }
      } catch (err) {
        if (!cancelled) setMediaError(mediaErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
      // Keep tracks alive while live; the end/unmount handlers stop them.
      if (!roomRef.current) created.forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once per mode
  }, [mode]);

  useEffect(() => {
    const el = videoEl.current;
    if (!el) return;
    const track = mode === "camera" ? videoTrack : obsTrack;
    if (!track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [videoTrack, obsTrack, mode, phase]);

  // ----- Clock -----
  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ----- Leave protection & screen wake lock while live -----
  useEffect(() => {
    if (phase !== "live") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => {
      window.removeEventListener("beforeunload", warn);
      lock?.release().catch(() => {});
    };
  }, [phase]);

  const finish = useCallback((message: string | null) => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    setRoom(null);
    setSharing(false);
    setObsTrack(null);
    setPhase("ended");
    setNotice(message);
  }, []);

  // ----- Heartbeat -----
  useEffect(() => {
    if (phase !== "live") return;
    let stopped = false;
    const beat = async () => {
      try {
        const res = await api<
          | { live: true; viewers: number; peakViewers: number }
          | { live: false; reason: "ended" | "quota_exceeded" }
        >(`/api/streams/${streamId}/heartbeat`, { method: "POST" });
        if (stopped) return;
        if (res.live) {
          setViewers(res.viewers);
          setPeak(res.peakViewers);
        } else {
          finish(
            res.reason === "quota_exceeded"
              ? "Your plan's streaming time for this month ran out, so the broadcast ended."
              : "This broadcast was ended.",
          );
        }
      } catch {
        // Transient: the next beat will retry.
      }
    };
    void beat();
    const id = setInterval(beat, 15_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [phase, streamId, finish]);

  // Stop everything if the page goes away.
  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
    };
  }, []);

  // ----- Controls -----
  async function goLive() {
    setError(null);
    setNotice(null);
    setPhase("connecting");
    endingRef.current = false;
    try {
      const conn = await api<{ wsUrl: string; token: string; startedAt: string; resumed: boolean }>(
        `/api/streams/${streamId}/broadcast`,
        { method: "POST", body: JSON.stringify({ source: mode === "obs" ? "obs" : "browser" }) },
      );
      const r = new Room({
        adaptiveStream: false,
        dynacast: true,
        publishDefaults: {
          simulcast: true,
          videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
          screenShareEncoding: VideoPresets.h1080.encoding,
        },
      });
      r.on(RoomEvent.Disconnected, () => {
        if (!endingRef.current) finish("You were disconnected and the broadcast ended. Start again to go back live.");
      });
      r.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (participant.identity === "host_obs" && track.kind === Track.Kind.Video) setObsTrack(track);
      });
      r.on(RoomEvent.TrackUnsubscribed, (track) => {
        setObsTrack((t) => (t === track ? null : t));
      });
      await r.connect(conn.wsUrl, conn.token);
      roomRef.current = r;
      if (mode === "camera") {
        if (videoTrack) await r.localParticipant.publishTrack(videoTrack, { source: Track.Source.Camera });
        if (audioTrack) await r.localParticipant.publishTrack(audioTrack, { source: Track.Source.Microphone });
      }
      setRoom(r);
      setStartedAt(new Date(conn.startedAt).getTime());
      setNow(Date.now());
      setPhase("live");
    } catch (err) {
      roomRef.current?.disconnect();
      roomRef.current = null;
      setPhase("setup");
      setError(err instanceof Error ? err.message : "Couldn't go live. Please try again.");
    }
  }

  async function endLive() {
    if (!confirm("End the broadcast for everyone?")) return;
    endingRef.current = true;
    try {
      await api(`/api/streams/${streamId}/broadcast`, { method: "DELETE" });
    } catch {
      // The server also ends it when heartbeats stop.
    }
    videoTrack?.stop();
    audioTrack?.stop();
    finish(null);
  }

  async function toggleMic() {
    if (!audioTrack) return;
    if (micOn) await audioTrack.mute();
    else await audioTrack.unmute();
    setMicOn(!micOn);
  }

  async function toggleCam() {
    if (!videoTrack) return;
    if (camOn) await videoTrack.mute();
    else await videoTrack.unmute();
    setCamOn(!camOn);
  }

  async function chooseCamera(id: string) {
    setCameraId(id);
    await videoTrack?.restartTrack({ deviceId: id, resolution: VideoPresets.h720.resolution });
  }

  async function chooseMic(id: string) {
    setMicId(id);
    await audioTrack?.restartTrack({ deviceId: id, echoCancellation: true, noiseSuppression: true });
  }

  async function flipCamera() {
    const next = facing === "user" ? "environment" : "user";
    await videoTrack?.restartTrack({ facingMode: next, resolution: VideoPresets.h720.resolution });
    setFacing(next);
  }

  async function toggleShare() {
    const r = roomRef.current;
    if (!r) return;
    try {
      const pub = await r.localParticipant.setScreenShareEnabled(!sharing, { audio: true });
      const on = !sharing;
      setSharing(on);
      if (on && pub?.track) {
        pub.track.once("ended", () => setSharing(false));
      }
    } catch {
      setSharing(false); // user cancelled the picker
    }
  }

  async function loadObs(regenerate = false) {
    if (regenerate && !confirm("Create a new stream key? OBS will need the new key.")) return;
    setObsLoading(true);
    setError(null);
    try {
      setObs(await api(`/api/streams/${streamId}/obs`, { method: "POST", body: JSON.stringify({ regenerate }) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load OBS settings.");
    } finally {
      setObsLoading(false);
    }
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  const live = phase === "live";
  const showPreview = mode === "camera" ? !!videoTrack : !!obsTrack;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/streams/${streamId}`} aria-label="Back to stream details">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            <p className="text-xs text-muted-foreground">Studio</p>
          </div>
        </div>
        {live && (
          <div className="flex items-center gap-3 text-sm" aria-live="polite">
            <span className="inline-flex items-center gap-1.5 rounded bg-live px-2 py-1 text-xs font-bold text-white">
              <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden /> LIVE
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums" title="Time live">
              <Timer className="size-4" aria-hidden /> {startedAt ? formatElapsed(now - startedAt) : "0:00"}
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums" title={`Peak: ${peak}`}>
              <Eye className="size-4" aria-hidden /> {viewers} watching
            </span>
          </div>
        )}
      </div>

      {!canGoLive && props.blockedReason && (
        <Alert variant="warning">
          <AlertDescription>{props.blockedReason}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <div className={cn("grid gap-4", chatEnabled && "lg:grid-cols-[1fr_320px]")}>
        <div className="grid content-start gap-4">
          {phase === "setup" && (
            <div role="tablist" aria-label="How are you streaming?" className="flex w-fit gap-1 rounded-lg bg-muted p-1 text-sm">
              {(["camera", "obs"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-md px-3 py-1.5",
                    mode === m ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "camera" ? "Camera & mic" : "OBS / encoder"}
                </button>
              ))}
            </div>
          )}

          <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-neutral-900 text-white">
            <video
              ref={videoEl}
              autoPlay
              playsInline
              muted
              className={cn(
                "absolute inset-0 size-full object-contain",
                mode === "camera" && facing === "user" && "-scale-x-100",
                (!showPreview || (mode === "camera" && !camOn)) && "invisible",
              )}
            />
            {phase === "ended" ? (
              <div className="relative grid justify-items-center gap-2 px-6 text-center">
                <Check className="size-8" aria-hidden />
                <p className="font-medium">Broadcast ended</p>
                <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                  Set up another broadcast
                </Button>
              </div>
            ) : mode === "camera" ? (
              mediaError ? (
                <p className="relative max-w-sm px-6 text-center text-sm">{mediaError}</p>
              ) : !videoTrack ? (
                <Loader2 className="relative size-6 animate-spin" aria-label="Starting camera" />
              ) : !camOn ? (
                <p className="relative text-sm text-white/70">Camera is off</p>
              ) : null
            ) : !obsTrack ? (
              <p className="relative max-w-sm px-6 text-center text-sm text-white/80">
                {live
                  ? "Waiting for video from OBS… Click Start Streaming in OBS."
                  : "Your OBS video will show here once you start the broadcast and start streaming in OBS."}
              </p>
            ) : null}
            {live && sharing && (
              <span className="absolute top-3 left-3 rounded bg-black/60 px-2 py-1 text-xs">Sharing your screen</span>
            )}
          </div>

          {mode === "camera" && phase !== "ended" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant={micOn ? "outline" : "destructive"} size="sm" onClick={toggleMic} disabled={!audioTrack} aria-pressed={!micOn}>
                {micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />} {micOn ? "Mute" : "Unmute"}
              </Button>
              <Button variant={camOn ? "outline" : "destructive"} size="sm" onClick={toggleCam} disabled={!videoTrack} aria-pressed={!camOn}>
                {camOn ? <Camera aria-hidden /> : <CameraOff aria-hidden />} {camOn ? "Stop video" : "Start video"}
              </Button>
              <Button variant="outline" size="sm" onClick={flipCamera} disabled={!videoTrack} className="sm:hidden">
                <SwitchCamera aria-hidden /> Flip
              </Button>
              {canShareScreen && (
                <Button
                  variant={sharing ? "secondary" : "outline"}
                  size="sm"
                  onClick={toggleShare}
                  disabled={!live}
                  title={live ? undefined : "Available once you're live"}
                  aria-pressed={sharing}
                >
                  <MonitorUp aria-hidden /> {sharing ? "Stop sharing" : "Share screen"}
                </Button>
              )}
              {cameras.length > 1 && (
                <select
                  aria-label="Camera"
                  value={cameraId}
                  onChange={(e) => chooseCamera(e.target.value)}
                  className="h-8 max-w-48 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">Default camera</option>
                  {cameras.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}
              {mics.length > 1 && (
                <select
                  aria-label="Microphone"
                  value={micId}
                  onChange={(e) => chooseMic(e.target.value)}
                  className="h-8 max-w-48 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">Default microphone</option>
                  {mics.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {mode === "obs" && phase !== "ended" && (
            <div className="grid gap-3 rounded-xl border bg-card p-4 text-sm">
              {!obs ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-muted-foreground">Stream from OBS, vMix or a hardware encoder over RTMP.</p>
                  <Button size="sm" variant="outline" onClick={() => loadObs(false)} disabled={obsLoading}>
                    {obsLoading && <Loader2 className="animate-spin" aria-hidden />} Show OBS settings
                  </Button>
                </div>
              ) : (
                <>
                  <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                    <li>In OBS, open Settings → Stream and choose Service: Custom.</li>
                    <li>Paste the server and stream key below, then click OK.</li>
                    <li>Click Start broadcast here, then Start Streaming in OBS.</li>
                  </ol>
                  <ObsField label="Server" value={obs.url} onCopy={() => copy("server", obs.url)} copied={copied === "server"} />
                  <ObsField
                    label="Stream key"
                    value={showKey ? obs.streamKey : "•".repeat(Math.min(24, obs.streamKey.length))}
                    onCopy={() => copy("key", obs.streamKey)}
                    copied={copied === "key"}
                    extra={
                      <Button variant="ghost" size="sm" onClick={() => setShowKey((v) => !v)}>
                        {showKey ? "Hide" : "Show"}
                      </Button>
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Keep the stream key secret: anyone with it can stream to this page.{" "}
                    <button className="underline underline-offset-2" onClick={() => loadObs(true)} disabled={obsLoading}>
                      <RefreshCw className="mr-1 inline size-3" aria-hidden />
                      Create a new key
                    </button>
                  </p>
                </>
              )}
            </div>
          )}

          {phase !== "ended" && (
            <div className="flex flex-wrap items-center gap-3">
              {live ? (
                <Button variant="destructive" onClick={endLive}>
                  End broadcast
                </Button>
              ) : (
                <Button
                  variant="live"
                  size="lg"
                  onClick={goLive}
                  disabled={!canGoLive || phase === "connecting" || (mode === "camera" && !videoTrack && !audioTrack)}
                >
                  {phase === "connecting" ? <Loader2 className="animate-spin" aria-hidden /> : <Radio aria-hidden />}
                  {phase === "connecting" ? "Going live…" : "Start broadcast"}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                {live ? (
                  <>
                    Keep this page open while you&apos;re live.{" "}
                    <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                      Open viewer page
                    </a>
                  </>
                ) : (
                  <>
                    Viewers watch at <span className="font-mono">{watchUrl.replace(/^https?:\/\//, "")}</span>
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        {chatEnabled && (
          <ChatPanel room={room} canSend={live} selfName={hostName} isHost className="h-[420px] lg:h-auto lg:max-h-[640px]" />
        )}
      </div>
    </div>
  );
}

function ObsField({
  label,
  value,
  onCopy,
  copied,
  extra,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium">{label}</span>
      <div className="flex gap-2">
        <Input readOnly value={value} aria-label={label} className="bg-muted/50 font-mono text-xs" />
        {extra}
        <Button variant="outline" size="sm" onClick={onCopy} className="shrink-0">
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
