CREATE TABLE "approval_assertions" (
	"approval_hash" text NOT NULL,
	"organizer_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"kind" text NOT NULL,
	"authenticator_data" text NOT NULL,
	"client_data_json" text NOT NULL,
	"signature" text NOT NULL,
	"user_handle" text,
	"rp_id" text NOT NULL,
	"origin" text NOT NULL,
	"device_label" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "approval_assertions_approval_hash_organizer_id_pk" PRIMARY KEY("approval_hash","organizer_id")
);
--> statement-breakpoint
CREATE TABLE "organizer_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organizer_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_label" text NOT NULL,
	"kind" text DEFAULT 'passkey' NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approval_assertions" ADD CONSTRAINT "approval_assertions_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_assertions" ADD CONSTRAINT "approval_assertions_credential_id_organizer_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."organizer_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_credentials" ADD CONSTRAINT "organizer_credentials_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizer_credentials_org_idx" ON "organizer_credentials" USING btree ("organizer_id");