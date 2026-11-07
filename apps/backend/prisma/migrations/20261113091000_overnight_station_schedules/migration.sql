-- Estaciones fase 2 (S21): un bloque de horario de estación puede cruzar la medianoche
-- (end_time <= start_time = termina al día siguiente). El CHECK original exigía
-- start_time < end_time; se reemplaza por uno que solo valida el formato HH:MM.
--
-- DATA IMPACT:
-- Tables affected: service_station_schedules (constraint only)
-- Expected row changes: none
-- Destructive operations: none (the CHECK is relaxed, every existing row satisfies the new one)
-- FK/cascade risk: none
-- Idempotency: DROP CONSTRAINT IF EXISTS + guarded ADD (pg_constraint)
-- Approval: plan approved in chat (L9 "Ejecuta!"), assumption A6

ALTER TABLE "service_station_schedules" DROP CONSTRAINT IF EXISTS "service_station_schedules_time_check";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_station_schedules_time_format_check') THEN
    ALTER TABLE "service_station_schedules" ADD CONSTRAINT "service_station_schedules_time_format_check"
      CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
END $$;
