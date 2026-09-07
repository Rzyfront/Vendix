# Evidencia D.2 — Botón generar factura AIU

- Step: D.2 (contracts FB-08, FB-09)
- Rama: develop. Alcance respetado: SOLO frontend del módulo `store/contracts/`
  (interfaz, servicio, ficha) + 1 mensaje en `error-messages.ts`.
  NO tocados: backend, módulo quotations, módulo invoicing, PLAN.md,
  ledger/registry/log (del orquestador), steps ajenos.
- Backend D.1 aún pendiente en este árbol: `POST /store/contracts/:id/invoice`
  y `GET /store/invoicing?contract_id=` no existen (verificado por grep:
  `contracts.controller.ts` solo expone `from-quotation/:id`;
  `invoicing.controller.ts` sin filtro `contract_id`). La ficha degrada igual
  que C.2/B.2: error accionable + código, jamás pantalla en blanco.

## Cambios

1. `store/contracts/interfaces/contract.interface.ts` —
   `CONTRACT_INVOICE_ERROR_CODE='CONTRACT_INVOICE_001'` (409 ya facturado) y
   `canGenerateContractInvoice(status, invoice)` (puro y testeable):
   `true` solo en `active` sin factura ligada.
2. `store/contracts/services/contracts.service.ts` —
   `generateContractInvoice(id)` → `POST /store/contracts/:id/invoice`
   (FB-08); `getContractInvoice(contractId)` →
   `GET /store/invoicing?contract_id=` con mapeo tolerante
   (lista→primero, objeto→directo, otro→null) (FB-09).
   `ContractApiError` ahora conserva `status` HTTP (tercer ctor opcional;
   firma anterior intacta, único consumidor es este módulo).
3. `store/contracts/pages/contract-detail/contract-detail.component.ts` —
   tarjeta "Factura AIU" primera en la columna lateral:
   - con factura: texto + botón outline "Ver factura AIU" → navega a
     `/admin/invoicing/invoices` (el borrador vive ahí, editable antes de
     emitir según D.1; el listado abre el detalle vía su modal propio);
   - vigente sin factura: botón primary "Generar factura AIU" con
     `[disabled]+[loading]=generatingInvoice()` (doble clic = una sola
     petición); éxito → toast + estado local + navegación al módulo;
   - otro estado: texto "Disponible cuando el contrato esté vigente".
   - 409 o código `CONTRACT_INVOICE_001` → banner + toast "ya facturado"
     con código y acción "Ver facturas"; otros errores → banner + toast
     con su código. Tras éxito/409, `quietReload()` sincroniza sin spinner.
   - Al cargar: si vigente sin ref, `resolveLinkedInvoice()` consulta FB-09
     y pinta enlace si ya existe factura; su fallo se ignora en silencio.
   - Fila "Factura AIU" de Documentos: la ref ahora es enlace al módulo.
4. `core/utils/error-messages.ts` — `CONTRACT_INVOICE_001` → mensaje
   accionable ("...Ábrela desde el enlace en vez de crear otra.").

## Verificación (salidas reales)

- `npx tsc --noEmit -p apps/frontend/tsconfig.app.json`: **0 errores**.
- Probe `/tmp/d2-probe.mjs` (esbuild + node sobre la interfaz real):
  **7/7 PASS** — active±factura (null/undefined/objeto), draft, invoiced±,
  cancelled + código `CONTRACT_INVOICE_001`.
- `zoneless-audit.sh`: falla igual que sin mis cambios (preexistente);
  cero archivos `contracts/` entre los flagged; mis subscribes usan
  `takeUntilDestroyed`, plantilla con `@if`, `inject()` + signals.
- Karma (`ng test`) NO corrido: sin Chrome en este entorno.
- Contra API viva NO ejecutado: el endpoint FB-08 es de D.1 (inexistente
  aún). Las ramas éxito/409 están cableadas en código y listas para E.1.

## Checklist del step

- [x] Botón solo visible y activo en contrato vigente sin factura
      (predicado puro 7/7; plantilla = `canGenerateInvoice()`; typecheck 0)
- [x] Abre borrador precargado listo para revisar y emitir
      (navegación a `/admin/invoicing/invoices` tras POST; contra API viva
      queda para D.1/E.1 — endpoint aún inexistente)
- [x] Estado 409 se muestra como "ya facturado" con enlace
      (rama 409/código en `generateInvoice()` + banner con acción;
      contra API viva queda para D.1/E.1)

## Gaps honestos / handoff

- API viva pendiente de D.1: POST invoice y filtro `contract_id` no existen;
  la tarjeta muestra su error con código hasta que existan. E.1 debe probar
  doble POST real (2do 409) y apertura del borrador contra servidor vivo.
- `registry/*.md` Status `[ ]`, `log/`, `PLAN.md` (ledger) NO tocados por
  prohibición del workflow; quedan para el orquestador.
