-- CreateEnum
CREATE TYPE "field_type_enum" AS ENUM ('text', 'number', 'date', 'select', 'checkbox', 'textarea', 'file', 'email', 'phone', 'url');

-- CreateEnum
CREATE TYPE "entity_type_enum" AS ENUM ('customer', 'booking', 'order');

-- CreateEnum
CREATE TYPE "template_status_enum" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "submission_status_enum" AS ENUM ('pending', 'in_progress', 'submitted', 'processing', 'completed', 'expired');

-- CreateEnum
CREATE TYPE "metadata_display_mode_enum" AS ENUM ('summary', 'detail');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'booking_check_in';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'booking_confirmation_request';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'booking_auto_cancelled';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'data_collection_created';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'data_collection_submitted';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'data_collection_prediagnosis_ready';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "checked_in_at" TIMESTAMP(6),
ADD COLUMN     "confirmation_deadline" TIMESTAMP(6),
ADD COLUMN     "confirmation_requested_at" TIMESTAMP(6);

-- AlterTable
ALTER TABLE "notification_subscriptions" ADD COLUMN     "whatsapp" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "entity_metadata_fields" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "entity_type" "entity_type_enum" NOT NULL,
    "field_key" VARCHAR(100) NOT NULL,
    "field_type" "field_type_enum" NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "display_mode" "metadata_display_mode_enum" NOT NULL DEFAULT 'detail',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "default_value" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_metadata_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_metadata_values" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "field_id" INTEGER NOT NULL,
    "entity_type" "entity_type_enum" NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "value_text" TEXT,
    "value_number" DECIMAL(12,4),
    "value_date" DATE,
    "value_bool" BOOLEAN,
    "value_json" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_metadata_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_collection_templates" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "status" "template_status_enum" NOT NULL DEFAULT 'active',
    "entity_type" "entity_type_enum" NOT NULL DEFAULT 'booking',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_collection_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_collection_sections" (
    "id" SERIAL NOT NULL,
    "template_id" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_collection_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_collection_items" (
    "id" SERIAL NOT NULL,
    "section_id" INTEGER NOT NULL,
    "metadata_field_id" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "help_text" TEXT,
    "placeholder" VARCHAR(255),
    "validation_rules" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_collection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_collection_template_products" (
    "id" SERIAL NOT NULL,
    "template_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,

    CONSTRAINT "data_collection_template_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_collection_submissions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "template_id" INTEGER NOT NULL,
    "booking_id" INTEGER,
    "customer_id" INTEGER,
    "token" VARCHAR(64) NOT NULL,
    "status" "submission_status_enum" NOT NULL DEFAULT 'pending',
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "ai_prediagnosis" TEXT,
    "ai_job_id" VARCHAR(100),
    "submitted_at" TIMESTAMP(6),
    "processed_at" TIMESTAMP(6),
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_collection_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_collection_responses" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "field_id" INTEGER NOT NULL,
    "value_text" TEXT,
    "value_number" DECIMAL(12,4),
    "value_date" DATE,
    "value_bool" BOOLEAN,
    "value_json" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_collection_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_metadata_snapshots" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_metadata_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consultation_notes" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "note_key" VARCHAR(100) NOT NULL,
    "note_value" TEXT NOT NULL,
    "include_in_summary" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_consultation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_confirmation_tokens" (
    "id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "used_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_confirmation_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_reminder_logs" (
    "id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reminder_key" VARCHAR(30) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "sent_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER,
    "event_type" VARCHAR(50) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "body_html" TEXT NOT NULL,
    "body_text" TEXT,
    "variables" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_channels" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "channel_type" VARCHAR(20) NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messaging_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entity_metadata_fields_store_id_entity_type_is_active_idx" ON "entity_metadata_fields"("store_id", "entity_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "entity_metadata_fields_store_id_entity_type_field_key_key" ON "entity_metadata_fields"("store_id", "entity_type", "field_key");

-- CreateIndex
CREATE INDEX "entity_metadata_values_store_id_entity_type_entity_id_idx" ON "entity_metadata_values"("store_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "entity_metadata_values_field_id_idx" ON "entity_metadata_values"("field_id");

-- CreateIndex
CREATE INDEX "entity_metadata_values_field_id_value_number_idx" ON "entity_metadata_values"("field_id", "value_number");

-- CreateIndex
CREATE INDEX "entity_metadata_values_field_id_value_date_idx" ON "entity_metadata_values"("field_id", "value_date");

-- CreateIndex
CREATE UNIQUE INDEX "entity_metadata_values_field_id_entity_type_entity_id_key" ON "entity_metadata_values"("field_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "data_collection_templates_store_id_status_idx" ON "data_collection_templates"("store_id", "status");

-- CreateIndex
CREATE INDEX "data_collection_templates_store_id_entity_type_idx" ON "data_collection_templates"("store_id", "entity_type");

-- CreateIndex
CREATE INDEX "data_collection_sections_template_id_sort_order_idx" ON "data_collection_sections"("template_id", "sort_order");

-- CreateIndex
CREATE INDEX "data_collection_items_section_id_sort_order_idx" ON "data_collection_items"("section_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "data_collection_items_section_id_metadata_field_id_key" ON "data_collection_items"("section_id", "metadata_field_id");

-- CreateIndex
CREATE INDEX "data_collection_template_products_product_id_idx" ON "data_collection_template_products"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_collection_template_products_template_id_product_id_key" ON "data_collection_template_products"("template_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_collection_submissions_token_key" ON "data_collection_submissions"("token");

-- CreateIndex
CREATE INDEX "data_collection_submissions_store_id_status_idx" ON "data_collection_submissions"("store_id", "status");

-- CreateIndex
CREATE INDEX "data_collection_submissions_booking_id_idx" ON "data_collection_submissions"("booking_id");

-- CreateIndex
CREATE INDEX "data_collection_submissions_customer_id_idx" ON "data_collection_submissions"("customer_id");

-- CreateIndex
CREATE INDEX "data_collection_submissions_expires_at_idx" ON "data_collection_submissions"("expires_at");

-- CreateIndex
CREATE INDEX "data_collection_responses_submission_id_idx" ON "data_collection_responses"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_collection_responses_submission_id_field_id_key" ON "data_collection_responses"("submission_id", "field_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_metadata_snapshots_booking_id_key" ON "booking_metadata_snapshots"("booking_id");

-- CreateIndex
CREATE INDEX "booking_metadata_snapshots_customer_id_created_at_idx" ON "booking_metadata_snapshots"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "booking_metadata_snapshots_store_id_customer_id_idx" ON "booking_metadata_snapshots"("store_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_consultation_notes_customer_id_store_id_idx" ON "customer_consultation_notes"("customer_id", "store_id");

-- CreateIndex
CREATE INDEX "customer_consultation_notes_booking_id_idx" ON "customer_consultation_notes"("booking_id");

-- CreateIndex
CREATE INDEX "customer_consultation_notes_customer_id_include_in_summary_idx" ON "customer_consultation_notes"("customer_id", "include_in_summary");

-- CreateIndex
CREATE UNIQUE INDEX "booking_confirmation_tokens_token_key" ON "booking_confirmation_tokens"("token");

-- CreateIndex
CREATE INDEX "booking_confirmation_tokens_token_idx" ON "booking_confirmation_tokens"("token");

-- CreateIndex
CREATE INDEX "booking_confirmation_tokens_booking_id_idx" ON "booking_confirmation_tokens"("booking_id");

-- CreateIndex
CREATE INDEX "booking_reminder_logs_store_id_sent_at_idx" ON "booking_reminder_logs"("store_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_reminder_logs_booking_id_reminder_key_channel_key" ON "booking_reminder_logs"("booking_id", "reminder_key", "channel");

-- CreateIndex
CREATE INDEX "email_templates_event_type_is_active_idx" ON "email_templates"("event_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_store_id_event_type_key" ON "email_templates"("store_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_channels_store_id_channel_type_key" ON "messaging_channels"("store_id", "channel_type");

-- AddForeignKey
ALTER TABLE "entity_metadata_fields" ADD CONSTRAINT "entity_metadata_fields_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_metadata_values" ADD CONSTRAINT "entity_metadata_values_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_metadata_values" ADD CONSTRAINT "entity_metadata_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "entity_metadata_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_collection_templates" ADD CONSTRAINT "data_collection_templates_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_collection_sections" ADD CONSTRAINT "data_collection_sections_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "data_collection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_collection_items" ADD CONSTRAINT "data_collection_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "data_collection_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_collection_items" ADD CONSTRAINT "data_collection_items_metadata_field_id_fkey" FOREIGN KEY ("metadata_field_id") REFERENCES "entity_metadata_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_collection_template_products" ADD CONSTRAINT "data_collection_template_products_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "data_collection_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_collection_template_products" ADD CONSTRAINT "data_collection_template_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_collection_submissions" ADD CONSTRAINT "data_collection_submissions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_collection_submissions" ADD CONSTRAINT "data_collection_submissions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "data_collection_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_collection_submissions" ADD CONSTRAINT "data_collection_submissions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_collection_submissions" ADD CONSTRAINT "data_collection_submissions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_collection_responses" ADD CONSTRAINT "data_collection_responses_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "data_collection_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_collection_responses" ADD CONSTRAINT "data_collection_responses_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "entity_metadata_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_metadata_snapshots" ADD CONSTRAINT "booking_metadata_snapshots_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_metadata_snapshots" ADD CONSTRAINT "booking_metadata_snapshots_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_metadata_snapshots" ADD CONSTRAINT "booking_metadata_snapshots_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consultation_notes" ADD CONSTRAINT "customer_consultation_notes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consultation_notes" ADD CONSTRAINT "customer_consultation_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consultation_notes" ADD CONSTRAINT "customer_consultation_notes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consultation_notes" ADD CONSTRAINT "customer_consultation_notes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_confirmation_tokens" ADD CONSTRAINT "booking_confirmation_tokens_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_confirmation_tokens" ADD CONSTRAINT "booking_confirmation_tokens_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_reminder_logs" ADD CONSTRAINT "booking_reminder_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_channels" ADD CONSTRAINT "messaging_channels_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

