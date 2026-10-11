# Contratos: alcance administrativo autorizado

Ejecución local del plan `~/.openclaw/tmp/vendix-contratos/plan.md` y su
`analisis.md`: **P0.1, P0.2, P0.3, P0.4 y P1.1**. Se trabaja directamente en
`develop`, sin push, PR ni despliegue. No se modifican recepción de documentos,
POS, pagos, formatos de impresión ni `apps/mobile`. No se requieren migraciones.

## Cambios por fase

Los prefijos siguientes son rutas literales:

- **B**: `apps/backend/src/domains/store/`
- **F**: `apps/frontend/src/app/private/modules/store/`

| Fase | Archivos fuente | Alcance |
| --- | --- | --- |
| P0.1 | `F/contracts/contracts.component.ts`; nuevo `apps/backend/src/common/guards/construction-industry.guard.spec.ts` | Carga, error con reintento, vacío real y filtros sin resultados separados. Industria construction sola/combinada y permisos independientes. Seeds, guards y catálogo existentes no necesitan cambios ni ejecución global. |
| P0.2 | `F/contracts/contracts.component.ts`; `F/quotations/quotations.component.ts`; `F/quotations/components/quotation-form-modal/quotation-form-modal.component.ts`; `F/quotations/components/quotation-list/quotation-list.component.ts` | Entrada Cotizar contrato y edición contractual en el modal existente, cliente requerido, destino inmutable, guardado con navegación y bloqueo de doble submit. Venta conserva su entrada POS. |
| P0.3 | `B/contracts/contracts.service.ts`; `B/quotations/quotations.service.ts`; `F/contracts/services/contracts.service.ts`; `F/quotations/quotations.component.ts`; listado y detalle de cotizaciones; `F/quotations/interfaces/quotation.interface.ts`; `F/quotations/services/quotations.service.ts` | Accepted+contract crea contrato; accepted+sale crea orden; other no convierte. Referencia contracted, 409 con navegación al ganador propio, numeración bloqueada y transición condicional transaccional. Cancelación no pisa conversión concurrente. |
| P0.4 | `B/contracts/contracts.service.ts`; `F/contracts/services/contracts.service.ts`; `F/contracts/interfaces/contract.interface.ts`; nuevo `F/contracts/interfaces/contract-snapshot.interface.ts`; `F/contracts/pages/contract-detail/contract-detail.component.ts` | Adaptación única del snapshot congelado: líneas, totales, notas, condiciones, vigencia y perfil/versión. Ausentes no se inventan como cero ni como configuración actual. Notas no son objeto contractual. Factura activa mínima y estado fiscal separados del estado administrativo. |
| P1.1 | Nuevos `F/quotations/interfaces/quotation-profile.interface.ts`, `F/quotations/services/quotation-profiles.service.ts`, `F/quotations/pages/quotation-profiles/quotation-profiles.component.ts`, `F/quotations/components/quotation-profile-form-modal/quotation-profile-form-modal.component.ts`; modal de cotización; listado y servicio de contratos; `apps/frontend/src/app/routes/private/store_admin.routes.ts` | Perfiles propios por tienda: CRUD, clonación, default, activar/desactivar, versiones y catálogo invalidado. Ruta de perfiles antes de `quotations/:id`, sin nueva clave panel_ui. Contratos con búsqueda, estado y paginación del servidor; contadores de página no se presentan como totales globales. |

Specs vecinos acompañan estos cambios. La comprobación local se limita a un
spec por invocación y lectura de los watchers existentes; no se ejecutan suites
completas, builds generales ni sondas fiscales/productivas.

## Verificación ejecutada

**15 specs, 83 tests aprobados** (33 backend + 50 frontend). Cada archivo se
ejecutó en su propia invocación, sin concurrencia entre pruebas, con heap de
1024 MB y un worker. Jest usó transformación aislada, sin typecheck global;
Angular usó un tsconfig temporal externo limitado al spec y bootstrap zoneless.

| Spec | Tests aprobados |
| --- | ---: |
| `apps/backend/src/common/guards/construction-industry.guard.spec.ts` | 5 |
| `B/contracts/contracts.service.spec.ts` | 17 |
| `B/contracts/contracts.create-from-quotation.spec.ts` | 6 |
| `B/quotations/quotations.convert-gates.spec.ts` | 5 |
| `F/contracts/services/contracts.service.spec.ts` | 5 |
| `F/contracts/contracts.component.spec.ts` | 7 |
| `F/contracts/pages/contract-detail/contract-detail.component.spec.ts` | 4 |
| `F/quotations/quotations.component.spec.ts` | 8 |
| `F/quotations/components/quotation-form-modal/quotation-form-modal.component.spec.ts` | 3 |
| `F/quotations/components/quotation-list/quotation-list.component.spec.ts` | 2 |
| `F/quotations/pages/quotation-detail/quotation-detail.component.spec.ts` | 3 |
| `F/quotations/services/quotations.service.spec.ts` | 2 |
| `F/quotations/services/quotation-profiles.service.spec.ts` | 3 |
| `F/quotations/components/quotation-profile-form-modal/quotation-profile-form-modal.component.spec.ts` | 5 |
| `F/quotations/pages/quotation-profiles/quotation-profiles.component.spec.ts` | 8 |

Se resolvieron los hallazgos antes de aceptar los cambios: filtros de
organización relacionales en cotizaciones, protección ante cancelación/doble
conversión, latch de submit síncrono, edición de perfil inactivo, respuestas
obsoletas y última página tras eliminación. La tasa de impuesto fraccional
`0.19` se presenta como `19%`; un histórico fuera de escala se señala, sin
inferir su régimen ni reescribirlo.

El primer spec de modal agotó el límite de memoria del worker. Se redujo el
grafo con imports directos dentro del alcance; no se amplió el heap. Los
reintentos finales pasaron. Hay avisos no bloqueantes de tracking por identidad
del componente compartido en el spec de perfiles, que no se modifica aquí.

La comprobación final usa `bash scripts/buildcheck.sh --watch` y los logs del
backend existente. El recorrido manual/E2E y la aceptación fiscal no se ejecutan
en esta entrega: las pruebas autorizadas son únicamente specs puntuales.

## Pendientes que NO se implementan

| Fase | Decisión de Rafael pendiente |
| --- | --- |
| P1.2 | Base AIU bruta/neta, recargos incluidos/añadidos, modelo de costo directo + AIU, reglas de descuentos/redondeo, clasificación fiscal y revisión económica. Congelar desde la cotización, no desde el perfil vigente al convertir. |
| P1.3 | Factura íntegra derivada del acuerdo económico/fiscal aprobado, tarifas y bloqueos de configuración incompleta. |
| P1.4 | Cuándo significa “facturado”, aceptación fiscal verificable, contingencia/no electrónicos, anulación y refacturación. |
| P2.1 | Entrega documental observable, reintentos y evidencia; no se corrige el correo fire-and-forget existente. |
| P2.2 | Identidad del aceptante, evidencia, token y aceptación externa o proveedor de firma. |
| P2.3 | Creación manual, contenido contractual formal, obra pública, anexos, especificaciones y revisiones/otrosí. |
| P2.4 | Actas, avances, anticipos/amortización, retenciones, notas crédito y liquidación parcial. |

**Limitaciones preservadas deliberadamente:** el contrato aún toma la versión
vigente del perfil al convertir; un borrador de factura aún puede marcar el
estado administrativo como `invoiced`; la transición manual a ese estado sigue
existiendo. Este alcance hace usable el recorrido **administrativo**, no valida
la economía ni autoriza emisión fiscal. No se infiere régimen fiscal de la
industria ni se rellenan históricos con settings actuales.

## Prueba manual en la web local

1. Entrar en `https://vendix.com` con una cuenta dev autorizada y seleccionar una
   tienda cuya industria incluya `construction`. Revisar panel_ui y permisos de
   cotizaciones/contratos; no habilitarlos indiscriminadamente.
2. En Cotizaciones, abrir **Perfiles de cotización**. Crear un perfil con nombre,
   vigencia, condiciones y porcentajes opcionales. Editar, clonar, cambiar default,
   activar/desactivar y revisar versiones. Un cero explícito se conserva; un campo
   vacío sigue sin configurar.
3. En Contratos, pulsar **Cotizar contrato**. Seleccionar cliente y perfil; agregar
   una línea libre. Modificar notas/condiciones manualmente y comprobar que otro
   perfil no sobrescribe esos cambios. Guardar debe abrir la cotización creada.
4. Reabrir un borrador contractual para editar: conserva cliente, líneas, destino
   y perfil; no abre el POS. Una cotización de venta sí conserva el flujo POS.
5. En una cotización contractual enviada/aceptada administrativamente, elegir
   **Crear contrato**. No se solicita convertir a orden. Doble clic/reintento no
   produce duplicados; una cotización contratada enlaza su contrato exacto.
   Para probar envío, usar únicamente un cliente/correo de prueba, no destinatarios
   reales. La aceptación administrativa no equivale a firma del cliente.
6. Revisar la ficha: líneas e importes del snapshot, condiciones, notas separadas
   del objeto formal, perfil/versión y “No configurado” donde falte información.
   Cambiar un perfil después de crear el contrato no cambia su snapshot.
7. Buscar y filtrar contratos, avanzar páginas y comprobar que el registro 51 es
   alcanzable cuando existan suficientes registros. Ante fallo de API, comprobar
   error/reintento en lugar de “Sin contratos”.
8. Repetir con usuario sin permisos y tienda sin construction: no deben ofrecerse
   acciones contractuales; el backend conserva los rechazos independientes. Otra
   tienda no debe ver perfiles/referencias de la primera.

**Detener el recorrido antes de generar o emitir facturas:** P1.2–P1.4 requieren
decisiones adicionales. No probar DIAN productiva, firmas ni correos reales.
