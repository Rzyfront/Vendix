-- Migrate existing data_collection_responses to entity_metadata_values
-- This copies any response data that hasn't already been persisted to the canonical metadata store.
-- The data_collection_responses table is NOT dropped — kept for rollback safety.

INSERT INTO entity_metadata_values (store_id, field_id, entity_type, entity_id, value_text, value_number, value_date, value_bool, value_json, created_at, updated_at)
SELECT
  s.store_id,
  r.field_id,
  f.entity_type,
  CASE
    WHEN f.entity_type = 'customer' THEN s.customer_id
    WHEN f.entity_type = 'booking' THEN s.booking_id
    WHEN f.entity_type = 'order' THEN b.order_id
  END AS entity_id,
  r.value_text,
  r.value_number,
  r.value_date,
  r.value_bool,
  r.value_json,
  r.created_at,
  r.updated_at
FROM data_collection_responses r
JOIN data_collection_submissions s ON r.submission_id = s.id
JOIN entity_metadata_fields f ON r.field_id = f.id
LEFT JOIN bookings b ON s.booking_id = b.id
WHERE
  -- Only rows where we can resolve the entity_id
  CASE
    WHEN f.entity_type = 'customer' THEN s.customer_id IS NOT NULL
    WHEN f.entity_type = 'booking' THEN s.booking_id IS NOT NULL
    WHEN f.entity_type = 'order' THEN b.order_id IS NOT NULL
    ELSE false
  END
ON CONFLICT (field_id, entity_type, entity_id) DO NOTHING;
