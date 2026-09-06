# Evidencia F-001/F-002 — bloqueo mutuo venta/contrato

Fecha: 2026-09-06. Ejecutor: orquestador.

- Cambio: `convertToOrder` rechaza destino distinto de `sale` con
  `QUOTE_DESTINATION_001` (detalles: quotation_id, destination,
  required_destination). Mapa con `accepted->contracted` y `contracted`
  terminal; `converted` intacto.
- Spec: `apps/backend/src/domains/store/quotations/quotations.convert-gates.spec.ts`
  (rechazo en `contract`/`other` sin crear orden + mapa). Runner del repo:
  `npm run buildcheck:test -- src/domains/store/quotations/quotations.convert-gates.spec.ts`
  → `backend-tests PASS (8s)`, exit 0, 2026-09-06 07:01:53Z.
- Decision registrada: sin `contracted_at`; la fecha vive en `contracts.created_at`.
