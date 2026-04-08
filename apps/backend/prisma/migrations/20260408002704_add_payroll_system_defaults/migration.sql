-- Migration: add_payroll_system_defaults
-- Creates payroll_system_defaults table and adds payroll_rules_update to notification_type_enum

-- Add new value to notification_type_enum (MUST run outside transaction - PostgreSQL limitation)
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'payroll_rules_update';

-- CreateTable: payroll_system_defaults
CREATE TABLE "payroll_system_defaults" (
    "id"           SERIAL NOT NULL,
    "year"         INTEGER NOT NULL,
    "rules"        JSONB NOT NULL,
    "decree_ref"   VARCHAR(255),
    "notes"        TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(6),
    "published_by" INTEGER,
    "created_at"   TIMESTAMP(6) DEFAULT NOW(),
    "updated_at"   TIMESTAMP(6) DEFAULT NOW(),

    CONSTRAINT "payroll_system_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique constraint on year
CREATE UNIQUE INDEX "payroll_system_defaults_year_key" ON "payroll_system_defaults"("year");
