import "server-only";
import { AccessToken, IngressClient, IngressInput, RoomServiceClient, type VideoGrant } from "livekit-server-sdk";

/**
 * Everything the app needs from LiveKit, behind one small interface so tests can swap in a fake
 * (see __setLiveKitForTesting) and the rest of the code never touches the SDK directly.
 */
export interface LiveKitGateway {
  /** Public WebSocket URL browsers connect to. */
  readonly wsUrl: string;
  ensureRoom(room: string, opts: { maxParticipants: number }): Promise<void>;
  deleteRoom(room: string): Promise<void>;
  /** Identities currently in the room. */
  listIdentities(room: string): Promise<string[]>;
  createToken(opts: {
    room: string;
    identity: string;
    name: string;
    grant: Omit<VideoGrant, "room" | "roomJoin">;
    ttlSeconds: number;
  }): Promise<string>;
  createRtmpIngress(opts: { room: string; identity: string; name: string }): Promise<{
    ingressId: string;
    url: string;
    streamKey: string;
  }>;
  deleteIngress(ingressId: string): Promise<void>;
}

export class LiveKitNotConfigured extends Error {
  constructor() {
    super("LiveKit is not configured (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)");
  }
}

function fromEnv(): LiveKitGateway | null {
  const wsUrl = process.env.LIVEKIT_URL?.trim();
  const key = process.env.LIVEKIT_API_KEY?.trim();
  const secret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!wsUrl || !key || !secret) return null;
  const httpUrl = wsUrl.replace(/^ws(s?):\/\//, "http$1://");
  const rooms = new RoomServiceClient(httpUrl, key, secret);
  const ingress = new IngressClient(httpUrl, key, secret);

  return {
    wsUrl,
    async ensureRoom(room, { maxParticipants }) {
      // Idempotent: returns the existing room if it's already there.
      await rooms.createRoom({ name: room, maxParticipants, emptyTimeout: 10 * 60, departureTimeout: 30 });
    },
    async deleteRoom(room) {
      try {
        await rooms.deleteRoom(room);
      } catch (err) {
        // Already gone is fine.
        if (!String(err).includes("not found")) throw err;
      }
    },
    async listIdentities(room) {
      try {
        return (await rooms.listParticipants(room)).map((p) => p.identity);
      } catch (err) {
        if (String(err).includes("not found")) return [];
        throw err;
      }
    },
    async createToken({ room, identity, name, grant, ttlSeconds }) {
      const at = new AccessToken(key, secret, { identity, name, ttl: ttlSeconds });
      at.addGrant({ ...grant, room, roomJoin: true });
      return at.toJwt();
    },
    async createRtmpIngress({ room, identity, name }) {
      const info = await ingress.createIngress(IngressInput.RTMP_INPUT, {
        name: `instantlive-${room}`,
        roomName: room,
        participantIdentity: identity,
        participantName: name,
        enableTranscoding: true,
      });
      return { ingressId: info.ingressId, url: info.url, streamKey: info.streamKey };
    },
    async deleteIngress(ingressId) {
      try {
        await ingress.deleteIngress(ingressId);
      } catch (err) {
        if (!String(err).includes("not found")) throw err;
      }
    },
  };
}

const globalForLk = globalThis as unknown as { __il_lk?: LiveKitGateway | null };

export function getLiveKit(): LiveKitGateway {
  if (globalForLk.__il_lk === undefined) globalForLk.__il_lk = fromEnv();
  if (!globalForLk.__il_lk) throw new LiveKitNotConfigured();
  return globalForLk.__il_lk;
}

export function isLiveKitConfigured(): boolean {
  try {
    getLiveKit();
    return true;
  } catch {
    return false;
  }
}

/** Test-only. Pass undefined to go back to reading the environment. */
export function __setLiveKitForTesting(gateway: LiveKitGateway | null | undefined) {
  globalForLk.__il_lk = gateway;
}

// ---------- Naming ----------

/** One stable room per stream. */
export const roomForStream = (streamId: string) => `stream_${streamId}`;
export const HOST_IDENTITY = "host";
export const HOST_OBS_IDENTITY = "host_obs";
export const VIEWER_PREFIX = "v_";
export const isViewerIdentity = (identity: string) => identity.startsWith(VIEWER_PREFIX);
