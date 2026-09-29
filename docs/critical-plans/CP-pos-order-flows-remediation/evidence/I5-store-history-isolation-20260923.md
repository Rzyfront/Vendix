# I.5 — aislamiento del historial fiscal de tienda (2026-09-23)

En `fiscal_scope=ORGANIZATION`, `resolveForStore()` entrega una entidad compartida con `store_id=NULL`. El historial fiscal de la ruta de tienda heredaba esa entidad sin filtrar tienda: el usuario podía consultar eventos `pos_sale_without_fiscal_document` de una tienda hermana, incluso con `?store_id` ajeno o sin filtro de tipo.

La ruta de tienda ahora pasa un alcance autenticado a `FiscalAuditService.list`. Para un tipo POS descubierto exige `store_id` de la tienda actual. Para el historial general permite **tienda actual O evento de entidad compartida con `store_id=NULL`**, nunca otra tienda. `?store_id` no puede sustituir el alcance. La ruta de organización mantiene lectura consolidada. Falta de contexto devuelve `STORE_CONTEXT_001` tipado.

Pruebas red→green de dos tiendas bajo una entidad, query spoof, consulta sin `event_type`, eventos compartidos NULL y ruta organizacional. Jest exacto `store-fiscal.controller.spec.ts` + `fiscal-audit.service.spec.ts`: **13/13** green; `git diff --check` limpio. Pendiente prueba runtime fiscal POS real y política de retry documentada en I.5; este cambio no crea cola ni migración.
