import type { EgressResult, LiveKitGateway } from "@/server/livekit";

/** In-memory LiveKit stand-in that records calls. */
export function createFakeLiveKit() {
  const rooms = new Map<string, { maxParticipants: number; identities: string[] }>();
  const ingresses = new Map<string, { room: string }>();
  const tokens: { room: string; identity: string; name: string; grant: Record<string, unknown> }[] = [];
  const egresses = new Map<string, { room: string; key: string; stopped: boolean; result: EgressResult }>();
  let n = 0;
  const fake: LiveKitGateway & {
    rooms: typeof rooms;
    ingresses: typeof ingresses;
    egresses: typeof egresses;
    failNextRecording: boolean;
    tokens: typeof tokens;
    deletedRooms: string[];
    addParticipants(room: string, ids: string[]): void;
  } = {
    wsUrl: "wss://fake.livekit.test",
    rooms,
    ingresses,
    egresses,
    failNextRecording: false,
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
    async startRecording(room, key) {
      if (fake.failNextRecording) {
        fake.failNextRecording = false;
        throw new Error("egress unavailable");
      }
      const id = `EG_${++n}`;
      egresses.set(id, { room, key, stopped: false, result: { status: "active" } });
      return id;
    },
    async stopEgress(id) {
      const e = egresses.get(id);
      if (e) e.stopped = true;
    },
    async getEgress(id) {
      return egresses.get(id)?.result ?? { status: "failed", error: "not found" };
    },
  };
  return fake;
}
