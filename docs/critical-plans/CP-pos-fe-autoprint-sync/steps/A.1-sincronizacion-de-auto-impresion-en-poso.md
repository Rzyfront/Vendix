---
id: A.1
title: "Sincronización de auto-impresión en PosOrderConfirmationComponent"
phase: A
status: done
owner: rzy
updated: 2026-09-10
contracts: [FB-01, FB-03, DB-01]
adrs: [ADR-01]
skills: [vendix-frontend, vendix-zoneless-signals]
---
# A.1 — Sincronización de auto-impresión en PosOrderConfirmationComponent

- **Skills:** vendix-frontend, vendix-zoneless-signals
- **Resources:** apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts
- **Business decision:** En comercios con Factura Electrónica y auto-emisión activa, la auto-impresión se retiene hasta que la DIAN responde, garantizando que el papel emitido sea la Factura Electrónica legal con CUFE.
- **Why:** La auto-impresión inmediata provocaba una condición de carrera donde el documento se imprimía antes de que la DIAN lo procesara, saliendo como ticket de borrador en lugar de factura fiscal.
- **Output:** `PosOrderConfirmationComponent` sincronizado con señales reactivas `awaitingFiscalPrint` y temporizador de seguridad de 10s.
- **Contracts touched:** FB-01, FB-03, DB-01
- **Data impact:** none — Modificación exclusiva de orquestación client-side de eventos de impresión.
- **Blast radius:** Si la lógica falla, la auto-impresión podría retrasarse o no dispararse automáticamente al cerrar la venta, requiriendo pulsar "Imprimir".
- **Rollback:** `git checkout HEAD -- apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts`
- **Verification:**
  - `npm run test -- apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.spec.ts`
- **Acceptance checklist:**
  - [x] Validar si la tienda emite FE y auto_emit está activo antes de decidir si encolar
  - [x] Encolar auto-impresión (`awaitingFiscalPrint = true`) si la tienda emite FE
  - [x] Disparar auto-impresión inmediata si la tienda no emite FE
  - [x] Iniciar timeout de seguridad de 10 segundos para fallback automático
  - [x] Desencadenar `printReceipt()` cuando `statusChanged` emita `state === 'issued'`
  - [x] Prevenir re-ejecución múltiple de la impresión con guardia `autoPrintedOrderId`
  - [x] F-002 — Proteccion de reentrada en la impresion para evitar disparos dobles (major)
  - [x] F-003 — Degradacion a tiquete de contingencia ante particion de red o fallo 5xx (major)
- **Status:** done
