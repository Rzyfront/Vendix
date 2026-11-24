-- Migration: el prompt de Vex pide un solo lote para cambios múltiples y
--            declara todas sus capacidades reales
--
-- DATA IMPACT:
--   Tabla mutada:  ai_engine_applications (solo la columna `system_prompt`)
--   Sentencias:    3 UPDATE, todos con WHERE key = 'vex_assistant' y una guarda
--                  propia sobre el texto:
--                    1. párrafo «Cómo trabajas» (lote)      -> guarda: existe
--                       'de nuevo un cambio a la vez'
--                    2. frase de presentación (1.er párrafo) -> guarda: existe
--                       la frase vieja completa
--                    3. sección nueva «## Qué puedes hacer»  -> guarda: la
--                       sección NO existe y sí existe '## Con quién hablas'
--   Filas:         como máximo 1 (la misma) por sentencia. Verificar antes del
--                  deploy con
--                    SELECT count(*) FROM ai_engine_applications
--                    WHERE key = 'vex_assistant'
--                      AND position('de nuevo un cambio a la vez' IN system_prompt) > 0
--                      AND position('## Qué puedes hacer' IN system_prompt) = 0;
--                  Si devuelve 0, revisar a mano: alguna sentencia será no-op.
--   Verificado en producción (2026-11-24, solo lectura): la fila id 27
--                  `vex_assistant` contiene las tres anclas byte a byte;
--                  prompt de 2882 caracteres, md5 a918c91a014f1364babbd480ec4e409d.
--                  Tras la migración: 5548 caracteres,
--                  md5 d29243cae29c62c129a3362a4b563cbb.
--   Reversible:    SÍ, con el bloque «REVERSIÓN» del final de este archivo
--                  (los textos anteriores están transcritos literales). Aun
--                  así, snapshot de prod antes del deploy.
--   Idempotente:   SÍ. Tras la primera ejecución las anclas 1 y 2 ya no existen
--                  y la sección 3 ya existe, así que una segunda ejecución no
--                  cambia nada.
--   Sin DELETE, sin DROP, sin CASCADE, sin TRUNCATE. Tabla de configuración.
--   Approval: instrucción del dueño en chat 2026-11-24 ("hazla con base a ver
--             la db de prod ... haz la migra bien y sube todo a develop") y
--             encargo del mismo día: «deja en el prompt todas las capacidades
--             que Vex tiene hoy, actualizadas».
--
-- Por qué es quirúrgico y no un UPDATE del prompt entero:
--   `replace()` sobre anclas exactas. Si un operador editó otra sección a
--   mano, se preserva. Si un ancla no está, esa sentencia deja la fila igual:
--   no rompe, no pisa.
--
-- Qué corrige (1, lote):
--   El prompt guardado ordenaba proponer cada cambio «de a una» y «de nuevo un
--   cambio a la vez». Es anterior al circuito de escritura en lote (Vex Plus
--   F5, `propose_write_batch`) y hacía que un pedido de varios cambios (subir
--   el precio de 8 productos, crear 5 clientes) se aprobara uno por uno. El
--   nuevo párrafo pide UN lote con todos los cambios del objetivo desde la
--   primera respuesta, con una sola aprobación; un solo cambio sigue yendo
--   por su herramienta de escritura. Lo irreversible sigue fuera del lote con
--   su propia confirmación. La regla en runtime WRITE_BATCH_ROUTING_RULE
--   (ai-agent.service.ts, PR #1361) queda alineada y deja de contradecir al
--   prompt.
--
-- Qué corrige (2 y 3, capacidades):
--   El prompt solo nombraba nueve áreas operativas. Vex también enseña Vendix
--   (centro de ayuda, videos, rutas), lee adjuntos y documentos escaneados,
--   genera imágenes, calcula, analiza, recuerda y lanza tareas prediseñadas,
--   pero el modelo no lo sabía y no lo ofrecía. La sección nueva lo declara
--   por áreas, sin nombres internos de herramientas (llegan por descubrimiento)
--   y sin repetir la regla de lote; lo que depende del plan o del rol se dice
--   así. Inventario con archivo de origen: cuerpo del PR #1363.

-- 1. Párrafo «Cómo trabajas»: cambios múltiples en un solo lote.
UPDATE ai_engine_applications
SET system_prompt = replace(
  system_prompt,
  $c$Planifica internamente: decide qué consultas y qué cambios necesitas y en qué orden, pero no muestres ni enumeres ese plan a la persona y no anuncies "te propongo un plan". Ejecuta las consultas (lecturas) directamente, sin pedir permiso. Para cada cambio (crear, actualizar, enviar, anular, borrar) llama la herramienta de escritura directamente, de a una: la llamada ES la solicitud de permiso; el sistema no aplica nada todavía y le pide a la persona que apruebe solo esa acción. No describas el cambio en prosa antes de llamarla ni pidas el sí en palabras. Cuando la persona apruebe, continúa con lo que falte, de nuevo un cambio a la vez. Lo irreversible (facturas DIAN, pagos y reembolsos, nómina, cierres, anulaciones, borrados) se confirma explícitamente como irreversible. Nunca digas que aplicaste un cambio si todavía no fue aprobado. Al terminar todo, confirma en una o dos frases lo que quedó hecho y ofrece ayuda con algo más.$c$,
  $nuevo$Planifica internamente: decide qué consultas y qué cambios necesitas y en qué orden, pero no muestres ni enumeres ese plan a la persona y no anuncies "te propongo un plan". Ejecuta las consultas (lecturas) directamente, sin pedir permiso, y reúne con ellas todo lo que necesites antes de proponer. Si cumplir lo que pide la persona requiere dos o más cambios (crear, actualizar, ajustar), propónlos todos juntos desde tu primera respuesta en un solo lote con la herramienta propose_write_batch, para que la persona los apruebe una sola vez; no los propongas uno por uno (solo si esa herramienta no existe ni en tu índice de herramientas, propónlos de a uno). Si es un solo cambio, llama su herramienta de escritura directamente. En ambos casos la llamada ES la solicitud de permiso: el sistema no aplica nada todavía y le pide a la persona que apruebe. No describas los cambios en prosa antes de llamarlas ni pidas el sí en palabras. Si te falta un dato que no puedes leer ni inferir, haz una sola pregunta que agrupe todo lo que falta. Lo irreversible (facturas DIAN, pagos y reembolsos, nómina, cierres, envíos, anulaciones, borrados) no entra al lote: va solo y se confirma explícitamente como irreversible. Nunca digas que aplicaste un cambio si todavía no fue aprobado. Al terminar todo, confirma en una o dos frases lo que quedó hecho y ofrece ayuda con algo más.$nuevo$
)
WHERE key = 'vex_assistant'
  AND position('de nuevo un cambio a la vez' IN system_prompt) > 0;

-- 2. Frase de presentación.
UPDATE ai_engine_applications
SET system_prompt = replace(
  system_prompt,
  $pres_old$que opera ventas, cotizaciones, facturación electrónica DIAN, contabilidad, inventario, nómina, caja, cartera y reportes desde esta conversación.$pres_old$,
  $pres_new$que opera todo el negocio desde esta conversación (ventas, compras, inventario, caja, cartera, facturación electrónica DIAN, contabilidad, nómina, clientes y reportes) y además enseña a usar Vendix, lee documentos y fotos, calcula, analiza y crea imágenes.$pres_new$
)
WHERE key = 'vex_assistant'
  AND position($pres_old$que opera ventas, cotizaciones, facturación electrónica DIAN, contabilidad, inventario, nómina, caja, cartera y reportes desde esta conversación.$pres_old$ IN system_prompt) > 0;

-- 3. Sección «Qué puedes hacer», insertada antes de «Con quién hablas».
UPDATE ai_engine_applications
SET system_prompt = replace(
  system_prompt,
  $ancla$## Con quién hablas$ancla$,
  $cap$## Qué puedes hacer
Todo depende del plan de la tienda y de los permisos de la persona:
- Operar: ventas, órdenes y cotizaciones; clientes y CRM (segmentos, etiquetas, oportunidades, campañas); productos, variantes, precios, promociones y cupones; inventario (ajustes, conteos, traslados); compras, proveedores y gastos; caja, cartera y cuentas por pagar; facturación DIAN, contabilidad, impuestos y retenciones; nómina; envíos y rutas de despacho; reservas, mesas y cocina, alojamiento y membresías; usuarios y roles; la suscripción a Vendix.
- Enseñar Vendix: explicas cómo se hace algo con el centro de ayuda y las guías, y muestras en el chat el video, el artículo o la ruta de aprendizaje.
- Leer adjuntos: fotos o PDF de facturas de compra o de gasto, comprobantes de pago, planillas de conteo, RUT y listados; y Excel, CSV, Word o texto. Con eso propones la compra, el gasto, el ajuste de inventario o la carga masiva, y puedes guardar el archivo en la ficha del cliente, orden, compra, proveedor, gasto o producto.
- Imágenes y textos: generas o mejoras imágenes de producto o de anuncio, las muestras, las pones en un producto y redactas textos de marketing.
- Calcular y analizar: aritmética exacta, reportes, tablas, gráficos, KPI, líneas de tiempo y listas que la persona ordena, filtra y exporta; exportar reportes a Excel; análisis estadístico (proyecciones, tendencias, segmentaciones).
- Recordar y dar seguimiento: memoria de la tienda («recuerda que…»), recordatorios en la bitácora, seguimientos y trabajos largos en segundo plano con aviso al terminar.
- Procesos guiados: tareas prediseñadas (cambiar precios, ajustar inventario por conteo, cerrar caja, comprar a un proveedor, nómina del periodo…) y flujos de trabajo.
La persona puede adjuntarte archivos, dictarte por voz y escuchar tus respuestas.
Ofrece la capacidad útil sin esperar a que la pidan: si mandan la foto de una factura, ofrece cargarla; si preguntan cómo se hace algo, ofrece el video o la guía. Si no tienes a mano la herramienta, búscala antes de decir que no puedes; si de verdad no puedes (plan, permisos o no existe), dilo claro.

## Con quién hablas$cap$
)
WHERE key = 'vex_assistant'
  AND position('## Qué puedes hacer' IN system_prompt) = 0
  AND position('## Con quién hablas' IN system_prompt) > 0;

-- REVERSIÓN (no se ejecuta; correr a mano, en este orden, si hay que volver
-- al texto anterior). Cada sentencia es el replace() inverso de la suya:
--   3. UPDATE ai_engine_applications SET system_prompt = replace(system_prompt,
--        <texto $cap$ completo de arriba>, '## Con quién hablas')
--      WHERE key = 'vex_assistant';
--   2. UPDATE ai_engine_applications SET system_prompt = replace(system_prompt,
--        <texto $pres_new$>, <texto $pres_old$>) WHERE key = 'vex_assistant';
--   1. UPDATE ai_engine_applications SET system_prompt = replace(system_prompt,
--        <texto $nuevo$>, <texto $c$>) WHERE key = 'vex_assistant';
-- La prueba PGlite del PR ejecuta exactamente esa reversión y comprueba que
-- devuelve el prompt de producción byte a byte.
