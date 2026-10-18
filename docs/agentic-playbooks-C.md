# Fase C — procesos progresivos Vex/Vexi

Implementación offline, **no promoción/canary ni baseline medido**. Fuente de ejecución:
brief-C y plan aprobado, sección C. Prerrequisitos existentes: A, D0, B y D1.
No scheduler/verificador de objetivos D2, nueva voz, sandbox o recetas de tienda.

## Activación y rollback

- `AI_AGENT_PLAYBOOKS_ENABLED`: solo `true`, **default OFF**. No se activó aquí.
- Registro search/load y validación de assets ocurren opt-in. Las declaraciones
  standalone MCP/voz devuelven `PLAYBOOK_SESSION_REQUIRED`: no nueva vía de ejecución.
- Indexación/retrieval híbrido usa además `AI_TOOL_KNOWLEDGE_INDEX_ENABLED` de B y
  su migración existente; no hay migración C. Sin índice/app/DB: fallback lexical
  local explícito. No cambios de modelo, proveedor, configuración o prompt DB.
- B routing mantiene discovery autorizado como scaffold, K12/24/40 intacto. Las
  dependencias del playbook son hints intersectados con autoridad actual, no grants.
- D1 ON conserva pins por objetivo; sin D1 la sesión es solo del turno. Rollout
  requiere revisar/activar prerrequisitos explícitamente, no auto-habilitar flags.
- Rollback excluye tools C de un registry ya inicializado, bloquea carga y queries
  process, rechaza jobs de manifiesto viejo. No borra documentos/pins/results ni
  reanima bodies históricos. Solo una referencia al body se rehidrata, incluso OFF.

## Contrato y confianza

Los veinte archivos `src/ai-engine/playbooks/content/*.md` son guía del release,
NO skills de desarrollo ni contenido editable por tienda. JSON frontmatter es el
subconjunto YAML aceptado; `metadata` estructurada y `vendix_contract` versionado
son **extensiones Vendix**, no campos obligatorios de Agent Skills. Se adapta su
carga progresiva, no su estructura exacta de directorio ni su metadata string-only.
[Especificación primaria consultada](https://agentskills.io/specification).

Cada archivo publica owner, industria, workflow key, tools/versiones, permisos,
verifiers y contrato de entradas simbólicas/DAG/ejemplos happy-sad. El validador
comprueba nombres reales, versiones, required args/tipos/enums, referencias,
permisos suficientes, rutas del ApiCatalog, ciclos, aprobación y verificadores.
No invoca previews ni handlers para indexar. Assets inválidos opt-in fallan bootstrap.

La sesión opaca vive en WeakMap, no por ID elegido por el modelo. Exige ALS real
con owner/store/org positivos exactos. Autorización inicial∩actual, denies y scopes
plan/agente/caller siempre prevalecen. Loader poda pasos/tool/rutas no disponibles,
sus dependientes y líneas relacionadas, reportando restricciones concretas.
Una falta de dato pide el campo específico; falta de capacidad declara gap.

## Descubrimiento y presupuesto

`search_playbooks(query,limit?)` devuelve títulos, entradas, section IDs, costo
aproximado y restricciones, sin cuerpos. La ruta híbrida consulta documentos globales
`entity_type=process`, tipos SQL parametrizados y hash/config/scope en la cache.
Nunca busca globals a través de `semantic_search` de negocio ni tenant0 de tienda.

`load_playbook(id,version,section?)` devuelve una sección del release, max2activos.
Presupuesto inicial **2000tokens por playbook/turno**, implementado conservadoramente
como ≤2000bytes UTF-8 del output JSON completo acumulado (1token/byte, no chars/4).
Se omiten registros/líneas enteros y se informa preparation-only cuando no cabe algo;
un fragmento nunca se presenta como workflow completo. Pilotos tienen fases pequeñas;
varios writes ya requieren turnos/aprobaciones separados. No aumentar presupuesto
para aparentar que todos los pasos se cargaron. Search publica las secciones elegibles.

D1 obtiene los últimos2procesos distintos cargados con receipt ok/no stale/fresh,
por consulta tenant/owner separada del primer page de resultados. Conserva solamente
id/version/hash/section. Historial >25mensajes no obliga redescubrir IDs ni recargar
veinte cuerpos. Un pin stale conserva su identidad para fallar cerrado; no adopta
otra versión por descarte silencioso. Con2slots restaurados se necesita **otro
objetivo/conversación**, no basta abrir otro turno para activar un tercer proceso.

## Los20procesos

| Playbook | Alcance y verificación |
|---|---|
| reponer-inventario | Stock/reservas/sourcing y decisión de proveedor; **no compra automática**. Argumentos confiables atan producto/cantidad; proveedor no único pide elección. |
| facturar-venta | Orden→borrador→validar→preflight→enviar;3writes con3aprobaciones. Lecturas finales factura accepted + orden con mismo número/CUFE. |
| cerrar-caja | Sesión/movimientos, arqueo explícito, preview y una aprobación; GET final ID cerrado/conteo/diferencia exactos. |
| crear-producto-inventario | **Preparación-only**: create_stock_adjustment carece de preview. No escribe producto/stock desde este playbook. |
| compra-proveedor | OC borrador/líneas/total, sin recibir o pagar implícitamente. |
| recibir-compra | Recepción parcial/completa, saldo y stock. |
| pagar-proveedor | Comprobante único y saldo. |
| crear-cliente | Duplicados/documento/contacto y lectura real. |
| venta-cobro | Orden/líneas/pago por un solo seam, forma de pago real. |
| cobrar-cartera | Recibo único/saldo/medio explícito. |
| trasladar-inventario | Origen/destino distintos, disponibilidad y transición. |
| devolucion-reembolso | Orden/preview/devolución; sin doble compensación ni efecto fiscal inventado. |
| registrar-gasto | Documento→extracción validada→bridge publicado→aprobar, cada cambio confirmado. Typed create_expense no enlaza el documento. |
| ruta-despacho | Ruta/remisiones/paradas/recaudo por transiciones existentes. |
| reserva-servicio | Slot/proveedor/servicio/cliente, no stock0 como bloqueo de servicio. |
| mesa-cocina-cobro | **Preparación-only**: typed create_pos_payment no transporta table_session_id/metadata para demostrar close-out/limpieza; no improvisar seam. |
| cambio-precios | Base/override/impuestos, sin persistir final calculado. |
| cierre-contable | Cuadre/precondiciones/estado período, sin asientos inventados. |
| nomina-periodo | Cálculo y aprobación separados; no pago/envío DIAN implícito. |
| reporte-ventas-margen | Revenue/COGS/timezone, completitud y exportXLSX real. |

Todos20tienen verificador puro y happy/sad de negocio. El verificador consume
observaciones del adaptador confiable (argumentos/IDs/bridge/estado/frescura/
completitud/causalidad), jamás una afirmación del modelo. Devuelve scope `preparation`
o `domain`, **no cambia el estado del objetivo** ni reemplaza D2. Artefactos históricos,
resultado pendiente/unknown, última página parcial, ID/orden/ruta ajenos no verifican.

### Prerrequisito inmediato descubierto

Los4handlers de pilotos create_invoice_from_order, validate_invoice,
send_invoice_dian y close_cash_session devolvían display JSON sin recibo aplicado;
D0 correctamente los clasificaba `unknown_effect`. C añade **solo con su flagON**
`applied:true`/resource_ids cuando el dominio devuelve ID y estado positivos explícitos.
No usa IDs/status fallback como prueba; errores, rechazo DIAN, conteo/diferencia
inconsistentes o resultado ambiguo siguen sin recibo positivo. OFF conserva ABI original.
No se relajó normalizer, previews, permisos, token único ni la regla aprobación/write.
Los demás writes legacy mantienen sus contratos; no se certifican17E2E con ejemplos.

## Assets, packaging y coste de plataforma

`nest-cli.json` copia MD a `dist/src/ai-engine/playbooks/content`, beside loader
compilado. No path desde args, cwd, repo fallback, symlinks o descarga. El gate CI
existente `scripts/assert-build-assets.js` comprueba todos los assets configurados.
El spec wiring lo ejercita en fixture temporal con20copias y prueba missing-file;
**no equivale a ejecutar nest build** ni certifica la imagen desplegada.

Indexer B reconstruye manifiesto release-owned en el worker BullMQ existente,
keys `process:workflow:version:section`, hash de contrato+cuerpo, reindexa por hash/
fingerprint y retira versiones lógicamente después de ready. No namespace de
negocio, borrado histórico, seed ni migración nuevos. Indexar con flag activo puede
generar gasto de plataforma: requiere configuración/presupuesto/rollout autorizado.

## Verificación y límites

- Specs exactos listados en `progress.md`, secuenciales, heap1536MB y `--runInBand`.
  Config d1 reutilizada: transpile-only; no certificación global TS/DI/bootstrap.
- Pilotos usan MD/loader/registry/factories/confirmaciones reales, Redis Map y servicios
  de dominio/HTTP stateful simulados; cash ApiCatalog reflexiona controller real.
  Propuesta no muta, tokens aplican una vez, lecturas finales y negativos.
- Los otros17procesos: contrato/ejemplos/verificador puro, no17flujos reales completos.
- Proxy offline cuenta metadata lookups reales repetidos vs search/carga por fase,
  fixture diseñada explícitamente. **No baseline ni mejora de modelo certificada**.
- Replay A budget0:150planned,0ran,150not_run. Completion/recall/tokens/latencia/coste
  comparables quedan NULL. Corpus/hash conservados. Ceros sin runs no prueban seguridad.
- CI/bootstrap de esta rama, SQL D1/B contra snapshot, revisión owner dominio20procesos,
  E2E autorizado y gate empírico≥30% menos exploración sin regresión quedan pendientes.
  Las mediciones proveedor/QA requieren aprobación de Rafael; no bloquean código offline.
