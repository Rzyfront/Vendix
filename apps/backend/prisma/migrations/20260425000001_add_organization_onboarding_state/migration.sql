-- Create organization_onboarding_state table for persisting wizard state
CREATE TABLE "organization_onboarding_state" (
    "id" SERIAL PRIMARY KEY,
    "organization_id" INTEGER NOT NULL UNIQUE,
    "current_step" INTEGER NOT NULL DEFAULT 1,
    "selected_app_type" VARCHAR(50),
    "step_data" JSONB DEFAULT '{}',
    "user_data_draft" JSONB DEFAULT '{}',
    "organization_data_draft" JSONB DEFAULT '{}',
    "store_data_draft" JSONB DEFAULT '{}',
    "app_config_draft" JSONB DEFAULT '{}',
    "email_verification_sent_at" TIMESTAMP(6),
    "last_resend_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_onboarding_state_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
);

CREATE INDEX "organization_onboarding_state_organization_id_idx" ON "organization_onboarding_state"("organization_id");
