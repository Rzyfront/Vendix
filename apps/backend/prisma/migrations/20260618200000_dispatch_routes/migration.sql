-- =============================================================================
-- Migration: dispatch_routes (Planillas de Despacho / Rutas DSD con recaudo)
-- Created: 2026-06-18
-- Idempotent: yes
-- Notes:
--   * Adds vehicles, dispatch_routes, dispatch_route_stops, dispatch_route_stop_history
--   * Adds enums dispatch_route_status_enum, dispatch_route_stop_status_enum,
--     dispatch_route_stop_result_enum, vehicle_type_enum
--   * dispatch_route_stops has UNIQUE(dispatch_note_id) to enforce 1 planilla per
--     remisión (1-a-1 exclusivo)
-- =============================================================================

-- ─── ENUMS ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE dispatch_route_status_enum AS ENUM (
    'draft', 'dispatched', 'in_transit', 'settling', 'closed', 'voided'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dispatch_route_stop_status_enum AS ENUM (
    'pending', 'in_progress', 'delivered', 'partial', 'rejected', 'released'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dispatch_route_stop_result_enum AS ENUM (
    'delivered', 'partial', 'rejected', 'released'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vehicle_type_enum AS ENUM (
    'motorcycle', 'car', 'truck', 'van', 'bicycle', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── VEHICLES ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vehicles (
  id                  SERIAL PRIMARY KEY,
  store_id            INTEGER NOT NULL,
  plate               VARCHAR(20) NOT NULL,
  type                vehicle_type_enum NOT NULL DEFAULT 'truck',
  brand               VARCHAR(80),
  model_name          VARCHAR(80),
  capacity_kg         DECIMAL(10, 2),
  capacity_units      INTEGER,
  primary_driver_id   INTEGER,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  notes               TEXT,
  created_by_user_id  INTEGER,
  created_at          TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE vehicles
    ADD CONSTRAINT vehicles_store_id_plate_key UNIQUE (store_id, plate);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS vehicles_store_id_is_active_idx ON vehicles (store_id, is_active);
CREATE INDEX IF NOT EXISTS vehicles_primary_driver_id_idx ON vehicles (primary_driver_id);

-- ─── DISPATCH ROUTES ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dispatch_routes (
  id                          SERIAL PRIMARY KEY,
  store_id                    INTEGER NOT NULL,
  route_number                VARCHAR(50) NOT NULL,
  route_code                  VARCHAR(20),
  status                      dispatch_route_status_enum NOT NULL DEFAULT 'draft',
  vehicle_id                  INTEGER,
  driver_user_id              INTEGER,
  external_driver_name        VARCHAR(255),
  external_driver_id_number   VARCHAR(50),
  is_primary_driver_external  BOOLEAN NOT NULL DEFAULT FALSE,
  assistants                  JSONB,
  origin_location_id          INTEGER,
  planned_date                TIMESTAMP(6) NOT NULL,
  dispatch_started_at         TIMESTAMP(6),
  closed_at                   TIMESTAMP(6),
  voided_at                   TIMESTAMP(6),
  total_to_collect            DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_collected             DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_prepaid               DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_changes               DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_withholdings          DECIMAL(14, 2) NOT NULL DEFAULT 0,
  total_credit                DECIMAL(14, 2) NOT NULL DEFAULT 0,
  declared_cash               DECIMAL(14, 2),
  cash_variance               DECIMAL(14, 2),
  currency                    VARCHAR(10),
  notes                       TEXT,
  void_reason                 TEXT,
  dispatched_by_user_id       INTEGER,
  closed_by_user_id           INTEGER,
  voided_by_user_id           INTEGER,
  created_by_user_id          INTEGER,
  created_at                  TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE dispatch_routes
    ADD CONSTRAINT dispatch_routes_store_id_route_number_key UNIQUE (store_id, route_number);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS dispatch_routes_store_id_status_idx ON dispatch_routes (store_id, status);
CREATE INDEX IF NOT EXISTS dispatch_routes_store_id_planned_date_idx ON dispatch_routes (store_id, planned_date);
CREATE INDEX IF NOT EXISTS dispatch_routes_vehicle_id_idx ON dispatch_routes (vehicle_id);
CREATE INDEX IF NOT EXISTS dispatch_routes_driver_user_id_idx ON dispatch_routes (driver_user_id);

-- ─── DISPATCH ROUTE STOPS ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dispatch_route_stops (
  id                      SERIAL PRIMARY KEY,
  route_id                INTEGER NOT NULL,
  dispatch_note_id        INTEGER NOT NULL,
  stop_sequence           INTEGER NOT NULL,
  status                  dispatch_route_stop_status_enum NOT NULL DEFAULT 'pending',
  result                  dispatch_route_stop_result_enum,
  is_extra_route          BOOLEAN NOT NULL DEFAULT FALSE,
  is_prepaid              BOOLEAN NOT NULL DEFAULT FALSE,
  collected_amount        DECIMAL(14, 2) NOT NULL DEFAULT 0,
  anticipo_amount         DECIMAL(14, 2) NOT NULL DEFAULT 0,
  change_amount           DECIMAL(14, 2) NOT NULL DEFAULT 0,
  withholding_amount      DECIMAL(14, 2) NOT NULL DEFAULT 0,
  withholding_breakdown   JSONB,
  credit_amount           DECIMAL(14, 2) NOT NULL DEFAULT 0,
  payment_method          VARCHAR(40),
  notes                   TEXT,
  settled_at              TIMESTAMP(6),
  released_at             TIMESTAMP(6),
  settled_by_user_id      INTEGER,
  created_at              TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE dispatch_route_stops
    ADD CONSTRAINT dispatch_route_stops_dispatch_note_id_key UNIQUE (dispatch_note_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS dispatch_route_stops_route_id_stop_sequence_idx
  ON dispatch_route_stops (route_id, stop_sequence);
CREATE INDEX IF NOT EXISTS dispatch_route_stops_status_idx ON dispatch_route_stops (status);

-- ─── DISPATCH ROUTE STOP HISTORY ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dispatch_route_stop_history (
  id          SERIAL PRIMARY KEY,
  stop_id     INTEGER NOT NULL,
  action      VARCHAR(40) NOT NULL,
  from_status VARCHAR(40),
  to_status   VARCHAR(40),
  reason      TEXT,
  released_by INTEGER,
  metadata    JSONB,
  created_at  TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS dispatch_route_stop_history_stop_id_created_at_idx
  ON dispatch_route_stop_history (stop_id, created_at);
CREATE INDEX IF NOT EXISTS dispatch_route_stop_history_action_idx
  ON dispatch_route_stop_history (action);
