-- Drop legacy data_collection_responses table
-- Data was migrated to entity_metadata_values in 20260415000000
-- Table is no longer referenced in Prisma schema or application code
-- Its FK (field_id → entity_metadata_fields, ON DELETE RESTRICT) blocks field deletion

DROP TABLE IF EXISTS "data_collection_responses";
