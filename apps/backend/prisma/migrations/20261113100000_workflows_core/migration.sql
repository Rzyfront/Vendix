-- flujos-documental S3 (T3): núcleo de Flujos — definiciones, versiones, grupos
-- de trabajo, solicitudes, tareas, votos de quórum, historial y outbox.
--
-- DATA IMPACT:
-- Tables affected: workflow_definitions, workflow_versions, work_groups,
--   work_group_members, workflow_instances, workflow_tasks,
--   workflow_task_votes, workflow_instance_events, workflow_outbox (todas NUEVAS).
-- Expected row changes: +0 (solo esquema; ninguna fila existente se lee ni se muta).
-- Destructive operations: none (sin DROP / TRUNCATE / UPDATE / DELETE).
-- FK/cascade risk: FKs nuevas hacia stores / organizations / users con
--   ON DELETE RESTRICT o SET NULL; ningún CASCADE sobre padres de negocio.
-- Idempotency: CREATE TYPE guardado por pg_type, CREATE TABLE/INDEX IF NOT EXISTS,
--   FKs guardadas por pg_constraint, ALTER TYPE ... ADD VALUE IF NOT EXISTS
--   (el valor nuevo no se USA en esta migración).
-- Skill: vendix-prisma-migrations.


-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_definition_status_enum') THEN
    CREATE TYPE "workflow_definition_status_enum" AS ENUM ('draft', 'active', 'archived');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_instance_status_enum') THEN
    CREATE TYPE "workflow_instance_status_enum" AS ENUM ('active', 'completed', 'rejected', 'cancelled', 'failed');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_task_status_enum') THEN
    CREATE TYPE "workflow_task_status_enum" AS ENUM ('open', 'claimed', 'done', 'cancelled', 'expired');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_task_kind_enum') THEN
    CREATE TYPE "workflow_task_kind_enum" AS ENUM ('form', 'approval', 'review');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_actor_type_enum') THEN
    CREATE TYPE "workflow_actor_type_enum" AS ENUM ('user', 'public', 'system', 'ai');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_outbox_status_enum') THEN
    CREATE TYPE "workflow_outbox_status_enum" AS ENUM ('pending', 'processing', 'done', 'failed', 'dead');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_assignment_strategy_enum') THEN
    CREATE TYPE "workflow_assignment_strategy_enum" AS ENUM ('any', 'round_robin', 'least_load');
  END IF;
END $$;

-- AlterEnum
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'workflow_task';

-- CreateTable
CREATE TABLE IF NOT EXISTS "workflow_definitions" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "status" "workflow_definition_status_enum" NOT NULL DEFAULT 'draft',
    "draft_definition" JSONB,
    "draft_updated_at" TIMESTAMP(6),
    "published_version_id" INTEGER,
    "category" VARCHAR(60),
    "source_template_key" VARCHAR(80),
    "created_by_user_id" INTEGER NOT NULL,
    "updated_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workflow_versions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "definition_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "schema_version" VARCHAR(20) NOT NULL,
    "definition" JSONB NOT NULL,
    "definition_hash" CHAR(64) NOT NULL,
    "published_by_user_id" INTEGER NOT NULL,
    "published_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changelog" TEXT,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "work_groups" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "assignment_strategy" "workflow_assignment_strategy_enum" NOT NULL DEFAULT 'round_robin',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "work_group_members" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "work_group_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "is_lead" BOOLEAN NOT NULL DEFAULT false,
    "is_available" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "work_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workflow_instances" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "definition_id" INTEGER NOT NULL,
    "version_id" INTEGER NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" "workflow_instance_status_enum" NOT NULL DEFAULT 'active',
    "current_stage_key" VARCHAR(80) NOT NULL,
    "stage_entered_at" TIMESTAMP(6) NOT NULL,
    "stage_due_at" TIMESTAMP(6),
    "stage_entry_seq" INTEGER NOT NULL DEFAULT 1,
    "stage_last_reminded_at" TIMESTAMP(6),
    "stage_escalated_at" TIMESTAMP(6),
    "cancel_reason" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "subject_type" VARCHAR(40),
    "subject_id" INTEGER,
    "started_by_type" "workflow_actor_type_enum" NOT NULL,
    "started_by_id" INTEGER,
    "row_version" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workflow_tasks" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "stage_key" VARCHAR(80) NOT NULL,
    "stage_entry_seq" INTEGER NOT NULL,
    "kind" "workflow_task_kind_enum" NOT NULL,
    "status" "workflow_task_status_enum" NOT NULL DEFAULT 'open',
    "assignee_user_id" INTEGER,
    "assignee_role_id" INTEGER,
    "assignee_group_id" INTEGER,
    "claimed_at" TIMESTAMP(6),
    "due_at" TIMESTAMP(6),
    "outcome" VARCHAR(40),
    "outcome_comment" TEXT,
    "completed_by_user_id" INTEGER,
    "completed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workflow_task_votes" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "task_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_task_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workflow_instance_events" (
    "id" BIGSERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "from_stage_key" VARCHAR(80),
    "to_stage_key" VARCHAR(80),
    "actor_type" "workflow_actor_type_enum" NOT NULL,
    "actor_id" INTEGER,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" VARCHAR(80),
    "occurred_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_instance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workflow_outbox" (
    "id" BIGSERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "instance_id" INTEGER,
    "kind" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "workflow_outbox_status_enum" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_definitions_published_version_id_key" ON "workflow_definitions"("published_version_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_definitions_store_id_status_idx" ON "workflow_definitions"("store_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_definitions_organization_id_idx" ON "workflow_definitions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_definitions_store_id_key_key" ON "workflow_definitions"("store_id", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_versions_store_id_idx" ON "workflow_versions"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_versions_definition_id_version_key" ON "workflow_versions"("definition_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "work_groups_store_id_key_key" ON "work_groups"("store_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "work_groups_store_id_name_key" ON "work_groups"("store_id", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "work_group_members_store_id_user_id_idx" ON "work_group_members"("store_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "work_group_members_work_group_id_user_id_key" ON "work_group_members"("work_group_id", "user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_instances_store_id_definition_id_status_current_st_idx" ON "workflow_instances"("store_id", "definition_id", "status", "current_stage_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_instances_store_id_status_stage_due_at_idx" ON "workflow_instances"("store_id", "status", "stage_due_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_instances_store_id_subject_type_subject_id_idx" ON "workflow_instances"("store_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_instances_store_id_reference_key" ON "workflow_instances"("store_id", "reference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_tasks_store_id_assignee_user_id_status_due_at_idx" ON "workflow_tasks"("store_id", "assignee_user_id", "status", "due_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_tasks_store_id_assignee_group_id_status_idx" ON "workflow_tasks"("store_id", "assignee_group_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_tasks_store_id_assignee_role_id_status_idx" ON "workflow_tasks"("store_id", "assignee_role_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_tasks_instance_id_stage_key_stage_entry_seq_idx" ON "workflow_tasks"("instance_id", "stage_key", "stage_entry_seq");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_task_votes_store_id_idx" ON "workflow_task_votes"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_task_votes_task_id_user_id_key" ON "workflow_task_votes"("task_id", "user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_instance_events_store_id_occurred_at_idx" ON "workflow_instance_events"("store_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_instance_events_instance_id_seq_key" ON "workflow_instance_events"("instance_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_instance_events_store_id_idempotency_key_key" ON "workflow_instance_events"("store_id", "idempotency_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_outbox_status_available_at_idx" ON "workflow_outbox"("status", "available_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_outbox_store_id_instance_id_idx" ON "workflow_outbox"("store_id", "instance_id");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_definitions_organization_id_fkey') THEN
    ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_definitions_store_id_fkey') THEN
    ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_definitions_created_by_user_id_fkey') THEN
    ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_definitions_updated_by_user_id_fkey') THEN
    ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_definitions_published_version_id_fkey') THEN
    ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "workflow_versions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_versions_store_id_fkey') THEN
    ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_versions_definition_id_fkey') THEN
    ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_versions_published_by_user_id_fkey') THEN
    ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_groups_organization_id_fkey') THEN
    ALTER TABLE "work_groups" ADD CONSTRAINT "work_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_groups_store_id_fkey') THEN
    ALTER TABLE "work_groups" ADD CONSTRAINT "work_groups_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_group_members_store_id_fkey') THEN
    ALTER TABLE "work_group_members" ADD CONSTRAINT "work_group_members_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_group_members_work_group_id_fkey') THEN
    ALTER TABLE "work_group_members" ADD CONSTRAINT "work_group_members_work_group_id_fkey" FOREIGN KEY ("work_group_id") REFERENCES "work_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_group_members_user_id_fkey') THEN
    ALTER TABLE "work_group_members" ADD CONSTRAINT "work_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instances_organization_id_fkey') THEN
    ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instances_store_id_fkey') THEN
    ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instances_definition_id_fkey') THEN
    ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instances_version_id_fkey') THEN
    ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_tasks_organization_id_fkey') THEN
    ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_tasks_store_id_fkey') THEN
    ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_tasks_instance_id_fkey') THEN
    ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "workflow_instances"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_tasks_assignee_group_id_fkey') THEN
    ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_assignee_group_id_fkey" FOREIGN KEY ("assignee_group_id") REFERENCES "work_groups"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_task_votes_store_id_fkey') THEN
    ALTER TABLE "workflow_task_votes" ADD CONSTRAINT "workflow_task_votes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_task_votes_task_id_fkey') THEN
    ALTER TABLE "workflow_task_votes" ADD CONSTRAINT "workflow_task_votes_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "workflow_tasks"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_task_votes_user_id_fkey') THEN
    ALTER TABLE "workflow_task_votes" ADD CONSTRAINT "workflow_task_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instance_events_store_id_fkey') THEN
    ALTER TABLE "workflow_instance_events" ADD CONSTRAINT "workflow_instance_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instance_events_instance_id_fkey') THEN
    ALTER TABLE "workflow_instance_events" ADD CONSTRAINT "workflow_instance_events_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "workflow_instances"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_outbox_store_id_fkey') THEN
    ALTER TABLE "workflow_outbox" ADD CONSTRAINT "workflow_outbox_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
