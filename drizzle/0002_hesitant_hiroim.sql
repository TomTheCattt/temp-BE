ALTER TABLE "device_tokens" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "device_tokens_expires_at_idx" ON "device_tokens" USING btree ("expires_at");