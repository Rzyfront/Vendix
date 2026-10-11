# Contratos — ejecución autorizada, fase 2

**Alcance vigente: P1.2, P1.3 y P1.4**, según `plan.md`, `analisis.md` y
`decisiones-rafael.md` en `~/.openclaw/tmp/vendix-contratos/`.
Las decisiones de Rafael sustituyen los pendientes económicos de la fase 1;
no se implementan creación manual, firma externa, actas ni P2.

Trabajo local sobre **develop**, con `parallel` y `sopus`: orquestación/auditoría
grande y ejecución por agentes pequeños. Sin cambio de rama, stash/reset/restore,
push, PR, despliegue, suites completas, builds generales ni cambios mobile.
Los **38 archivos ajenos** del baseline conservan su SHA256 y no entraron en
commits. Ningún archivo `received-documents` fue modificado. El único proveedor
de impresión editado fue `quotation.provider.ts`, que estaba limpio antes de
esta tarea; los formatos/compositor/gateway con cambios ajenos permanecen intactos.

## Resultado y decisiones aplicadas

- AIU se configura en **Facturación → Perfiles** (`InvoiceProfileConfig`). Se
  reutilizan `InvoiceCalculatorService`, reglas fiscales y reparto canónico de
  centavos del preview; no hay un motor fiscal contractual independiente.
- El perfil de **cotización** aporta condiciones y vigencia, no porcentajes
  fiscales. Cotización contractual congela perfil de facturación/version/config,
  líneas de costo, desglose calculado, objeto formal y fecha acordada. El contrato
  copia esa revisión y sus notas/condiciones; nunca el perfil vigente al convertir.
- La factura incluye **costo directo + AIU** según el modelo congelado, con sus
  impuestos y cuentas. Recalcula con el mismo motor y compara los resultados
  antes de numerar. Una versión incompleta o un PUC actual incompatible bloquean
  con explicación; no se cambian las cuentas ni se inventan tarifas.
- Generar factura crea un **borrador** y conserva contrato `active`. Solo
  `accepted` con fecha de aceptación y clave fiscal actualiza/proyecta `invoiced`.
  PATCH administrativo no puede marcarlo facturado. Borrador contractual de solo
  lectura; se enlaza por ID exacto, sin recapturar otro documento.
- Configuración general → Facturación ya no monta régimen, objeto ni pisos AIU.
  Sus claves/datos/componentes legacy se conservan; dejan de ser fuente fiscal.
  POS/ecommerce y facturación normal mantienen sus controles de emisión y su
  ruta no-AIU. La lectura de timezone general y de identidad/habilitación fiscal
  actual no constituye lectura de esos defaults AIU.

## Archivos por fase

Prefijos literales:
- **B** = `apps/backend/src/domains/store/`
- **F** = `apps/frontend/src/app/private/modules/store/`
- **M** = `apps/backend/prisma/migrations/`

| Fase | Archivos fuente principales | Cambio |
| --- | --- | --- |
| P1.2 — almacenamiento/perfiles | `apps/backend/prisma/schema.prisma`; `M/20261011010000_quotation_contract_economic_snapshot/migration.sql`; `M/20261011011000_quotation_invoice_profile_anchor/migration.sql`; `B/invoicing/profiles/profiles.service.ts` | JSON nullable, ancla de versión con FK RESTRICT y protección al eliminar perfil. Históricos sin backfill. |
| P1.2 — motor/cotización | `B/invoicing/profiles/profile-contract-economics.ts`; `B/invoicing/profiles/profile-preview.service.ts`; `B/quotations/quotation-contract-economics.ts`; `B/quotations/dto/create-quotation.dto.ts`; `B/quotations/dto/preview-contract-quotation.dto.ts`; `B/quotations/quotations.service.ts`; `B/quotations/quotations.controller.ts`; `B/quotations/quotations.module.ts` | Preview server, perfil fiscal distinto del de condiciones, congelado y CAS por revisión/tenant. |
| P1.2 — conversión | `B/contracts/contracts-snapshot.ts`; `B/contracts/contracts.service.ts` | Heredar perfil/config/líneas y términos de la cotización aceptada, sin consultar perfil actual. |
| P1.2 — web | `F/quotations/interfaces/quotation.interface.ts`; `F/quotations/interfaces/quotation-contract-economics.interface.ts`; `F/quotations/services/quotations.service.ts`; `F/quotations/components/quotation-form-modal/quotation-form-modal.component.ts`; `F/quotations/quotations.component.ts`; `F/quotations/pages/quotation-detail/quotation-detail.component.ts` | Elección AIU, preview cancelable, revisión explícita, error/reintento y desglose congelado. Edición de notas no renueva economía. |
| P1.2 — correo/impresión | `B/quotations/quotation-contract-presentation.ts`; `B/quotations/quotations.service.ts` (solo sender); `apps/backend/src/email/templates/quotation-email.template.ts`; `B/print-formats/providers/quotation.provider.ts` | Mismos importes/líneas/impuestos congelados; objeto, versión y condiciones; dos decimales, escaping contractual. Gateway frontend existente se conserva. |
| P1.3 | `B/invoicing/contract-invoice.ts`; `B/invoicing/invoicing.service.ts`; `F/invoicing/interfaces/invoice.interface.ts`; `F/invoicing/interfaces/invoice-contract-editability.ts`; `F/invoicing/components/invoice-detail/invoice-detail.component.ts`; `F/invoicing/pages/invoice-create-page/invoice-create-page.component.ts` | Factura íntegra desde versión histórica, guardas previas a consecutivo, cuentas congeladas contra PUC actual, impuestos en la misma transacción, bloqueo de edición económica. |
| P1.4 | `B/contracts/contract-invoice-lifecycle.ts`; `B/contracts/contracts.controller.ts`; `B/contracts/contracts.service.ts`; `B/invoicing/invoice-flow/invoice-flow.service.ts`; `F/contracts/interfaces/contract-snapshot.interface.ts`; `F/contracts/interfaces/contract.interface.ts`; `F/contracts/services/contracts.service.ts`; `F/contracts/pages/contract-detail/contract-detail.component.ts` | Aceptación fiscal atómica/idempotente, proyección legacy sin UPDATE masivo, bloqueo de cancelación con factura activa, detalle y enlaces exactos. |
| Limpieza de settings | `F/settings/fiscal/fiscal-settings.page.ts`; `F/settings/fiscal/fiscal-settings.template.ts`; `F/invoicing/components/invoice-create/invoice-aiu-settings.service.ts`; servicios backend de facturación/flujo anteriores | UI contractual retirada de settings; defaults del documento/perfil, sin consultas AIU tenant. No borrar datos. |

Los specs hermanos y el inventario literal completo se listan abajo. No se
modificaron el calculador fiscal, UBL, dependencias, permisos/roles ni recepción.

## Migraciones y preparación pendiente

**Las dos migraciones están creadas/committeadas, pero NO se aplicaron a ninguna
base de datos.** Son aditivas/idempotentes: columnas opcionales, índice, FK de
versión y CHECK ambas columnas presentes o ambas NULL; cero backfill/borrados.
El cliente Prisma del host fue regenerado para trabajar con el nuevo esquema.
Antes de usar la web, el operador debe revisar migraciones pendientes y aplicar
estas dos mediante el flujo del repo, y asegurar que el backend utiliza un
cliente Prisma correspondiente al esquema actualizado. No se ejecutó despliegue
ni generación dentro del contenedor de backend (riesgo de memoria).

## Verificación fase 2

**32 specs puntuales / 268 tests PASS: 23 backend (221) + 9 frontend (47).**
Un archivo por invocación y nunca pruebas concurrentes. Heap 1024 MB, un worker;
Jest con transformación aislada, sin typecheck global; Angular con tsconfig
externo de un spec y bootstrap zoneless. La prueba de settings verifica el
contrato de su template, no monta toda la página/POS. El spec de readonly es
puro; no sustituye un E2E del formulario completo de factura.

| Spec ejecutado | Tests | Resultado final |
| --- | ---: | --- |
| `B/contracts/contract-invoice-lifecycle.spec.ts` | 10 | PASS |
| `B/contracts/contracts-snapshot.spec.ts` | 4 | PASS |
| `B/contracts/contracts.service.spec.ts` | 28 | PASS |
| `B/contracts/contracts.create-from-quotation.spec.ts` | 7 | PASS |
| `B/invoicing/invoice-flow/invoice-flow.contract-lifecycle.spec.ts` | 4 | PASS |
| `B/invoicing/invoice-flow/invoice-flow.aiu-emission-gates.spec.ts` | 20 | PASS |
| `B/invoicing/profiles/profile-contract-economics.spec.ts` | 14 | PASS |
| `B/invoicing/profiles/profile-preview.service.spec.ts` | 42 | PASS |
| `B/invoicing/profiles/profiles.quotation-anchor.spec.ts` | 3 | PASS |
| `B/invoicing/invoicing.service.contract-invoice.spec.ts` | 10 | PASS |
| `B/invoicing/invoicing.service.contract-creation.spec.ts` | 15 | PASS |
| `B/invoicing/contracts-invoice.spec.ts` | 4 | PASS |
| `B/invoicing/invoicing.service.aiu-matrix.spec.ts` | 11 | PASS |
| `B/invoicing/invoicing.document-aiu-defaults.spec.ts` | 1 | PASS |
| `B/quotations/quotation-contract-economics.spec.ts` | 1 | PASS |
| `B/quotations/quotations.contract-economics.spec.ts` | 16 | PASS |
| `B/quotations/quotations.profile-preload.spec.ts` | 3 | PASS |
| `B/quotations/quotations.convert-gates.spec.ts` | 5 | PASS |
| `B/quotations/dto/preview-contract-quotation.dto.spec.ts` | 8 | PASS |
| `B/backend-quotations-profiles/quotation-profile-config.spec.ts` | 8 | PASS |
| `B/quotations/quotation-contract-presentation.spec.ts` | 3 | PASS |
| `apps/backend/src/email/templates/quotation-email.template.spec.ts` | 2 | PASS |
| `B/print-formats/providers/quotation.provider.contract.spec.ts` | 2 | PASS |
| `F/settings/fiscal/fiscal-settings.page.spec.ts` | 1 | PASS |
| `F/invoicing/components/invoice-create/invoice-aiu-settings.service.spec.ts` | 1 | PASS |
| `F/contracts/services/contracts.service.spec.ts` | 7 | PASS |
| `F/contracts/pages/contract-detail/contract-detail.component.spec.ts` | 7 | PASS |
| `F/invoicing/interfaces/invoice-contract-editability.spec.ts` | 2 | PASS |
| `F/quotations/services/quotations.service.spec.ts` | 3 | PASS |
| `F/quotations/components/quotation-form-modal/quotation-form-modal.component.spec.ts` | 12 | PASS |
| `F/quotations/pages/quotation-detail/quotation-detail.component.spec.ts` | 5 | PASS |
| `F/quotations/quotations.component.spec.ts` | 9 | PASS |

Evidencia: `/tmp/vendix-phase2-*.log` y
`~/.openclaw/tmp/vendix-contratos/*.spec.log`. Los fallos iniciales se corrigieron
antes de aceptar: fixture desalineado con el motor, salida AIU tratada como input,
subtotal neto que descontaba dos veces, schema_version incorrecto, objetos de
perfil solo-warning, fixtures/títulos de Card, fakeAsync incompatible con
zoneless, date-only/nullable y shares 100% sumados en punto flotante. La primera
corrida de settings agotó el heap; se acotó el grafo de imports, no se elevó RAM.
Todos los resultados de la tabla corresponden a reintentos finales verdes.

`npm run prisma-singleton:audit`: **PASS**. Watcher frontend existente: ciclo
exitoso sin errores; backend SWC recompila los archivos y Nest arranca. Avisos
ajenos de analytics/recepción/POS y credenciales AI no se corrigen en este alcance.
**No se corrieron E2E/curl, suites completas, builds/typechecks globales, correo
real ni aceptación fiscal real**; esto no certifica un despliegue o DIAN productiva.

## Límites y decisiones aún abiertas

- **P2:** creación manual sin cotización, firma/aceptación externa y evidencia,
  entrega observable/reintentos, contenido avanzado/otrosí, actas/parciales,
  anticipos/amortización y su política fiscal permanecen fuera del alcance.
- Reversión de una factura ya aceptada mediante NC y refacturación contractual,
  o contingencia/no electrónicos: sin política adicional, no habilitar una
  cancelación silenciosa ni refacturar un contrato fiscalmente aceptado.
  Borradores/rechazados descartados o voided usan el flujo existente y no marcan
  el contrato facturado.
- Históricos sin economía completa son legibles pero no facturables por
  inferencia. Se requiere cotización nueva/revisada con perfil explícito; no se
  rellenan con settings actuales ni se reescriben masivamente.
- El motor existente no representa `no_sumada` con base de componentes AIU y
  costo positivo, ni tarifas/códigos heterogéneos en una única línea contractual.
  Se rechaza explícitamente: elegir un perfil/modelo compatible, no desactivar
  pisos ni escoger una tarifa "conservadora". Puro 100% sin costo admite importe
  comercial AIU explícito; porcentajes se detectan con `parsePercentScaled`.
- Importes base siguen la facturación canónica COP; declaración de divisa usa
  configuración congelada y el servicio TRM existente al emitir, no precios de
  catálogo ni conversiones inventadas.

## Cómo probar manualmente en la web

1. **Preparación anterior obligatoria:** aplicar ambas migraciones en el entorno
   dev autorizado y disponer del cliente Prisma actualizado. Abrir
   `https://vendix.com`, tienda `construction`, permisos/capacidades apropiados y
   habilitación fiscal válida. No usar localhost ni cuentas/datos productivos.
2. Facturación → **Perfiles**: elegir/crear perfil AIU 09 para factura de venta,
   configurar base, modelo, A/I/U, impuestos y cuentas con el editor existente.
   No configurar régimen/objeto/pisos en Configuración general; sus controles
   POS/ecommerce siguen presentes. Sin default explícito debe elegirse perfil.
3. Contratos → **Cotizar contrato**: cliente, perfil fiscal y opcional perfil de
   condiciones; objeto contractual, líneas de costo, descuentos y fecha acordada
   si crédito. Esperar preview del servidor; error/pending impide guardar.
   Revisar desglose y centavos, incluido no_sumada cuando sea compatible.
4. Guardar y abrir detalle: costos originales, líneas fiscales, perfil/versión,
   objeto, impuestos, total y términos coinciden. Imprimir vía gateway. Para
   correo, solo buzón/sink de prueba autorizado; no destinatarios reales.
5. Cambiar el perfil vigente después de cotizar: reabrir borrador conserva la
   versión congelada. Editar solo notas no renueva economía. **Usar versión
   vigente** es una revisión explícita; recalcula antes de volver a enviar.
   Limpiar fecha debe borrar realmente el acuerdo; crédito sin fecha no se envía.
6. Enviar/aceptar **administrativamente** y convertir cotización→contrato;
   revisar que heredó la revisión, líneas y condiciones cotizadas. Esto no es
   firma externa. Doble clic/reintento debe enlazar el mismo contrato.
7. Activar contrato → **Generar factura**: verificar factura borrador completa,
   mismos importes/perfil y contrato aún **vigente**, no facturado. Abrir enlace
   por ID exacto; no se permite recapturar/editar su economía. Otro draft activo
   bloquea duplicado/cancelación hasta resolver o descartar el documento.
8. Validar localmente con las acciones existentes. Rechazo/timeout/borrador no
   debe marcar facturado. Solo aceptación fiscal verificable en **entorno de
   prueba autorizado** debe hacerlo; no fabricar CUFE ni usar PATCH para simular.
   Aceptación repetida no duplica efectos. No transmitir a DIAN productiva aquí.
9. Regresión manual: cotización→venta conserva POS/orden; otra tienda no puede
   usar perfiles/clientes/contratos de la primera; históricos incompletos muestran
   aviso sin completar cifras con configuración vigente.

## Commits fase 2 (sin push)

| Hash | Mensaje |
| --- | --- |
| `ac4b2e59c` | feat(contracts): add nullable quotation economic snapshots |
| `779d83d22` | fix(contracts): synchronize status only after fiscal acceptance |
| `e2f8a8cb0` | feat(contracts): reuse billing profile economics for direct cost and AIU |
| `49ba708b2` | refactor(settings): move contract AIU configuration to billing profiles |
| `7eac6ea8d` | fix(contracts): inherit quoted snapshots and forbid manual invoiced status |
| `ff437c072` | fix(contracts): preserve billing profile versions referenced by quotations |
| `a9082457b` | feat(quotations): freeze canonical AIU economics before contract acceptance |
| `44bc0324e` | feat(contracts): invoice frozen direct cost and AIU without tenant defaults |
| `935bb57a8` | feat(contracts): display frozen AIU economics and fiscal invoice evidence |
| `835f3eb86` | fix(contracts): accept quoted object without a billing profile default |
| `3fff3eefa` | fix(invoicing): keep contract-derived drafts read-only in web capture |
| `6fb356ab1` | feat(quotations): preview billing-profile contract economics in web forms |
| `28f1cc966` | feat(quotations): render frozen contract economics in email and print |
| `8613c76aa` | fix(contracts): ignore mutable profile metadata for accepted agreements |
| `8094c6cad` | feat(quotations): show frozen fiscal breakdown and preserve exact cents |
| `e08958b8f` | fix(contracts): validate frozen accounts against the current fiscal scope |
| `7e6ad28af` | fix(quotations): preserve explicit dates and scaled AIU percentage inputs |
| `75f550016` | fix(contracts): validate agreed due dates in the store business timezone |

El commit documental final añade este registro y corrige únicamente la etiqueta
de timezone de un spec; su hash se informa en la respuesta de entrega.

## Inventario literal de archivos fase 2

```text
apps/backend/prisma/migrations/20261011010000_quotation_contract_economic_snapshot/migration.sql
apps/backend/prisma/migrations/20261011011000_quotation_invoice_profile_anchor/migration.sql
apps/backend/prisma/schema.prisma
apps/backend/src/domains/store/contracts/contract-invoice-lifecycle.spec.ts
apps/backend/src/domains/store/contracts/contract-invoice-lifecycle.ts
apps/backend/src/domains/store/contracts/contracts-snapshot.spec.ts
apps/backend/src/domains/store/contracts/contracts-snapshot.ts
apps/backend/src/domains/store/contracts/contracts.controller.ts
apps/backend/src/domains/store/contracts/contracts.create-from-quotation.spec.ts
apps/backend/src/domains/store/contracts/contracts.service.spec.ts
apps/backend/src/domains/store/contracts/contracts.service.ts
apps/backend/src/domains/store/invoicing/contract-invoice.ts
apps/backend/src/domains/store/invoicing/contracts-invoice.spec.ts
apps/backend/src/domains/store/invoicing/invoice-flow/invoice-flow.aiu-emission-gates.spec.ts
apps/backend/src/domains/store/invoicing/invoice-flow/invoice-flow.contract-lifecycle.spec.ts
apps/backend/src/domains/store/invoicing/invoice-flow/invoice-flow.service.ts
apps/backend/src/domains/store/invoicing/invoicing.document-aiu-defaults.spec.ts
apps/backend/src/domains/store/invoicing/invoicing.service.contract-creation.spec.ts
apps/backend/src/domains/store/invoicing/invoicing.service.contract-invoice.spec.ts
apps/backend/src/domains/store/invoicing/invoicing.service.ts
apps/backend/src/domains/store/invoicing/profiles/profile-contract-economics.spec.ts
apps/backend/src/domains/store/invoicing/profiles/profile-contract-economics.ts
apps/backend/src/domains/store/invoicing/profiles/profile-preview.service.ts
apps/backend/src/domains/store/invoicing/profiles/profiles.quotation-anchor.spec.ts
apps/backend/src/domains/store/invoicing/profiles/profiles.service.ts
apps/backend/src/domains/store/print-formats/providers/quotation.provider.contract.spec.ts
apps/backend/src/domains/store/print-formats/providers/quotation.provider.ts
apps/backend/src/domains/store/quotations/dto/create-quotation.dto.ts
apps/backend/src/domains/store/quotations/dto/preview-contract-quotation.dto.spec.ts
apps/backend/src/domains/store/quotations/dto/preview-contract-quotation.dto.ts
apps/backend/src/domains/store/quotations/quotation-contract-economics.spec.ts
apps/backend/src/domains/store/quotations/quotation-contract-economics.ts
apps/backend/src/domains/store/quotations/quotation-contract-presentation.spec.ts
apps/backend/src/domains/store/quotations/quotation-contract-presentation.ts
apps/backend/src/domains/store/quotations/quotations.contract-economics.spec.ts
apps/backend/src/domains/store/quotations/quotations.controller.ts
apps/backend/src/domains/store/quotations/quotations.module.ts
apps/backend/src/domains/store/quotations/quotations.profile-preload.spec.ts
apps/backend/src/domains/store/quotations/quotations.service.ts
apps/backend/src/email/templates/quotation-email.template.spec.ts
apps/backend/src/email/templates/quotation-email.template.ts
apps/frontend/src/app/private/modules/store/contracts/interfaces/contract-snapshot.interface.ts
apps/frontend/src/app/private/modules/store/contracts/interfaces/contract.interface.ts
apps/frontend/src/app/private/modules/store/contracts/pages/contract-detail/contract-detail.component.spec.ts
apps/frontend/src/app/private/modules/store/contracts/pages/contract-detail/contract-detail.component.ts
apps/frontend/src/app/private/modules/store/contracts/services/contracts.service.spec.ts
apps/frontend/src/app/private/modules/store/contracts/services/contracts.service.ts
apps/frontend/src/app/private/modules/store/invoicing/components/invoice-create/invoice-aiu-settings.service.spec.ts
apps/frontend/src/app/private/modules/store/invoicing/components/invoice-create/invoice-aiu-settings.service.ts
apps/frontend/src/app/private/modules/store/invoicing/components/invoice-detail/invoice-detail.component.ts
apps/frontend/src/app/private/modules/store/invoicing/interfaces/invoice-contract-editability.spec.ts
apps/frontend/src/app/private/modules/store/invoicing/interfaces/invoice-contract-editability.ts
apps/frontend/src/app/private/modules/store/invoicing/interfaces/invoice.interface.ts
apps/frontend/src/app/private/modules/store/invoicing/pages/invoice-create-page/invoice-create-page.component.ts
apps/frontend/src/app/private/modules/store/quotations/components/quotation-form-modal/quotation-form-modal.component.spec.ts
apps/frontend/src/app/private/modules/store/quotations/components/quotation-form-modal/quotation-form-modal.component.ts
apps/frontend/src/app/private/modules/store/quotations/interfaces/quotation-contract-economics.interface.ts
apps/frontend/src/app/private/modules/store/quotations/interfaces/quotation.interface.ts
apps/frontend/src/app/private/modules/store/quotations/pages/quotation-detail/quotation-detail.component.spec.ts
apps/frontend/src/app/private/modules/store/quotations/pages/quotation-detail/quotation-detail.component.ts
apps/frontend/src/app/private/modules/store/quotations/quotations.component.spec.ts
apps/frontend/src/app/private/modules/store/quotations/quotations.component.ts
apps/frontend/src/app/private/modules/store/quotations/services/quotations.service.spec.ts
apps/frontend/src/app/private/modules/store/quotations/services/quotations.service.ts
apps/frontend/src/app/private/modules/store/settings/fiscal/fiscal-settings.page.spec.ts
apps/frontend/src/app/private/modules/store/settings/fiscal/fiscal-settings.page.ts
apps/frontend/src/app/private/modules/store/settings/fiscal/fiscal-settings.template.ts
docs/contracts-admin-execution.md
```

## Registro histórico de fase 1

<details>
<summary>P0.1–P0.4 y P1.1: estado al cerrar la entrega administrativa anterior (NO describe el alcance vigente)</summary>

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


</details>
