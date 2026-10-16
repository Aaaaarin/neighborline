CREATE TABLE "organizer_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"organizer_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_credential_id" text,
	CONSTRAINT "organizer_invites_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "organizer_invites" ADD CONSTRAINT "organizer_invites_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizer_invites_org_idx" ON "organizer_invites" USING btree ("organizer_id");