CREATE TYPE "public"."device_type" AS ENUM('desktop', 'mobile', 'tablet', 'other');--> statement-breakpoint
CREATE TYPE "public"."email_token_type" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TYPE "public"."recording_status" AS ENUM('none', 'recording', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'harassment', 'hate', 'violence', 'sexual', 'copyright', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'dismissed', 'actioned');--> statement-breakpoint
CREATE TYPE "public"."stream_privacy" AS ENUM('public', 'unlisted', 'private');--> statement-breakpoint
CREATE TYPE "public"."stream_status" AS ENUM('idle', 'live', 'ended');--> statement-breakpoint
CREATE TYPE "public"."user_plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('host', 'admin');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" varchar(64),
	"metadata" jsonb,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "email_token_type" NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"user_agent" varchar(512),
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stream_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"details" text,
	"reporter_hash" varchar(64),
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stream_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stream_id" uuid NOT NULL,
	"livekit_room" varchar(128) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"peak_viewers" integer DEFAULT 0 NOT NULL,
	"total_joins" integer DEFAULT 0 NOT NULL,
	"viewer_seconds" integer DEFAULT 0 NOT NULL,
	"egress_id" varchar(64),
	"recording_status" "recording_status" DEFAULT 'none' NOT NULL,
	"recording_url" text,
	"recording_duration_sec" integer,
	"recording_size_bytes" integer
);
--> statement-breakpoint
CREATE TABLE "streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(16) NOT NULL,
	"host_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" text,
	"privacy" "stream_privacy" DEFAULT 'unlisted' NOT NULL,
	"passcode_hash" text,
	"thumbnail_url" text,
	"status" "stream_status" DEFAULT 'idle' NOT NULL,
	"chat_enabled" boolean DEFAULT true NOT NULL,
	"recording_enabled" boolean DEFAULT true NOT NULL,
	"ingress_id" varchar(64),
	"ingress_url" text,
	"ingress_stream_key" text,
	"ingress_type" varchar(8),
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"last_live_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(100) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'host' NOT NULL,
	"plan" "user_plan" DEFAULT 'free' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "viewer_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"viewer_key" varchar(64) NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"device_type" "device_type" DEFAULT 'other' NOT NULL,
	"country" varchar(2)
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_sessions" ADD CONSTRAINT "stream_sessions_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streams" ADD CONSTRAINT "streams_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewer_stats" ADD CONSTRAINT "viewer_stats_session_id_stream_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."stream_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_tokens_hash_idx" ON "email_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_tokens_user_type_idx" ON "email_tokens" USING btree ("user_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "stream_sessions_stream_idx" ON "stream_sessions" USING btree ("stream_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stream_sessions_room_idx" ON "stream_sessions" USING btree ("livekit_room");--> statement-breakpoint
CREATE UNIQUE INDEX "streams_slug_idx" ON "streams" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "streams_host_idx" ON "streams" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "streams_status_idx" ON "streams" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "viewer_stats_session_idx" ON "viewer_stats" USING btree ("session_id","joined_at");