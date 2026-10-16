CREATE TABLE "approval_signatures" (
	"approval_id" text NOT NULL,
	"organizer_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"device_label" text NOT NULL,
	CONSTRAINT "approval_signatures_approval_id_organizer_id_pk" PRIMARY KEY("approval_id","organizer_id")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"request_ids" jsonb NOT NULL,
	"total_cents" integer NOT NULL,
	"policy_version_id" text NOT NULL,
	"hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"row_hash" text NOT NULL,
	CONSTRAINT "audit_log_row_hash_unique" UNIQUE("row_hash")
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"source" text NOT NULL,
	"donor_key" text,
	"paypal_order_id" text,
	"paypal_subscription_id" text,
	"transaction_id" text,
	"status" text DEFAULT 'COMPLETED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donations_paypal_order_id_unique" UNIQUE("paypal_order_id"),
	CONSTRAINT "donations_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"official_handles" jsonb NOT NULL,
	"fiscal_sponsor" jsonb NOT NULL,
	"active_policy_id" text,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"required_approvals" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"channel" text NOT NULL,
	"lang" text NOT NULL,
	"message_key" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizers" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	"handles" jsonb NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"approval_id" text NOT NULL,
	"sender_batch_id" text NOT NULL,
	"paypal_batch_id" text,
	"status" text DEFAULT 'CREATING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_batches_approval_id_unique" UNIQUE("approval_id"),
	CONSTRAINT "payout_batches_sender_batch_id_unique" UNIQUE("sender_batch_id"),
	CONSTRAINT "payout_batches_paypal_batch_id_unique" UNIQUE("paypal_batch_id")
);
--> statement-breakpoint
CREATE TABLE "payout_items" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"request_id" text NOT NULL,
	"sender_item_id" text NOT NULL,
	"paypal_item_id" text,
	"amount_cents" integer NOT NULL,
	"wallet" text NOT NULL,
	"receiver" text NOT NULL,
	"recipient_type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"transaction_id" text,
	"was_unclaimed" boolean DEFAULT false NOT NULL,
	"success_at" timestamp with time zone,
	"last_event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_items_sender_item_id_unique" UNIQUE("sender_item_id"),
	CONSTRAINT "payout_items_paypal_item_id_unique" UNIQUE("paypal_item_id")
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"version" integer NOT NULL,
	"body" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" text NOT NULL,
	"lang" text NOT NULL,
	"original_text" text DEFAULT '' NOT NULL,
	"english_text" text DEFAULT '' NOT NULL,
	"audio_ref" text,
	"photo_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extracted" jsonb,
	"confirmed_by_requester" boolean DEFAULT false NOT NULL,
	"payout_destination" jsonb,
	"destination_key" text,
	"phone_key" text,
	"status" text NOT NULL,
	"policy_version_id" text,
	"computed" jsonb,
	"rule_key" text,
	"amount_cents" integer,
	"rail_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contact" jsonb
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text,
	"verified" boolean NOT NULL,
	"raw" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approval_signatures" ADD CONSTRAINT "approval_signatures_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_signatures" ADD CONSTRAINT "approval_signatures_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_batch_id_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_live_hash_uq" ON "approvals" USING btree ("hash") WHERE "approvals"."status" <> 'void';--> statement-breakpoint
CREATE INDEX "donations_group_idx" ON "donations" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_request_idx" ON "notifications" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "organizers_group_idx" ON "organizers" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "payout_items_request_idx" ON "payout_items" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "payout_items_created_idx" ON "payout_items" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_group_version_uq" ON "policies" USING btree ("group_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_one_active_uq" ON "policies" USING btree ("group_id") WHERE "policies"."status" = 'active';--> statement-breakpoint
CREATE INDEX "requests_group_status_idx" ON "requests" USING btree ("group_id","status");--> statement-breakpoint
CREATE INDEX "requests_destination_idx" ON "requests" USING btree ("destination_key","created_at");--> statement-breakpoint
CREATE INDEX "requests_phone_idx" ON "requests" USING btree ("phone_key","created_at");