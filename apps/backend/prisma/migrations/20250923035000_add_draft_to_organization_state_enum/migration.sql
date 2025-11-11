-- Separate migration to add 'draft' to organization_state_enum before it's used elsewhere
-- This avoids P3006 by committing the new enum value first.

DO $$
BEGIN
    -- Check if the value 'draft' already exists to avoid duplicate label error
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'organization_state_enum'
          AND e.enumlabel = 'draft'
    ) THEN
        ALTER TYPE "public"."organization_state_enum" ADD VALUE 'draft';
    END IF;
END $$;