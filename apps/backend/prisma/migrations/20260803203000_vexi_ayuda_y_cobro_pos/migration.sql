-- Precisa dos bloques del protocolo de Vexi: la ruta real del módulo de ayuda
-- y la herramienta con la que cobra en el Punto de Venta.
--
-- DATA IMPACT:
--   Tabla afectada: ai_engine_applications (1 fila, key='chat_assistant')
--   Columna afectada: system_prompt (solo se reemplazan dos bloques concretos)
--   Filas esperadas: 1 UPDATE
--   Destructivo: NO. Sin DROP, sin DELETE, sin TRUNCATE, sin CASCADE.
--   Idempotente: SÍ. `replace()` sobre un texto que ya no contiene el bloque
--     viejo es un no-op.
--
-- POR QUÉ (ayuda): la migración anterior decía "el sistema tiene un módulo de
-- ayuda con documentación de uso", sin ruta y sin límite. La base tiene 6
-- artículos: primeros pasos, venta en POS, tienda en línea, órdenes de compra,
-- ajuste de inventario y métodos de pago. Prometerle al modelo documentación
-- completa reproduce el defecto que estamos quitando —afirmar con confianza
-- algo falso— solo que desplazado: en vez de negarse, inventaría un artículo.
-- El bloque ahora nombra la ruta, dice qué cubre y qué hacer cuando no cubre.
--
-- POR QUÉ (cobro): el prompt ya autoriza cobrar, pero no decía con qué. Sin el
-- nombre de la herramienta el modelo cae en el puente genérico, que no sabe
-- armar un pago del POS. `ui_pos_checkout` reusa el mismo camino del cajero.
--
-- Se escribe como migración nueva y no editando la anterior a propósito: esa ya
-- está aplicada en local, y modificarla en sitio dejaría su checksum en
-- conflicto con `_prisma_migrations`.

UPDATE ai_engine_applications
SET system_prompt = replace(
  replace(
    system_prompt,
    $v1$### Cuando no sepas cómo se usa algo
El sistema tiene un módulo de ayuda con documentación de uso. Si te preguntan cómo hacer algo y no lo tienes claro, consúltalo antes de admitir que no sabes.$v1$,
    $n1$### Cuando no sepas cómo se usa algo
El sistema tiene un módulo de ayuda con artículos de uso. Búscalo con `help-center/articles/search` pasando `q` con las palabras de la persona. Son pocos artículos y cubren: primeros pasos, cómo hacer una venta en el Punto de Venta, configurar la tienda en línea, crear una orden de compra, ajustar inventario manualmente y configurar métodos de pago. Si hay artículo, respóndele desde ahí. Si no hay, NO te lo inventes: explícaselo tú con lo que sabes del sistema, o dile con franqueza que eso no está documentado todavía.$n1$
  ),
  $v2$Puedes armar Y COBRAR una venta en el Punto de Venta: llevar al usuario allí, buscar los productos, agregarlos, asignar el cliente y cobrar. Cuando termines de agregar, resume la venta —líneas con cantidades, total, y a qué cliente va— y pregunta si confirma para cobrar. Si confirma, cóbrala. Si el medio de pago no está claro, pregúntaselo antes: eso lo elige la persona, no tú. Nunca contestes que el cobro lo tiene que hacer ella.$v2$,
  $n2$Puedes armar Y COBRAR una venta en el Punto de Venta: llevar al usuario allí, buscar los productos, agregarlos, asignar el cliente y cobrar. Cuando termines de agregar, resume la venta —líneas con cantidades, total, y a qué cliente va— y pregunta si confirma para cobrar. Si confirma, cóbrala con `ui_pos_checkout`, que es la única forma de cobrar: el puente genérico no sabe armar un pago del Punto de Venta. El medio de pago lo elige la persona en la pantalla de cobro, así que después de llamarla dile en qué quedó —cobrada con su número de orden, o pendiente de que ella termine de elegir—. Nunca contestes que el cobro lo tiene que hacer ella.$n2$
)
WHERE key = 'chat_assistant';
