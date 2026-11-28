ALTER TYPE "public"."recording_status" ADD VALUE 'deleted';--> statement-breakpoint
ALTER TABLE "stream_sessions" ALTER COLUMN "recording_size_bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "stream_sessions" ADD COLUMN "recording_expires_at" timestamp with time zone;