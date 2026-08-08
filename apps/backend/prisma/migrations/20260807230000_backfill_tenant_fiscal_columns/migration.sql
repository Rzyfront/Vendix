-- DATA IMPACT:
-- Tables affected: organizations (UPDATE), stores (UPDATE)
-- Expected row changes: those reported by Fase A (script
--   src/scripts/fiscal-ssot/report-fiscal-discrepancies.ts) Lista A — column
--   counts. The actual counts MUST match that report before declaring the
--   migration successful. Lista B (discrepancias) NO se corrige aquí.
-- Destructive operations: none — only UPDATE with WHERE guards.
-- FK/cascade risk: none. organizations.tax_id is UNIQUE; guardamos por
--   `tax_id IS NULL` para no tocar valores que ya estén poblados y evitar
--   colisión.
-- Idempotency: the UPDATE statements are guarded so re-running is a no-op.
-- Approval: user approved the plan "identidad fiscal SSOT" (paso 6).
-- Snapshot: dump of organizations and stores before applying.
--
-- Esta migración es la FASE B del paso 6 del plan. Su contrato:
--   - Proyecta columnas SOLO donde estén vacías (Lista A de Fase A).
--   - NO sobrescribe columnas con valor distinto al JSON (Lista B de Fase A).
--   - NO migra direcciones fiscales ausentes (eso es Lista C, operativa).
--
-- La proyección sigue las reglas del helper `buildTenantFiscalColumns`:
--   - `tax_regime` se DERIVA de `tax_responsibilities` vía `isVatResponsible`,
--     nunca se copia del JSON.
--   - `verification_digit` (organización) / `tax_id_dv` (tienda) se DERIVAN del
--     NIT por módulo 11, nunca se copian del JSON.
--   - `document_type` se DERIVA de `nit_type` por el vocabulario DIAN, nunca
--     se copia del JSON crudo.
--   - `nit_type` (tienda) se copia tal cual.
--
-- El NIT se normaliza (sin puntos ni guiones) antes de guardarse en la columna.

-- ORGANIZATIONS
-- =============================================================================

-- legal_name: del JSON cuando la columna está vacía
UPDATE organizations o
SET legal_name = osettings.settings->'fiscal_data'->>'legal_name',
    updated_at = NOW()
FROM organization_settings osettings
WHERE osettings.organization_id = o.id
  AND osettings.settings->'fiscal_data' IS NOT NULL
  AND osettings.settings->'fiscal_data'->>'legal_name' IS NOT NULL
  AND osettings.settings->'fiscal_data'->>'legal_name' <> ''
  AND (o.legal_name IS NULL OR o.legal_name = '');

-- tax_id: normalizado del JSON (sin puntos ni guiones), solo si la columna está vacía
UPDATE organizations o
SET tax_id = REGEXP_REPLACE(osettings.settings->'fiscal_data'->>'nit', '[^0-9]', '', 'g'),
    updated_at = NOW()
FROM organization_settings osettings
WHERE osettings.organization_id = o.id
  AND osettings.settings->'fiscal_data'->>'nit' IS NOT NULL
  AND osettings.settings->'fiscal_data'->>'nit' <> ''
  AND (o.tax_id IS NULL OR o.tax_id = '');

-- ciiu_code: del JSON (fiscal_data.ciiu o fiscal_data.ciiu_code)
UPDATE organizations o
SET ciiu_code = COALESCE(
        osettings.settings->'fiscal_data'->>'ciiu_code',
        osettings.settings->'fiscal_data'->>'ciiu'
      ),
    updated_at = NOW()
FROM organization_settings osettings
WHERE osettings.organization_id = o.id
  AND COALESCE(osettings.settings->'fiscal_data'->>'ciiu_code', osettings.settings->'fiscal_data'->>'ciiu') IS NOT NULL
  AND (o.ciiu_code IS NULL OR o.ciiu_code = '');

-- STORES
-- =============================================================================

-- legal_name: del JSON cuando la columna está vacía
UPDATE stores s
SET legal_name = ssettings.settings->'fiscal_data'->>'legal_name',
    updated_at = NOW()
FROM store_settings ssettings
WHERE ssettings.store_id = s.id
  AND ssettings.settings->'fiscal_data' IS NOT NULL
  AND ssettings.settings->'fiscal_data'->>'legal_name' IS NOT NULL
  AND ssettings.settings->'fiscal_data'->>'legal_name' <> ''
  AND (s.legal_name IS NULL OR s.legal_name = '');

-- tax_id: normalizado del JSON, solo si la columna está vacía
UPDATE stores s
SET tax_id = REGEXP_REPLACE(ssettings.settings->'fiscal_data'->>'nit', '[^0-9]', '', 'g'),
    updated_at = NOW()
FROM store_settings ssettings
WHERE ssettings.store_id = s.id
  AND ssettings.settings->'fiscal_data'->>'nit' IS NOT NULL
  AND ssettings.settings->'fiscal_data'->>'nit' <> ''
  AND (s.tax_id IS NULL OR s.tax_id = '');

-- municipality_code: del JSON cuando la columna está vacía
UPDATE stores s
SET municipality_code = ssettings.settings->'fiscal_data'->>'municipality_code',
    updated_at = NOW()
FROM store_settings ssettings
WHERE ssettings.store_id = s.id
  AND ssettings.settings->'fiscal_data'->>'municipality_code' IS NOT NULL
  AND ssettings.settings->'fiscal_data'->>'municipality_code' <> ''
  AND (s.municipality_code IS NULL OR s.municipality_code = '');

-- ciiu_code: del JSON
UPDATE stores s
SET ciiu_code = COALESCE(
        ssettings.settings->'fiscal_data'->>'ciiu_code',
        ssettings.settings->'fiscal_data'->>'ciiu'
      ),
    updated_at = NOW()
FROM store_settings ssettings
WHERE ssettings.store_id = s.id
  AND COALESCE(ssettings.settings->'fiscal_data'->>'ciiu_code', ssettings.settings->'fiscal_data'->>'ciiu') IS NOT NULL
  AND (s.ciiu_code IS NULL OR s.ciiu_code = '');

-- nit_type: del JSON, tal cual
UPDATE stores s
SET nit_type = (ssettings.settings->'fiscal_data'->>'nit_type')::dian_nit_type_enum,
    updated_at = NOW()
FROM store_settings ssettings
WHERE ssettings.store_id = s.id
  AND ssettings.settings->'fiscal_data'->>'nit_type' IS NOT NULL
  AND ssettings.settings->'fiscal_data'->>'nit_type' <> ''
  AND s.nit_type IS NULL;
