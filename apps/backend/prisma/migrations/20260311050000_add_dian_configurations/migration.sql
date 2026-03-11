-- CreateEnum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dian_environment_enum') THEN
    CREATE TYPE "dian_environment_enum" AS ENUM ('test', 'production');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dian_enablement_status_enum') THEN
    CREATE TYPE "dian_enablement_status_enum" AS ENUM ('not_started', 'testing', 'enabled', 'suspended');
  END IF;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "dian_configurations" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "nit" VARCHAR(20) NOT NULL,
    "nit_dv" VARCHAR(1),
    "software_id" VARCHAR(100) NOT NULL,
    "software_pin_encrypted" TEXT NOT NULL,
    "certificate_s3_key" TEXT,
    "certificate_password_encrypted" TEXT,
    "certificate_expiry" TIMESTAMP(6),
    "environment" "dian_environment_enum" NOT NULL DEFAULT 'test',
    "enablement_status" "dian_enablement_status_enum" NOT NULL DEFAULT 'not_started',
    "test_set_id" VARCHAR(100),
    "last_test_result" JSONB,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dian_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dian_audit_logs" (
    "id" SERIAL NOT NULL,
    "dian_configuration_id" INTEGER NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "document_type" VARCHAR(50),
    "document_number" VARCHAR(50),
    "request_xml" TEXT,
    "response_xml" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "error_message" TEXT,
    "cufe" VARCHAR(255),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dian_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "dian_configurations_store_id_key" ON "dian_configurations"("store_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dian_configurations_organization_id_idx" ON "dian_configurations"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dian_audit_logs_dian_configuration_id_idx" ON "dian_audit_logs"("dian_configuration_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dian_audit_logs_action_idx" ON "dian_audit_logs"("action");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dian_audit_logs_created_at_idx" ON "dian_audit_logs"("created_at");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'dian_configurations_organization_id_fkey'
    AND table_name = 'dian_configurations'
  ) THEN
    ALTER TABLE "dian_configurations" ADD CONSTRAINT "dian_configurations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'dian_configurations_store_id_fkey'
    AND table_name = 'dian_configurations'
  ) THEN
    ALTER TABLE "dian_configurations" ADD CONSTRAINT "dian_configurations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'dian_audit_logs_dian_configuration_id_fkey'
    AND table_name = 'dian_audit_logs'
  ) THEN
    ALTER TABLE "dian_audit_logs" ADD CONSTRAINT "dian_audit_logs_dian_configuration_id_fkey" FOREIGN KEY ("dian_configuration_id") REFERENCES "dian_configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
