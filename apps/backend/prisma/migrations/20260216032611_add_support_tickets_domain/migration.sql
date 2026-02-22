-- CreateEnum
CREATE TYPE "ticket_priority_enum" AS ENUM ('P0', 'P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "ticket_status_enum" AS ENUM ('NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_RESPONSE', 'RESOLVED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "ticket_category_enum" AS ENUM ('INCIDENT', 'SERVICE_REQUEST', 'PROBLEM', 'CHANGE', 'QUESTION');

-- CreateEnum
CREATE TYPE "ticket_attachment_type_enum" AS ENUM ('IMAGE', 'DOCUMENT', 'LOG', 'SCREENSHOT');

-- DropIndex
DROP INDEX "idx_domain_settings_org_active_app_type";

-- DropIndex
DROP INDEX "idx_domain_settings_store_active_app_type";

-- DropIndex
DROP INDEX "idx_domain_settings_store_active_type";

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" SERIAL NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "created_by_user_id" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ticket_category_enum" NOT NULL DEFAULT 'QUESTION',
    "priority" "ticket_priority_enum" NOT NULL DEFAULT 'P3',
    "status" "ticket_status_enum" NOT NULL DEFAULT 'NEW',
    "assigned_to_user_id" INTEGER,
    "related_order_id" INTEGER,
    "related_order_type" VARCHAR(50),
    "related_product_id" INTEGER,
    "sla_deadline" TIMESTAMP(6),
    "sla_breached" BOOLEAN NOT NULL DEFAULT false,
    "first_response_at" TIMESTAMP(6),
    "resolved_at" TIMESTAMP(6),
    "closed_at" TIMESTAMP(6),
    "resolution_summary" TEXT,
    "resolution_time_minutes" INTEGER,
    "customer_satisfied" BOOLEAN,
    "source_channel" TEXT NOT NULL DEFAULT 'web',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_attachments" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_url" TEXT,
    "file_size" INTEGER NOT NULL,
    "file_type" "ticket_attachment_type_enum" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "thumbnail_key" TEXT,
    "thumbnail_url" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "uploaded_by_user_id" INTEGER,
    "description" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_comments" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "author_id" INTEGER NOT NULL,
    "author_type" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "author_email" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_status_history" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "old_status" "ticket_status_enum",
    "new_status" "ticket_status_enum" NOT NULL,
    "changed_by_user_id" INTEGER,
    "change_reason" TEXT,
    "change_notes" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_notifications" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "user_email" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "template_name" TEXT,
    "sent_at" TIMESTAMP(6),
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticket_number_key" ON "support_tickets"("ticket_number");

-- CreateIndex
CREATE INDEX "support_tickets_organization_id_status_idx" ON "support_tickets"("organization_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_store_id_status_idx" ON "support_tickets"("store_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_created_by_user_id_status_idx" ON "support_tickets"("created_by_user_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_assigned_to_user_id_status_idx" ON "support_tickets"("assigned_to_user_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_priority_status_idx" ON "support_tickets"("priority", "status");

-- CreateIndex
CREATE INDEX "support_tickets_created_at_idx" ON "support_tickets"("created_at");

-- CreateIndex
CREATE INDEX "support_tickets_sla_deadline_idx" ON "support_tickets"("sla_deadline");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_organization_id_ticket_number_key" ON "support_tickets"("organization_id", "ticket_number");

-- CreateIndex
CREATE INDEX "support_attachments_ticket_id_idx" ON "support_attachments"("ticket_id");

-- CreateIndex
CREATE INDEX "support_attachments_file_type_idx" ON "support_attachments"("file_type");

-- CreateIndex
CREATE INDEX "support_comments_ticket_id_created_at_idx" ON "support_comments"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "support_comments_author_id_idx" ON "support_comments"("author_id");

-- CreateIndex
CREATE INDEX "support_status_history_ticket_id_created_at_idx" ON "support_status_history"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "support_notifications_ticket_id_idx" ON "support_notifications"("ticket_id");

-- CreateIndex
CREATE INDEX "support_notifications_user_id_status_idx" ON "support_notifications"("user_id", "status");

-- CreateIndex
CREATE INDEX "support_notifications_status_idx" ON "support_notifications"("status");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_comments" ADD CONSTRAINT "support_comments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_comments" ADD CONSTRAINT "support_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_status_history" ADD CONSTRAINT "support_status_history_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_status_history" ADD CONSTRAINT "support_status_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_notifications" ADD CONSTRAINT "support_notifications_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_notifications" ADD CONSTRAINT "support_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
