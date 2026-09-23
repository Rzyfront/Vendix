---
id: ADR-12
title: "Cancelar ventas cobradas conserva pagos y registra reembolsos verificables"
status: accepted
reversibility: costly
updated: 2026-09-23
---
# ADR-12 — Cancelar ventas cobradas conserva pagos y registra reembolsos verificables

- **Context:** I.2 encontró cancelaciones sin artefacto de devolución y un 409 para pagos no efectivos que deriva a un flujo de reembolso inaccesible en `processing`. `payments.state=succeeded` es un hecho histórico; cambiarlo a `cancelled` no devuelve dinero. Las ventas a crédito tienen además saldo CxC que no puede sobrevivir a la cancelación.
- **Decision:** El dueño eligió el 2026-09-23 permitir la cancelación de ventas con tarjeta presencial, transferencia y pasarelas Wompi/Stripe/PayPal, creando un `refund` **pendiente** por cada monto efectivamente recibido; no ejecutar ni afirmar una reversa automática por el solo hecho de cancelar. En pagos mixtos, devolver efectivo de caja en el acto y dejar solamente la parte no efectiva como pendiente. El pago original sigue liquidado en el historial. Para cerrar manualmente un reembolso se exige nota, canal real de egreso y referencia/comprobante; `completed` no puede significar «solicitado». En crédito/fiado, anular el saldo CxC no recibido y crear reembolso pendiente solo por abonos reales. Una factura electrónica **aceptada por DIAN** bloquea la cancelación hasta que exista su nota crédito correspondiente.
- **Consequences:** La cancelación de orden y creación de artefactos deben ser atómicas e idempotentes bajo el lock de ciclo de vida; cada pierna de pago se identifica para no duplicar reembolsos en reintento. El cierre efectivo de reembolso y su contabilidad son otra transición; no se simula salida bancaria. El egreso de caja se escribe una sola vez por efectivo realmente devuelto. `total_paid` y CxC se concilian sin borrar ni mutar pagos históricos. El detalle y la API muestran estado pendiente y siguiente acción. La nota crédito DIAN es precondición, no efecto oculto de cancelar.
- **Reversibility:** costly — las cancelaciones, movimientos de caja, reembolsos y notas crédito emitidas son hechos históricos; revertir código no los borra.
- **Revisit if:** se implementa reversa automática por pasarela con webhook verificable, o una política legal/contable cambia la secuencia de nota crédito.
