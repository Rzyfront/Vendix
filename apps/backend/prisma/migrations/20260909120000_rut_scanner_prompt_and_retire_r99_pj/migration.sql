-- =====================================================
-- rut_scanner: ampliación del prompt casilla 53 y retiro de R-99-PJ
-- =====================================================
-- DATA IMPACT:
-- - Tabla afectada 1: ai_engine_applications (UPDATE system_prompt donde key = 'rut_scanner')
-- - Tabla afectada 2: users (UPDATE fiscal_responsibilities reemplazando 'R-99-PJ' por 'R-99-PN')
-- - Tabla afectada 3: organizations (UPDATE fiscal_responsibilities reemplazando 'R-99-PJ' por 'R-99-PN')
-- - Tabla afectada 4: organization_settings (UPDATE settings->'fiscal_data' reemplazando 'R-99-PJ' por 'R-99-PN')
-- - Tabla afectada 5: store_settings (UPDATE settings->'fiscal_data' reemplazando 'R-99-PJ' por 'R-99-PN')
-- - Operaciones destructivas: NINGUNA. Sin DELETE / TRUNCATE / DROP / ALTER.
-- - Idempotencia: guardas condicionales en WHERE.
-- - Motivo: R-99-PJ fue un código ficticio que causaba contradicciones con el catálogo DIAN oficial.
--   El prompt de rut_scanner restringía indebidamente la extracción a 6 códigos descartando IVA y renta ordinaria.
-- =====================================================

BEGIN;

-- 1. Actualizar el system_prompt de rut_scanner solo si contiene la lista restrictiva vieja
UPDATE ai_engine_applications
SET system_prompt = replace(
      system_prompt,
      $old$12. "tax_responsibilities" (box 53 "Responsabilidades"): return ONLY the RUT codes present, from this set: "R-99-PN", "O-13", "O-15", "O-23", "O-47", "R-99-PJ". Ignore any responsibility code not in this set. Empty array if none visible.
13. "tax_scheme": the issuer's primary/most relevant responsibility, as a single RUT code from the same set (e.g. "O-13"). Use "" if none.$old$,
      $new$12. "tax_responsibilities" (box 53 "Responsabilidades"): extract ALL 2-digit responsibility numbers printed in box 53 (e.g. "05", "13", "14", "48", "49", "52"). Return them formatted with the "O-" prefix (e.g. "O-05", "O-13", "O-48", "O-52") or as 2-digit numbers. For natural persons with no special tax responsibilities, use "R-99-PN". Never return "R-99-PJ". Empty array if none visible.
13. "tax_scheme": the issuer's primary or most relevant responsibility code (e.g. "O-48", "O-05", "O-13", "O-47", or "R-99-PN"). Use "" if none.$new$
    ),
    updated_at = NOW()
WHERE key = 'rut_scanner'
  AND system_prompt LIKE '%return ONLY the RUT codes present, from this set%';

-- 2. users: Reemplazar R-99-PJ por R-99-PN en fiscal_responsibilities
UPDATE users
SET fiscal_responsibilities = array_replace(fiscal_responsibilities, 'R-99-PJ', 'R-99-PN')
WHERE 'R-99-PJ' = ANY (fiscal_responsibilities);

-- 3. organizations: Reemplazar R-99-PJ por R-99-PN en fiscal_responsibilities
UPDATE organizations
SET fiscal_responsibilities = array_replace(fiscal_responsibilities, 'R-99-PJ', 'R-99-PN')
WHERE 'R-99-PJ' = ANY (fiscal_responsibilities);

-- 4. organization_settings: Reemplazar R-99-PJ por R-99-PN en fiscal_data->tax_responsibilities
UPDATE organization_settings
SET settings = jsonb_set(
  settings,
  '{fiscal_data,tax_responsibilities}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN elem::text = '"R-99-PJ"' THEN '"R-99-PN"'::jsonb
        ELSE elem
      END
    )
    FROM jsonb_array_elements(settings->'fiscal_data'->'tax_responsibilities') AS elem
  )
)
WHERE settings->'fiscal_data'->'tax_responsibilities' @> '["R-99-PJ"]'::jsonb;

-- 5. store_settings: Reemplazar R-99-PJ por R-99-PN en fiscal_data->tax_responsibilities
UPDATE store_settings
SET settings = jsonb_set(
  settings,
  '{fiscal_data,tax_responsibilities}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN elem::text = '"R-99-PJ"' THEN '"R-99-PN"'::jsonb
        ELSE elem
      END
    )
    FROM jsonb_array_elements(settings->'fiscal_data'->'tax_responsibilities') AS elem
  )
)
WHERE settings->'fiscal_data'->'tax_responsibilities' @> '["R-99-PJ"]'::jsonb;

-- 6. Corregir tax_scheme si estaba fijado en R-99-PJ
UPDATE organization_settings
SET settings = jsonb_set(
  settings,
  '{fiscal_data,tax_scheme}',
  '"R-99-PN"'::jsonb
)
WHERE settings->'fiscal_data'->>'tax_scheme' = 'R-99-PJ';

UPDATE store_settings
SET settings = jsonb_set(
  settings,
  '{fiscal_data,tax_scheme}',
  '"R-99-PN"'::jsonb
)
WHERE settings->'fiscal_data'->>'tax_scheme' = 'R-99-PJ';

-- 7. (ELIMINADO — guarda imposible: los pasos 2-5 ya reemplazaron 'R-99-PJ'
-- por 'R-99-PN' en organizations y en fiscal_data, así que la condición
-- 'R-99-PJ' = ANY (o.fiscal_responsibilities) nunca matchea y el UPDATE era
-- un no-op. Los pasos 3 y 4 aplican el mismo mapeo a ambos lados del espejo,
-- por lo que las filas afectadas quedan en sync sin este paso. Derivas
-- preexistentes no relacionadas con R-99-PJ están fuera del alcance de A.3.)

COMMIT;
