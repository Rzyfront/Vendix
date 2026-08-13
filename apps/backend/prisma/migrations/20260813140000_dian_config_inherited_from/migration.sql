-- QUI-679 review fix #6 — distinguish "cert uploaded by user" from
-- "cert copied from a sibling row of the same accounting_entity_id".
--
-- The cert COPY happens in `DianConfigService.create()` /
-- `OrgDianConfigService.create()` (`findInheritableCertificate`). Until now
-- both rows carried `certificate_source = 'manual_upload_validated'`, so an
-- audit query could not tell them apart and the wizard banner could not be
-- restored on wizard revisit.
--
-- We add a SELF-FK `inherited_from_dian_configuration_id` instead of a new
-- `certificate_source_enum` value. Adding a value to an enum is technically
-- idempotent but it also forces every consumer that reads the column to
-- think about the new state; a nullable FK is the additive minimum and
-- carries the source id, which the enum value wouldn't.
--
-- DATA IMPACT:
-- Tables affected: dian_configurations
-- Expected row changes: NINGUNO. La columna es nullable sin DEFAULT — toda fila
--   histórica queda en NULL, que es la semántica correcta ("este cert lo subió
--   el usuario, no lo heredó nadie"). No se reescribe ni una fila a mano.
-- Destructive operations: none. No DROP, no TRUNCATE, no DELETE, no ALTER de
--   enums existentes (certificate_source_enum queda intacto a propósito).
-- FK/cascade risk: SELF-FK con ON DELETE SET NULL. Borrar la fila fuente
--   elimina el puntero de las herederas pero NO las borra a ellas (cada
--   heredora tiene SU PROPIA copia del .p12 en S3 y SU PROPIA
--   enablement_status; una cascade aquí sería catastrófico). La decisión
--   está documentada en el comentario del schema.
-- Idempotency: IF NOT EXISTS sobre pg_constraint, idempotente.
-- Approval: QUI-679 review fix #6, firmado en plan docs/plans/fiscal-dian-4-tickets-batch.md.
-- Skill: vendix-prisma-migrations (regla 7 anti-destructiva, regla 5 idempotencia).

ALTER TABLE "dian_configurations"
  ADD COLUMN IF NOT EXISTS "inherited_from_dian_configuration_id" INTEGER;

-- Self-FK con ON DELETE SET NULL. Ver nota en el header: borrar la fila fuente
-- NO debe borrar a las herederas — sólo les quita el puntero.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dian_configurations_inherited_from_dian_configuration_id_fkey'
  ) THEN
    ALTER TABLE "dian_configurations"
      ADD CONSTRAINT "dian_configurations_inherited_from_dian_configuration_id_fkey"
      FOREIGN KEY ("inherited_from_dian_configuration_id")
      REFERENCES "dian_configurations"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- Index para los joins del banner ("esta config heredó de quién") y para las
-- queries de auditoría que quieren listar herederas de una fila concreta
-- antes de borrarla.
CREATE INDEX IF NOT EXISTS "dian_configurations_inherited_from_dian_configuration_id_idx"
  ON "dian_configurations" ("inherited_from_dian_configuration_id");
