-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "device_fingerprint" VARCHAR(255),
ADD COLUMN     "ip_address" VARCHAR(45),
ADD COLUMN     "last_used" TIMESTAMP(6),
ADD COLUMN     "revoked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revoked_at" TIMESTAMP(6),
ADD COLUMN     "revoked_reason" VARCHAR(255),
ADD COLUMN     "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "user_agent" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "onboarding_completed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_idx" ON "refresh_tokens"("user_id", "revoked");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_revoked_idx" ON "refresh_tokens"("revoked");

-- CreateIndex
CREATE INDEX "refresh_tokens_ip_address_idx" ON "refresh_tokens"("ip_address");

-- CreateIndex
CREATE INDEX "refresh_tokens_last_used_idx" ON "refresh_tokens"("last_used");

-- CreateIndex
CREATE INDEX "users_onboarding_completed_idx" ON "users"("onboarding_completed");

-- CreateIndex
CREATE INDEX "users_email_verified_idx" ON "users"("email_verified");

-- CreateIndex
CREATE INDEX "users_state_idx" ON "users"("state");
