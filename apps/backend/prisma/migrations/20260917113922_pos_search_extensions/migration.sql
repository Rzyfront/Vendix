-- DATA IMPACT:
-- Tables affected: ninguna (solo pg_extension + 1 funcion)
-- Expected row changes: 0
-- Destructive operations: ninguna
-- FK/cascade risk: ninguno
-- Idempotency: CREATE EXTENSION IF NOT EXISTS + CREATE OR REPLACE FUNCTION — re-ejecutable sin error
-- Reversibility: DROP FUNCTION IF EXISTS public.immutable_unaccent(text); DROP EXTENSION IF EXISTS unaccent; DROP EXTENSION IF EXISTS pg_trgm; (solo si nada los referencia)
-- Approval: plan critico CP-pos-smart-search, paso C.1 — checkpoint E.2 TRIGRAM firmado 2026-09-17
-- Scope: C.1 — extensiones Fase B (pg_trgm + unaccent) + wrapper IMMUTABLE con ñ/Ñ preservadas (F-079).
--   Aditiva: codigo viejo + DB nueva es seguro (TRIGRAM default-off + capability guard F-049).
--   Orden deploy: esta migracion ANTES que el codigo C.3 (F-050).

-- ---------------------------------------------------------------------------
-- CP-pos-smart-search · C.1 — pg_trgm + unaccent + immutable_unaccent
--
-- `CREATE EXTENSION IF NOT EXISTS` sigue el patron repo (pgcrypto en
-- 20260428004051, vector en 20260326030000). Sin CONCURRENTLY aqui: las
-- extensiones y la funcion no tocan tablas de negocio; el CONCURRENTLY vive
-- en C.2 (GIN sobre products).
--
-- El wrapper existe por dos razones:
--   1) `unaccent()` es STABLE (lee su diccionario); marcar el wrapper
--      IMMUTABLE es la asercion estandar que permite usarlo en expresiones
--      de indice (C.2) y en predicados estables del raw C.3. Con el
--      diccionario fijo 'unaccent' el resultado es efectivamente inmutable.
--   2) F-079: el unaccent default colapsa ñ→n (`nino` matchearia "Niño Dios").
--      El wrapper protege ñ/Ñ con placeholders PUA (U+E000/U+E001, sin reglas
--      en el diccionario: unaccent los deja intactos) y los restaura despues.
--      Paridad JS (A.1 `normalizeSearchText`, fixture C.3): minusculas,
--      sin acentos, ñ preservada; la ñ DESCOMPUESTA (n+U+0303) pliega a 'n'
--      en ambos lados (JS la pierde en el NFD, SQL en el unaccent).
--
-- El llamador aplica `lower()` (C.3): el wrapper preserva caja a proposito
-- para que `immutable_unaccent('AÑO') = 'AÑO'` y el lower lo decida el query.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
AS $func$
  SELECT replace(
    replace(
      unaccent(
        'unaccent'::regdictionary,
        replace(replace($1, 'ñ', chr(57344)), 'Ñ', chr(57345))
      ),
      chr(57344),
      'ñ'
    ),
    chr(57345),
    'Ñ'
  )
$func$;

COMMENT ON FUNCTION public.immutable_unaccent(text) IS
  'CP-pos-smart-search C.1: unaccent IMMUTABLE con ñ/Ñ preservadas (F-079). El llamador aplica lower().';
