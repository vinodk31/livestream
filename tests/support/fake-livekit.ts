import type { LiveKitGateway } from "@/server/livekit";

/** In-memory LiveKit stand-in that records calls. */
export function createFakeLiveKit() {
  const rooms = new Map<string, { maxParticipants: number; identities: string[] }>();
  const ingresses = new Map<string, { room: string }>();
  const tokens: { room: string; identity: string; name: string; grant: Record<string, unknown> }[] = [];
  let n = 0;
  const fake: LiveKitGateway & {
    rooms: typeof rooms;
    ingresses: typeof ingresses;
    tokens: typeof tokens;
    deletedRooms: string[];
    addParticipants(room: string, ids: string[]): void;
  } = {
    wsUrl: "wss://fake.livekit.test",
    rooms,
    ingresses,
    tokens,
    deletedRooms: [],
    addParticipants(room, ids) {
      const r = rooms.get(room) ?? { maxParticipants: 0, identities: [] };
      r.identities.push(...ids);
      rooms.set(room, r);
    },
    async ensureRoom(room, { maxParticipants }) {
      const existing = rooms.get(room);
      rooms.set(room, { maxParticipants, identities: existing?.identities ?? [] });
    },
    async deleteRoom(room) {
      rooms.delete(room);
      fake.deletedRooms.push(room);
    },
    async listIdentities(room) {
      return rooms.get(room)?.identities ?? [];
    },
    async createToken({ room, identity, name, grant }) {
      tokens.push({ room, identity, name, grant: grant as Record<string, unknown> });
      return `token-${++n}`;
    },
    async createRtmpIngress({ room }) {
      const ingressId = `IN_${++n}`;
      ingresses.set(ingressId, { room });
      return { ingressId, url: "rtmps://fake.ingress/x", streamKey: `key-${n}` };
    },
    async deleteIngress(id) {
      ingresses.delete(id);
    },
  };
  return fake;
}
