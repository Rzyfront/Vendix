-- DATA IMPACT:
-- Tables affected: lodging_room_nights gains the nullable column posted_order_item_id.
-- Expected row changes: none. Existing nights keep NULL (not posted yet).
-- Destructive operations: none.
-- FK/cascade risk: none. The new FK uses ON DELETE RESTRICT; no incoming FK changes.
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS and a guarded constraint.
-- Approval: hospitality plan, slice H3.4 (owner decisions 2026-10-26).

-- H3.4: the folio line that charged the night. NULL = not posted; set once, so
-- posting the same night twice never adds a second line.
ALTER TABLE "lodging_room_nights" ADD COLUMN IF NOT EXISTS "posted_order_item_id" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_room_nights_posted_order_item_id_key"
  ON "lodging_room_nights"("posted_order_item_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_room_nights_posted_order_item_id_fkey') THEN
    ALTER TABLE "lodging_room_nights" ADD CONSTRAINT "lodging_room_nights_posted_order_item_id_fkey"
      FOREIGN KEY ("posted_order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
