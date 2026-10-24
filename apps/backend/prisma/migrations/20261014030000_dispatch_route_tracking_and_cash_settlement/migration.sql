-- DATA IMPACT: none — migración aditiva (tabla nueva + 3 columnas nullable). Sin mutación de filas.
-- Tables affected: dispatch_route_positions (new), dispatch_routes (3 nullable columns)
-- Destructive operations: none
-- Idempotency: table, columns, indexes and FKs are guarded.

CREATE TABLE IF NOT EXISTS "dispatch_route_positions" (
  "id" BIGSERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "route_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "lat" DECIMAL(10,7) NOT NULL,
  "lng" DECIMAL(10,7) NOT NULL,
  "accuracy" DECIMAL(8,2),
  "heading" DECIMAL(6,2),
  "speed" DECIMAL(8,2),
  "recorded_at" TIMESTAMP(6) NOT NULL,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_route_positions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "dispatch_routes"
  ADD COLUMN IF NOT EXISTS "settlement_cash_session_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "settlement_cash_user_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "cash_settled_at" TIMESTAMP(6);

CREATE INDEX IF NOT EXISTS "dispatch_route_positions_route_id_recorded_at_idx"
  ON "dispatch_route_positions"("route_id", "recorded_at");

CREATE INDEX IF NOT EXISTS "dispatch_route_positions_store_id_idx"
  ON "dispatch_route_positions"("store_id");

CREATE INDEX IF NOT EXISTS "dispatch_routes_settlement_cash_session_id_idx"
  ON "dispatch_routes"("settlement_cash_session_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_route_positions_store_id_fkey') THEN
    ALTER TABLE "dispatch_route_positions"
      ADD CONSTRAINT "dispatch_route_positions_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_route_positions_route_id_fkey') THEN
    ALTER TABLE "dispatch_route_positions"
      ADD CONSTRAINT "dispatch_route_positions_route_id_fkey"
      FOREIGN KEY ("route_id") REFERENCES "dispatch_routes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_route_positions_user_id_fkey') THEN
    ALTER TABLE "dispatch_route_positions"
      ADD CONSTRAINT "dispatch_route_positions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_routes_settlement_cash_session_id_fkey') THEN
    ALTER TABLE "dispatch_routes"
      ADD CONSTRAINT "dispatch_routes_settlement_cash_session_id_fkey"
      FOREIGN KEY ("settlement_cash_session_id") REFERENCES "cash_register_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_routes_settlement_cash_user_id_fkey') THEN
    ALTER TABLE "dispatch_routes"
      ADD CONSTRAINT "dispatch_routes_settlement_cash_user_id_fkey"
      FOREIGN KEY ("settlement_cash_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
