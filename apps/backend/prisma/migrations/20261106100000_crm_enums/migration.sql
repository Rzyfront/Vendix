-- CRM · M1 (PLAN-CRM §2.1, §3): enums del CRM.
--
-- DATA IMPACT:
--   Tables affected: ninguna (solo CREATE TYPE).
--   Expected row changes: 0. No DML.
--   Destructive operations: ninguna.
--   FK/cascade risk: ninguno.
--   Idempotency: cada CREATE TYPE va protegido por pg_type; reejecutar no cambia nada.
--   Approval: PLAN-CRM PR 1, decisiones de Rafael (2026-10-31).

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_conversation_status_enum') THEN
    CREATE TYPE "crm_conversation_status_enum" AS ENUM ('open', 'pending', 'snoozed', 'closed');
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_message_direction_enum') THEN
    CREATE TYPE "crm_message_direction_enum" AS ENUM ('inbound', 'outbound');
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_message_status_enum') THEN
    CREATE TYPE "crm_message_status_enum" AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed', 'received');
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_message_channel_enum') THEN
    CREATE TYPE "crm_message_channel_enum" AS ENUM ('whatsapp', 'sms', 'email', 'internal_note');
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_task_status_enum') THEN
    CREATE TYPE "crm_task_status_enum" AS ENUM ('pending', 'done', 'cancelled');
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_opportunity_status_enum') THEN
    CREATE TYPE "crm_opportunity_status_enum" AS ENUM ('open', 'won', 'lost');
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_campaign_status_enum') THEN
    CREATE TYPE "crm_campaign_status_enum" AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed');
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_contact_consent_enum') THEN
    CREATE TYPE "crm_contact_consent_enum" AS ENUM ('unknown', 'opted_in', 'opted_out');
  END IF;
END $$;
