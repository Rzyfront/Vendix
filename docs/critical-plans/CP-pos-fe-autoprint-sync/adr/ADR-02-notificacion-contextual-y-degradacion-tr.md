---
id: ADR-02
title: "Notificación contextual y degradación transparente a ticket ante fallo o timeout"
status: proposed
reversibility: trivial
updated: 2026-09-10
---
# ADR-02 — Notificación contextual y degradación transparente a ticket ante fallo o timeout

- **Context:** Cuando la emisión de la Factura Electrónica falla (por ejemplo, rechazo DIAN, prevalidación bloqueante por datos de cliente faltantes, o caída del servicio de impuestos) o excede el tiempo límite de espera de 10 segundos, el cajero necesita entregar un comprobante físico al cliente sin demorar la fila. Sin embargo, si el sistema imprime silenciosamente un ticket de venta en lugar de la factura electrónica esperada, el operador asume erróneamente que la impresora o el sistema de impresión falló o perdió datos.
- **Decision:** Implementar una degradación transparente con notificación proactiva:
  1. Si `onFiscalStatus` recibe `state === 'failed'`, o si expira el temporizador de espera de 10s:
     - El flujo encolado libera la impresión imprimiendo el tiquete de venta de respaldo (`pos_sale_ticket`).
     - Se notifica explícitamente en la interfaz mediante Toast de advertencia y un banner informativo visible en el modal de confirmación:
       "No se pudo emitir la factura electrónica ([motivo/timeout]). Se imprimió un ticket de venta como comprobante de contingencia."
  2. Si el cajero pulsa "Nueva compra" antes de que la DIAN responda, el encolado pendiente se cancela limpiamente para no imprimir a destiempo en la siguiente venta.
- **Consequences:** El operador comprende inmediatamente por qué se imprimió un tiquete y cuál fue la causa fiscal (rechazo DIAN, datos incompletos o timeout), distinguiendo el estado fiscal de la operación de impresión física.
- **Reversibility:** trivial — Los mensajes y banners se pueden ajustar o suprimir en cualquier momento sin impacto en la base de datos.
- **Revisit if:** El flujo de caja requiere bloquear la entrega del ticket hasta que el cajero corrija manualmente los datos fiscales.
