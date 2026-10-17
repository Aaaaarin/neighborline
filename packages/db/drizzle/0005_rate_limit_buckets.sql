CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"capacity" integer NOT NULL,
	"refill_ms" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_expires_idx" ON "rate_limit_buckets" USING btree ("expires_at");