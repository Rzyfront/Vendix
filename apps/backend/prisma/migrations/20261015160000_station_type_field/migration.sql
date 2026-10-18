-- AlterTable
ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "station_type" VARCHAR(32) NOT NULL DEFAULT 'carro';
