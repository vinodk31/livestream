DROP INDEX "stream_sessions_room_idx";--> statement-breakpoint
ALTER TABLE "stream_sessions" ADD COLUMN "last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stream_sessions" ADD COLUMN "source" varchar(8) DEFAULT 'browser' NOT NULL;--> statement-breakpoint
CREATE INDEX "stream_sessions_room_idx" ON "stream_sessions" USING btree ("livekit_room");