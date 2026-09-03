-- =====================================================================
-- Migration: 20260902020000_clear_zero_margin_roll_overrides
-- Purpose: Correctiva de 20260902010000. Esa migración subió el margen de
--          las PLANTILLAS de rollo a 1.5mm, pero una tienda que había
--          fijado su propio override `paper.margin_mm = 0` sigue imprimiendo
--          a 0mm y el cabezal térmico le sigue recortando el primer y
--          último carácter de cada línea.
--
--          La razón es el merge del gateway
--          (print-gateway.service.ts → mergeDefinition):
--
--            margin_mm: <hay algún per-side>
--              ? undefined
--              : overrides.paper.margin_mm ?? base.paper.margin_mm
--
--          `??` es nullish coalescing: `0 ?? 1.5` devuelve **0**, no 1.5.
--          Así que el override de cero GANA sobre la plantilla corregida y
--          el arreglo nunca llega a esa tienda. Sólo ocurre cuando el
--          override NO trae márgenes per-side; si los trae, el gateway ya
--          descarta `margin_mm` a propósito (para no aplanar la asimetría)
--          y esas tiendas no están afectadas.
--
--          El arreglo es borrar la clave, no reescribirla a 1.5: así la
--          tienda vuelve a HEREDAR de la plantilla y un cambio futuro del
--          margen base la alcanza sin otra migración. Es el mismo criterio
--          que 20260902010000 aplicó a `styles.font_family`.
--
--          No se edita 20260902010000 (ya aplicada) — se corrige con una
--          migración nueva, según la regla del skill vendix-prisma-migrations.
-- =====================================================================
--
-- DATA IMPACT:
-- Tables affected: store_print_format_configs
-- Expected row changes: sólo filas de formato de ROLLO cuyo override fije
--   `paper.margin_mm = 0` y NO traiga ningún margen per-side.
--   Conteo medido antes de escribir este script (SELECT de sólo lectura):
--     - dev:        0 filas.
--     - producción: 5 filas — cfg 104 (tienda 63, kitchen_ticket),
--       cfg 46 (tienda 63, dispatch_ticket), cfg 111 (tienda 105,
--       pos_sale_ticket), cfg 110 (tienda 85, pos_sale_ticket),
--       cfg 114 (tienda 94, pos_sale_ticket).
--   El filtro es por PREDICADO, nunca por lista de ids ni por conteo fijo:
--   si producción cambia entre la medición y el deploy, el script sigue
--   siendo correcto.
-- Destructive operations: none. Se elimina UNA clave jsonb puntual
--   (`paper.margin_mm`) de la columna `overrides`. Ninguna fila se borra,
--   ninguna tabla se trunca, ningún DROP.
-- FK/cascade risk: none. No se tocan columnas de FK ni de identidad
--   (store_id, organization_id, template_id, format_type quedan intactas).
-- Idempotency: tras la primera corrida la clave ya no existe, así que
--   `overrides->'paper'->>'margin_mm' = '0'` deja de ser cierto y la
--   segunda corrida afecta 0 filas.
-- Approval: continuación del mismo pedido aprobado que originó
--   20260902010000 — "para que todas las tirillas termicas pos salgan
--   legibles no solo por color si no por todo" (2026-09-02). El hueco se
--   detectó al medir producción, donde sí hay filas afectadas (en dev eran 0).
--
-- Sobre "es de rollo": se acepta como rollo tanto si el propio override lo
-- declara (`overrides.paper.is_roll = 'true'` — así están las 5 filas de
-- prod) como si lo declara la plantilla que la config resuelve (por
-- `template_id`, o por `format_type` cuando `template_id` es NULL). Se
-- restringe a rollo a propósito: un formato de HOJA con `margin_mm: 0`
-- explícito es una decisión legítima de la tienda y este script no la toca.
-- =====================================================================

UPDATE "store_print_format_configs" AS spfc
SET "overrides" = spfc."overrides" #- '{paper,margin_mm}',
    "updated_at" = NOW()
WHERE spfc."overrides"->'paper'->>'margin_mm' = '0'
  AND NOT (
    spfc."overrides"->'paper' ?| array[
      'margin_top_mm', 'margin_right_mm', 'margin_bottom_mm', 'margin_left_mm'
    ]
  )
  AND (
    spfc."overrides"->'paper'->>'is_roll' = 'true'
    OR EXISTS (
      SELECT 1
      FROM "print_templates" t
      WHERE t."definition"->'paper'->>'is_roll' = 'true'
        AND (
          t."id" = spfc."template_id"
          OR (spfc."template_id" IS NULL AND t."format_type" = spfc."format_type")
        )
    )
  );
