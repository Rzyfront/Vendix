-- DATA IMPACT:
-- Tables affected: organization_settings (1 row, 4 guarded UPDATEs),
--   organizations (1 row, 3 guarded UPDATEs), addresses (1 row, 2 guarded UPDATEs)
-- Expected row changes: exactly 3 distinct rows, all belonging to organization 1
--   (la plataforma). No other tenant is touched. 9 statements, one per field.
-- Destructive operations: none — only UPDATE with per-field value-fingerprint guards.
-- FK/cascade risk: none. No FK is added, dropped or repointed. The `addresses`
--   row is UPDATED in place (never deleted and recreated) so the FKs that point
--   at it keep resolving.
-- Idempotency: every UPDATE is guarded by the CURRENT (wrong) value of the SAME
--   field it writes, so a second run matches nothing and is a no-op. The guard
--   also means the migration cannot clobber a value that somebody already
--   corrected by another route.
-- Approval: user supplied the official RUT (form 141245852853, issued
--   2026-04-15) as the authoritative source, explicitly confirmed it is the
--   version currently in force, approved the fiscal-responsibilities change, and
--   chose to keep the operational email.
-- Snapshot: read-only snapshot of all 9 target fields taken against production
--   immediately before writing this file. Verified values are quoted in each
--   guard below, so every guard cites a measured value, not a supposed one.
--
-- HISTORIA — se aplicó a medias una vez, y esto importa para releerla:
--   El primer intento (2026-08-08 19:06 UTC, deploy de 801f1c409) falló en la
--   sentencia 3a con `42703: column "updated_at" of relation "addresses" does
--   not exist`. Prisma NO envuelve el archivo en una transacción, así que las
--   siete primeras sentencias commitearon y las dos de `addresses` no. La fila de
--   `_prisma_migrations` quedó con `finished_at NULL` y `applied_steps_count 0`
--   —engañoso: ese contador solo avanza al terminar bien— bloqueando todo deploy
--   posterior. Recuperado con `migrate resolve --rolled-back` + reintento.
--
--   El dry-run original no lo detectó porque construía la base desechable con un
--   `CREATE TABLE addresses` escrito a mano, con un `updated_at` que la tabla real
--   no tiene: probó una ficción. El dry-run correcto usa el esquema real
--   (`pg_dump --schema-only` de las tres tablas), no uno transcrito.
--
--   El reintento es seguro precisamente por las guardas por campo: las siete
--   sentencias ya aplicadas no casan su guarda y quedan en no-op, y solo las dos
--   de `addresses` escriben. Con una guarda compartida, el reintento habría
--   saltado también las correcciones de `fiscal_data`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EXISTE
--
-- El trabajo de fuente única dejó las copias sincronizadas, y eso destapó el
-- problema siguiente: estaban sincronizadas en el valor EQUIVOCADO. Consistencia
-- no es corrección. El proyector garantiza que todas las copias digan lo mismo;
-- que lo que digan sea verdad solo lo garantiza el documento oficial.
--
-- Contraste del RUT 141245852853 contra producción (medido, no inferido):
--
--   campo                RUT (casilla)              producción      veredicto
--   ──────────────────   ────────────────────────   ─────────────   ─────────
--   NIT + DV             902056589 · 9 (5, 6)       igual           OK
--   razón social         QUICKSS S.A.S. … (35)      igual           OK
--   dirección            CALLE 14H 26 13 (41)       igual           OK
--   ciudad / depto       Riohacha · La Guajira      igual           OK
--   municipio            44 + 001 = 44001 (39, 40)  44847           MAL
--   CIIU principal       6201 (46)                  6209            MAL
--   responsabilidades    O-05 O-07 O-14 O-42 O-48   O-13, O-47      MAL
--                        (53)
--   teléfono             3234668500 (44)            +57-1-1234567   MAL
--
-- 1. MUNICIPIO. `44847` es URIBIA; Riohacha es `44001`. El RUT lo parte en dos
--    casillas: 39 departamento = 44, 40 municipio = 001. Ambos códigos son
--    sintácticamente válidos y del mismo departamento, así que sin un catálogo
--    DIVIPOLA los dos son igual de plausibles — por eso este defecto sobrevivió
--    a la revisión del código y solo cayó al contrastar contra el papel.
--
-- 2. CIIU. `6209` es la actividad SECUNDARIA (casilla 48). La principal es
--    `6201` (casilla 46). Se corrigen las DOS claves del JSON: el resolvedor
--    prefiere `ciiu` (fiscal-identity.helper.ts:256) y el proyector de columnas
--    lee `ciiu_code` (organization-fiscal-columns.helper.ts:152), así que dejar
--    una sin tocar haría que resolvedor y columnas declararan distinto.
--
-- 3. RESPONSABILIDADES. Es el peor de los tres. `O-13` es gran contribuyente y
--    `O-47` régimen simple; el RUT no declara ninguna de las dos, y las cinco
--    que sí declara no estaban en ningún lado. Esto alimenta `cbc:TaxLevelCode`,
--    que la DIAN confronta contra el RUT del NIT del mismo documento (regla
--    FAJ26, «responsabilidad informada por emisor no válido según lista»). Los
--    50 documentos del set de pruebas declararon `O-13`.
--
--    Nota sobre el gate pre-deploy: reportó `O-13` → `O-13;O-47` como la mejora
--    del release anterior. Era estructuralmente correcto —unir las
--    responsabilidades declaradas con punto y coma— pero iba de un valor falso a
--    dos valores falsos. Ninguna verificación sobre el código detecta un dato
--    inventado en el JSON; solo lo detecta el documento oficial.
--
--    `tax_scheme` (singular, legado) se corrige en vez de eliminarse: lo lee
--    `fiscal-status.service.ts:428` para el checklist y `fiscal-identity.helper.ts:163`
--    como tercer respaldo, así que borrarlo rompería el checklist. Queda con la
--    primera responsabilidad del RUT, coherente con el array. Es un campo que
--    debería retirarse cuando el array sea el único contrato.
--
-- 4. `tax_regime` NO se toca. Sigue siendo 'COMUN' / '48' (responsable de IVA),
--    que es correcto: el RUT declara O-05 (renta régimen ordinario) y O-48 (IVA).
--    Antes se llegaba a '48' por el respaldo de `tax_regime: COMUN`; con O-48 ya
--    en el array, `isVatResponsible` lo resuelve por la señal explícita. Misma
--    respuesta, ahora por el camino correcto.
--
-- 5. EMAIL: no se toca por decisión del usuario. `admin@vendix.com` es el
--    contacto operativo y se conserva, aunque el RUT registre
--    RzYFRONT@GMAIL.COM en la casilla 42.
--
-- 6. TELÉFONO: se corrige a `3234668500` (casilla 44). Se escribe en los DOS
--    sitios que el resolvedor consulta, en su orden de precedencia
--    (`fiscal-identity.helper.ts:181-184`): primero `addresses.phone_number` de
--    la fila fiscal, después `organizations.phone` como respaldo. Dejar solo uno
--    haría que el teléfono impreso dependiera de si la fila de dirección existe.
--    Medido en producción: `organizations.phone` = '+57-1-1234567' (semilla),
--    `addresses.phone_number` = NULL — de ahí que sus guardas difieran.
--
--    NO se añade `phone` a `fiscal_data`: el resolvedor no lee esa clave, así que
--    sería un dato muerto que invita a divergir. La casilla 44 está en la sección
--    UBICACIÓN del RUT, o sea es el teléfono del domicilio fiscal — que es
--    exactamente lo que `addresses.phone_number` representa.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ UNA GUARDA POR CAMPO Y NO UNA POR SENTENCIA
--
-- La primera versión de este archivo agrupaba los cinco campos de `fiscal_data`
-- bajo una sola guarda (la del municipio). Eso acopla su idempotencia: si el
-- municipio ya estuviera corregido por otra vía —el wizard, o el proyector de
-- dirección— la guarda no casaría y se caerían los CINCO, dejando
-- `tax_responsibilities` en el valor falso. Y la sentencia de columnas, con
-- guarda propia, sí correría: columnas con la verdad del RUT, JSON con la
-- mentira, y el resolvedor da precedencia al JSON.
--
-- Los campos son independientes, así que sus guardas deben serlo. Cada UPDATE
-- se guarda por el valor actual del MISMO campo que escribe. Consecuencia
-- deseada: desde cualquier estado intermedio, cada campo converge a su valor del
-- RUT por separado, y ninguna corrección previa ajena se pisa.
--
-- `ciiu` y `ciiu_code` también van separados. Deben acabar VALIENDO lo mismo
-- (dos consumidores distintos los leen), y guardas independientes son
-- precisamente lo que lo garantiza desde un estado en el que ya divergieran.
--
-- La fila de `addresses` se acota por huella de valor y no por `id`: hay
-- exactamente una fila `type='billing'` para la organización 1 (verificado
-- contra producción, id 770), y un `id` cableado sería un no-op silencioso en
-- cualquier entorno donde la secuencia haya corrido distinto.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── fiscal_data (la fuente única) ────────────────────────────────────────────

-- 1a. Municipio DIAN: 44847 (Uribia) → 44001 (Riohacha).
UPDATE organization_settings
   SET settings = jsonb_set(settings, '{fiscal_data,municipality_code}',
                            '"44001"'::jsonb, true),
       updated_at = now()
 WHERE organization_id = 1
   AND settings->'fiscal_data'->>'nit' = '902056589'
   AND settings->'fiscal_data'->>'municipality_code' = '44847';

-- 1b. CIIU principal, clave que lee el resolvedor.
UPDATE organization_settings
   SET settings = jsonb_set(settings, '{fiscal_data,ciiu}', '"6201"'::jsonb, true),
       updated_at = now()
 WHERE organization_id = 1
   AND settings->'fiscal_data'->>'nit' = '902056589'
   AND settings->'fiscal_data'->>'ciiu' = '6209';

-- 1c. CIIU principal, clave que lee el proyector de columnas.
UPDATE organization_settings
   SET settings = jsonb_set(settings, '{fiscal_data,ciiu_code}', '"6201"'::jsonb, true),
       updated_at = now()
 WHERE organization_id = 1
   AND settings->'fiscal_data'->>'nit' = '902056589'
   AND settings->'fiscal_data'->>'ciiu_code' = '6209';

-- 1d. Responsabilidades del RUT (casilla 53) + el legado `tax_scheme`, que es
--     derivado de ellas. Van juntos porque el segundo no tiene verdad propia:
--     es la primera responsabilidad del array. Guardado por el array, que es la
--     señal fuerte.
UPDATE organization_settings
   SET settings = jsonb_set(
                    jsonb_set(settings, '{fiscal_data,tax_responsibilities}',
                              to_jsonb(ARRAY['O-05','O-07','O-14','O-42','O-48']), true),
                    '{fiscal_data,tax_scheme}', '"O-05"'::jsonb, true),
       updated_at = now()
 WHERE organization_id = 1
   AND settings->'fiscal_data'->>'nit' = '902056589'
   AND settings->'fiscal_data'->'tax_responsibilities' = '["O-13","O-47"]'::jsonb;

-- ── columnas de organizations (proyección del mismo dato) ─────────────────────

-- 2a. CIIU.
UPDATE organizations
   SET ciiu_code = '6201', updated_at = now()
 WHERE id = 1 AND tax_id = '902056589' AND ciiu_code = '6209';

-- 2b. Responsabilidades.
UPDATE organizations
   SET fiscal_responsibilities = ARRAY['O-05','O-07','O-14','O-42','O-48'],
       updated_at = now()
 WHERE id = 1 AND tax_id = '902056589'
   AND fiscal_responsibilities = ARRAY['O-13','O-47'];

-- 2c. Teléfono de respaldo (segundo en la precedencia del resolvedor).
UPDATE organizations
   SET phone = '3234668500', updated_at = now()
 WHERE id = 1 AND tax_id = '902056589' AND phone = '+57-1-1234567';

-- ── la fila addresses de la dirección fiscal ─────────────────────────────────

-- 3a. Municipio. Se actualiza en sitio; no se borra ni se recrea, porque
--     `addresses` es referenciada por FK.
--
--     SIN `updated_at`: la tabla `addresses` NO TIENE esa columna. Sus columnas
--     son id, store_id, address_line1, address_line2, city, state_province,
--     country_code, postal_code, phone_number, type, is_primary, latitude,
--     longitude, organization_id, user_id, municipality_code. `organizations` y
--     `organization_settings` sí la tienen, de ahí la asimetría con los pasos 1 y 2.
--     No añadir `updated_at = now()` aquí: es lo que produjo el 42703.
UPDATE addresses
   SET municipality_code = '44001'
 WHERE organization_id = 1 AND type = 'billing'
   AND city = 'Riohacha' AND municipality_code = '44847';

-- 3b. Teléfono del domicilio fiscal (primero en la precedencia del resolvedor).
--     Guardado por IS NULL: en producción la columna está vacía, no con un valor
--     de semilla. Si alguien ya escribió un teléfono aquí, se respeta.
UPDATE addresses
   SET phone_number = '3234668500'
 WHERE organization_id = 1 AND type = 'billing'
   AND city = 'Riohacha' AND phone_number IS NULL;
