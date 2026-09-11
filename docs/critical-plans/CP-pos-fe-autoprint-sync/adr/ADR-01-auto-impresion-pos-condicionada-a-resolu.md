---
id: ADR-01
title: "Auto-impresión POS condicionada a resolución de Factura Electrónica"
status: proposed
reversibility: costly
updated: 2026-09-10
---
# ADR-01 — Auto-impresión POS condicionada a resolución de Factura Electrónica

- **Context:** En el POS, cuando una tienda tiene activa la emisión de Factura Electrónica (FE) y la auto-impresión de recibos, `maybeAutoPrint()` en `PosOrderConfirmationComponent` dispara inmediatamente al abrir el modal (milisegundo 0). Como la emisión ante la DIAN es asíncrona en segundo plano (`pos.sale.completed`), el backend aún no tiene la factura emitida al consultar `resolve-for-document`. El PrintFiscalGate degrada a `pos_sale_ticket` con leyenda "COPIA INFORMATIVA", imprimiendo un ticket prematuro. Posteriormente, un guard incorrecto (`if (!this.awaitingManualEmit) return;`) impedía imprimir la factura real cuando la DIAN finalmente respondía `issued`.
- **Decision:** Condicionar la auto-impresión en `PosOrderConfirmationComponent` según el estado fiscal del comercio:
  1. Si la tienda NO emite FE o tiene `auto_emit: false`, la impresión se lanza de inmediato al cerrar la venta (comportamiento sin latencia para comercios sin FE).
  2. Si la tienda emite FE y `auto_emit: true`, `maybeAutoPrint()` retiene la impresión en estado encolado (`awaitingFiscalPrint = true`) sin disparar el hardware.
  3. Cuando `PosFiscalStatusComponent` notifica `statusChanged` con `state === 'issued'` (o `contingency`), se dispara una única impresión, imprimiendo la Factura Electrónica oficial con CUFE y número DIAN.
  4. Se implementa un temporizador de salvaguarda de 10 segundos para no bloquear la caja indefinidamente si la DIAN experimenta latencia externa severa.
- **Consequences:** Se elimina la condición de carrera y la doble impresión. Los clientes reciben la Factura Electrónica legal en papel térmico en lugar de un borrador informativo. Se añade una pequeña espera de 1.5 a 3 segundos en el mostrador únicamente para ventas con FE mientras la DIAN aprueba.
- **Reversibility:** costly — Revertir requeriría desacoplar nuevamente la sincronización y volver a imprimir tiquetes simples en comercios que emiten FE.
- **Revisit if:** La DIAN implementa un protocolo síncrono sub-100ms o si se decide generar documentos fiscales offline pre-firmados.
