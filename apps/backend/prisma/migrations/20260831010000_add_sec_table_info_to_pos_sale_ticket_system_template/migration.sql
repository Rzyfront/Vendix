-- =====================================================================
-- Migration: add_sec_table_info_to_pos_sale_ticket_system_template (QUI-733)
-- Purpose: Cerrar el último eslabón de la cadena mesa/mesero en el recibo
--          POS. El provider (`pos-sale-ticket.provider.ts:285-291`) ya
--          puebla `document.table_number` y `document.waiter_name`, y el
--          compositor (`print-layout-composer.service.ts:96 + 787-813`)
--          ya sabe renderizar la sección `table_info` y se colapsa sola
--          cuando no hay mesa. Lo único que faltaba era declarar la
--          sección en la plantilla de sistema id=1.
--
--          Esta migración patchea la fila viva de `print_templates` con
--          `is_system=true AND format_type='pos_sale_ticket'`. Reordena
--          las secciones existentes (3,4,5,6 → 4,5,6,7) y agrega
--          `sec_table_info` en `order:3`, copiando EXACTAMENTE la forma
--          de `kitchen_ticket` (id=10) que sí muestra mesa/mesero desde
--          C.3.
--
--          El seed `print-templates.seed.ts` también se actualiza en el
--          mismo commit para que las bases que aún no tienen aplicada
--          esta migración, o los re-runs del seed en staging, no vuelvan
--          a la versión sin la sección.
-- =====================================================================
--
-- DATA IMPACT:
--   Tables affected: print_templates (UPDATE de `definition`)
--   Expected row changes:
--     - 1 fila afectada (la del sistema, is_system=true,
--       format_type='pos_sale_ticket'). Verificado: 2 filas en
--       print_templates con ese WHERE — id=1 (sistema) y ninguna otra
--       is_system=true con format_type='pos_sale_ticket'.
--     - 0 filas de overrides (is_system=false con format_type=
--       'pos_sale_ticket'). Verificado por la query de diagnóstico
--       de QUI-733 §7 — solo hay 2 overrides en toda la tabla y
--       ninguno corresponde a pos_sale_ticket.
--   Destructive operations: none (UPDATE no destructivo; reasignación
--     de `order` y agregado de un elemento a un array jsonb).
--   FK/cascade risk: none (no se tocan FKs).
--   Idempotency: guarda externa `WHERE is_system=true AND format_type=
--     'pos_sale_ticket' AND NOT (...@>'[{"id":"sec_table_info"}]')`
--     garantiza que re-aplicar es no-op. Adicionalmente, dentro del
--     CTE se hace un `SELECT FROM print_templates WHERE` con la misma
--     guarda para que el `WITH old_sections AS` lea el estado previo
--     y no el ya actualizado por esta misma migración.
--   Approval: autorizado por el usuario para cierre de QUI-727/733
--     (per-fixarabe 2026-08-31, §7).
--
-- Por qué `WHERE` por (is_system, format_type) y NO por `id`:
--   El id es autoincrement por entorno y no es estable entre DB local /
--   staging / prod. Aquí `id=1` es el id actual en la DB local sembrada
--   por `print-templates.seed.ts:695-706`, pero en una DB que tenga
--   plantillas creadas en otro orden, `id=1` puede no ser
--   `pos_sale_ticket`. El criterio de QUI-733 es el semántico: la
--   plantilla DEL SISTEMA para `pos_sale_ticket`. Eso es invariante.
--
-- Por qué el orden es `order:3` (entre doc_info y customer):
--   La mesa es del contexto del documento (quién atiende), no del
--   comprador. Va después del bloque `Datos del Ticket` (cajero,
--   fecha, terminal) y antes de `Datos del Cliente`. Mismo criterio
--   que el comentario del compositor en la cocina, donde `sec_table_info`
--   ocupa `order:2` (entre header y items).
-- =====================================================================

UPDATE "print_templates"
SET "definition" = jsonb_set(
  "definition",
  '{sections}',
  (
    WITH
      -- Lee las secciones ACTUALES (previas al UPDATE), filtrando a la
      -- fila del sistema para pos_sale_ticket. La guarda de no-existir
      -- sec_table_info se aplica aquí para no leer un estado intermedio.
      old_sections AS (
        SELECT "definition"->'sections' AS sections
        FROM "print_templates"
        WHERE "is_system" = true
          AND "format_type" = 'pos_sale_ticket'
          AND NOT ("definition"->'sections' @> '[{"id":"sec_table_info"}]'::jsonb)
        LIMIT 1
      ),
      -- Bumpa orders 3,4,5,6 → 4,5,6,7 sin tocar el resto. Mantiene
      -- el shape completo de cada sección (incluidos sus `fields`).
      bumped AS (
        SELECT
          COALESCE(
            (SELECT jsonb_agg(
              jsonb_set(elem, '{order}', to_jsonb(
                CASE (elem->>'order')::int
                  WHEN 3 THEN 4
                  WHEN 4 THEN 5
                  WHEN 5 THEN 6
                  WHEN 6 THEN 7
                  ELSE (elem->>'order')::int
                END
              ))
            )
            FROM old_sections, jsonb_array_elements(sections) AS elem),
            '[]'::jsonb
          ) AS arr
      ),
      -- Concatena el bloque sec_table_info al final. El `||` entre
      -- arrays jsonb preserva el orden de inserción y deja el nuevo
      -- elemento al final del array; el ORDER BY de la capa final lo
      -- posiciona correctamente por `order:3`.
      augmented AS (
        SELECT
          arr || jsonb_build_array(
            jsonb_build_object(
              'id', 'sec_table_info',
              'type', 'table_info',
              'title', 'Mesa, Mesero y Turno',
              'enabled', true,
              'order', 3
            )
          ) AS arr
        FROM bumped
      )
    -- Re-emro final estable por (order, id) para que la sección nueva
    -- aterrice en la posición correcta del array físico.
    SELECT COALESCE(
      (SELECT jsonb_agg(elem ORDER BY (elem->>'order')::int, elem->>'id')
       FROM augmented, jsonb_array_elements(arr) AS elem),
      '[]'::jsonb
    )
  ),
  false  -- create_if_missing = false: si 'sections' no existe, aborta
),
"updated_at" = NOW()
WHERE "is_system" = true
  AND "format_type" = 'pos_sale_ticket'
  AND NOT ("definition"->'sections' @> '[{"id":"sec_table_info"}]'::jsonb);