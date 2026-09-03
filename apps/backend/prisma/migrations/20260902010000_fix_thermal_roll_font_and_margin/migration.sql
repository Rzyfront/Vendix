-- =====================================================================
-- Migration: 20260902010000_fix_thermal_roll_font_and_margin
-- Purpose: Las tirillas térmicas de 80mm (print_templates con
--          definition.paper.is_roll = true) se guardaron con
--          font_family: 'Courier New' (asta fina que se rasteriza mal en
--          cabezal térmico) y margin_mm: 0 (el cabezal recorta el primer y
--          último carácter de cada línea impresa). El objetivo del usuario
--          es que TODAS las tirillas salgan legibles no sólo por color sino
--          por tipografía y márgenes. Esta migración es la CAPA 2 (datos);
--          la CAPA 1 (compositor HTML en print-formats/) la resuelve otro
--          cambio en paralelo y esta migración no la toca.
-- =====================================================================
--
-- DATA IMPACT:
-- Tables affected: print_templates, store_print_format_configs
-- Expected row changes:
--   print_templates: sólo filas con definition->'paper'->>'is_roll' = 'true'.
--     En dev hay 5 filas de rollo (ids 1, 10, 12, 13, 18); producción puede
--     tener 6 (el usuario reportó 6 tirillas físicas) — el filtro es por
--     PREDICADO (is_roll = true), nunca por conteo fijo ni por lista de ids,
--     así que cubre la fila adicional de prod sin cambios a este script.
--     De esas, se espera que las 5 (o 6 en prod) cambien en la primera
--     corrida: todas traían font_family en variantes de Courier o ausente,
--     y margin_mm en 0 o ausente.
--   store_print_format_configs: filas cuyo overrides->'styles'->>'font_family'
--     contenga 'Courier' (case-insensitive). En dev hay 0 filas así (se
--     verificó por conteo antes de escribir este script); en prod puede
--     haber alguna tienda que haya guardado un override con Courier — se
--     depuran con el mismo predicado tolerante, sin asumir un conteo.
-- Destructive operations: none. Sólo UPDATE de una clave jsonb puntual por
--   fila (ninguna fila se borra, ninguna tabla se trunca).
-- FK/cascade risk: none. No se tocan columnas de FK ni de identidad.
-- Idempotency: el UPDATE de print_templates sólo toca filas donde el valor
--   actual difiere del destino (IS DISTINCT FROM), así que una segunda
--   corrida no encuentra filas que actualizar. El UPDATE de
--   store_print_format_configs elimina la clave 'styles.font_family' con el
--   operador '#-'; tras la primera corrida esa clave ya no existe, por lo
--   que el WHERE (que exige que la clave exista y contenga 'Courier') deja
--   de matchear en la segunda corrida. Verificado manualmente corriendo el
--   script dos veces seguidas contra dev: 0 filas afectadas en la segunda.
-- Approval: solicitado explícitamente por el dueño del repo — "para que
--   todas las tirillas termicas pos salgan legibles no solo por color si no
--   por todo" (plan aprobado, 2026-09-02).
--
-- Decisión de create_missing para la fila 13 (dispatch_ticket, is_roll=true,
-- sin claves 'styles' ni 'paper.margin_mm' en su definition — verificado:
-- definition = {"copies":1,"format":"thermal_80","is_roll":true,
-- "width_mm":80}, sin objeto 'styles' en absoluto): SE CREAN las claves
-- faltantes. El objetivo explícito del usuario es que TODAS las tirillas de
-- rollo salgan legibles; dejar la fila 13 sin 'styles.font_family' la
-- dejaría heredando cualquier default de fuente que use el compositor HTML
-- (potencialmente Courier de nuevo), lo cual reintroduce el bug para ese
-- formato. `jsonb_set` con create_missing=true SÍ crea la última clave de un
-- path si el padre ya existe (paper.margin_mm — 'paper' existe), pero NO
-- crea el padre si falta (styles.font_family — 'styles' no existe en la
-- fila 13). Por eso 'styles' se construye explícitamente con
-- COALESCE(definition->'styles', '{}'::jsonb) || jsonb_build_object(...)
-- antes del jsonb_set final sobre el path de un solo nivel '{styles}' (que
-- siempre puede crearse porque su "padre" es la raíz del documento, que
-- siempre existe) — así se preservan las demás claves de 'styles' que ya
-- existan (compact_mode, primary_color, header_alignment, font_size_base_pt)
-- y sólo se sobreescribe/crea 'font_family'.
--
-- El predicado de Courier es tolerante a las dos formas encontradas en dev
-- (con comillas simples "'Courier New', Courier, monospace" en ids 1/10/12,
-- y sin comillas "Courier New, Courier, monospace" en id 18) vía
-- ILIKE '%Courier%', para no saltarse filas por una comparación de igualdad
-- exacta.
-- =====================================================================

UPDATE "print_templates"
SET "definition" = jsonb_set(
      jsonb_set(
        "definition",
        '{paper,margin_mm}',
        '1.5'::jsonb,
        true
      ),
      '{styles}',
      COALESCE("definition"->'styles', '{}'::jsonb)
        || jsonb_build_object('font_family', 'Arial, Helvetica, sans-serif'),
      true
    ),
    "updated_at" = NOW()
WHERE "definition"->'paper'->>'is_roll' = 'true'
  AND (
    "definition"->'styles'->>'font_family' IS DISTINCT FROM 'Arial, Helvetica, sans-serif'
    OR "definition"->'paper'->>'margin_mm' IS DISTINCT FROM '1.5'
  );

UPDATE "store_print_format_configs"
SET "overrides" = "overrides" #- '{styles,font_family}',
    "updated_at" = NOW()
WHERE "overrides"->'styles'->>'font_family' ILIKE '%Courier%';
