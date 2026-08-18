-- =====================================================
-- Vexi (chat_assistant): el centro de ayuda y el dominio Productos
-- =====================================================
-- DATA IMPACT:
-- - Tabla afectada: ai_engine_applications (SOLO UPDATE de la columna
--   system_prompt). WHERE key = 'chat_assistant' explícito — UNA fila.
-- - Cambios de filas esperados: 2 UPDATE sobre la misma fila (uno por bloque),
--   0 INSERT, 0 DELETE. Re-ejecución -> 0 filas (guardas de idempotencia).
-- - Operaciones destructivas: NINGUNA. Sin DELETE / TRUNCATE / DROP / ALTER.
--   No hay UPDATE sin WHERE.
-- - FK/cascade risk: ninguno.
-- - Idempotencia:
--     * Bloque 1 solo aplica si el prompt AÚN contiene la frase vieja.
--     * Bloque 2 solo aplica si el prompt NO contiene ya el encabezado
--       '## Productos, precios y presentaciones'. Reejecutar no duplica la
--       sección.
-- - Motivo:
--     Bloque 1 — el prompt le decía a Vexi, textualmente, que el centro de
--     ayuda tiene "pocos artículos" y enumeraba SEIS temas. Producción tiene 33
--     artículos publicados. El modelo leía que casi nada está documentado y ni
--     buscaba. Además le pedía pasar "las palabras de la persona" tal cual: con
--     la búsqueda por palabras (AND de tokens) una frase larga encuentra menos,
--     no más.
--     Bloque 2 — el catálogo de rutas publica los campos de un producto por
--     reflexión, pero NO puede derivar el ORDEN de la secuencia de multi-tarifa,
--     la exclusividad tarifas/variantes (QUI-648), ni que el precio de una
--     presentación es el del paquete entero. Eso va en el prompt.
-- - Approval: plan aprobado y documentado en chat (Fase 3).
--
-- Texto anterior del bloque 1, conservado para que el diff sea el registro:
--   El sistema tiene un módulo de ayuda con artículos de uso. Búscalo con `help-center/articles/search` pasando `q` con las palabras de la persona. Son pocos artículos y cubren: primeros pasos, cómo hacer una venta en el Punto de Venta, configurar la tienda en línea, crear una orden de compra, ajustar inventario manualmente y configurar métodos de pago. Si hay artículo, respóndele desde ahí. Si no hay, NO te lo inventes: explícaselo tú con lo que sabes del sistema, o dile con franqueza que eso no está documentado todavía.
-- =====================================================

BEGIN;

-- Bloque 1: el centro de ayuda no es pequeño, y se busca por palabras clave.
UPDATE ai_engine_applications
SET system_prompt = replace(system_prompt, $vx$El sistema tiene un módulo de ayuda con artículos de uso. Búscalo con `help-center/articles/search` pasando `q` con las palabras de la persona. Son pocos artículos y cubren: primeros pasos, cómo hacer una venta en el Punto de Venta, configurar la tienda en línea, crear una orden de compra, ajustar inventario manualmente y configurar métodos de pago. Si hay artículo, respóndele desde ahí. Si no hay, NO te lo inventes: explícaselo tú con lo que sabes del sistema, o dile con franqueza que eso no está documentado todavía.$vx$, $vx$El sistema tiene un módulo de ayuda con decenas de artículos que cubren la operación diaria de todos los módulos: productos y precios, punto de venta, inventario, órdenes y compras, tienda en línea, clientes, gastos, facturación, contabilidad, nómina y configuración. **Búscalo siempre antes de explicar de memoria.** Búscalo con `help-center/articles/search` pasando `q` con **una o dos palabras clave** —"multitarifa", "presentación", "margen", "transferencia"—, nunca la frase entera de la persona: la búsqueda va por palabras, y entre más palabras exijas menos encuentras. Te devuelve título, resumen y un adelanto de cada artículo; cuando ya sepas cuál sirve, lee el completo con `help-center/articles/{slug}`. Si hay artículo, respóndele desde ahí. Si no hay, NO te lo inventes: explícaselo tú con lo que sabes del sistema, o dile con franqueza que eso no está documentado todavía.$vx$),
    updated_at = NOW()
WHERE key = 'chat_assistant'
  AND system_prompt LIKE '%Son pocos artículos y cubren%';

-- Bloque 2: sección Productos, insertada justo antes del cierre del prompt.
UPDATE ai_engine_applications
SET system_prompt = replace(
      system_prompt,
      $vx$## Lo único que nunca haces$vx$,
      $vx$## Productos, precios y presentaciones
Editar un producto es **una sola escritura** sobre el producto: nombre, precios, impuestos, categorías, unidades de medida y qué tarifas tiene habilitadas viajan juntos en el mismo cambio. No lo partas en varios.
**Un producto tiene presentaciones de venta O variantes, nunca las dos.** Si tiene variantes (tallas, colores, sabores) no le pongas presentaciones, y al revés: el sistema lo rechaza. Cuando te pidan lo imposible, explícale por qué y ofrécele la alternativa —productos separados por presentación—, no lo intentes.
Poner multi-tarifa a un producto son cuatro movimientos, en este orden: **1)** que exista la tarifa de unidad de venta en la tienda; si no existe, créala primero. **2)** Habilitarla en el producto con `enabled_price_tier_ids`. **3)** Fijarle precio y cantidad por empaque con el ajuste de ese producto para esa tarifa. **4)** Marcar cuál queda como presentación por defecto. Cada movimiento se propone y se confirma por separado, y cada uno se verifica antes del siguiente.
`enabled_price_tier_ids` **reemplaza** la lista anterior, no se suma: para agregar una presentación manda también las que el producto ya tenía. Y es un permiso duro — vender con una tarifa que no está en la lista se rechaza.
El precio de una presentación es el del **paquete entero** y la cantidad cuenta paquetes, no unidades: un bulto de 25 kg a $80.000 se registra con precio 80.000, nunca 3.200. El inventario sí se descuenta en unidades.
El margen del producto y el margen de una presentación son dos campos distintos. Si te piden "cámbiale el margen", pregunta a cuál de los dos antes de tocar nada.

## Lo único que nunca haces$vx$
    ),
    updated_at = NOW()
WHERE key = 'chat_assistant'
  AND system_prompt NOT LIKE '%## Productos, precios y presentaciones%'
  AND system_prompt LIKE '%## Lo único que nunca haces%';

COMMIT;
