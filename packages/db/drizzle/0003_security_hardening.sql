CREATE TABLE "reconcile_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"summary" jsonb NOT NULL,
	"items" jsonb NOT NULL
);
--> statement-breakpoint
DROP INDEX "approvals_live_hash_uq";--> statement-breakpoint
ALTER TABLE "approval_assertions" ADD COLUMN "server_nonce" text;--> statement-breakpoint
ALTER TABLE "organizer_credentials" ADD COLUMN "bound_to" text;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_open_hash_uq" ON "approvals" USING btree ("hash") WHERE "approvals"."status" in ('pending', 'complete');