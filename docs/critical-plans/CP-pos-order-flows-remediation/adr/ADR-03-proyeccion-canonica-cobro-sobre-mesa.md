---
id: ADR-03
title: "Una sola proyección del cobro sobre la sesión de mesa"
status: accepted
reversibility: costly
updated: 2026-09-20
---
# ADR-03 — Una sola proyección del cobro sobre la sesión de mesa

- **Context:** Cuatro escritores proyectan el cobro de una orden sobre su sesión de mesa con cuatro semánticas distintas: `processPosPayment` marca `paid_at` y deja la mesa ocupada (`payments.service.ts:3901-3936`, `closedSessionId = null`), `split-account-payment` marca y emite evento (`:545-575`), `webhook-handler` cierra la sesión y pasa la mesa a `cleaning` (`:629`), y `OrderFlowService.payOrder` no hace absolutamente nada. Por eso cobrar desde el detalle de la orden no se refleja en la mesa: el carril que usa esa pantalla es justo el que no proyecta. El evento `session_paid` existe (`table-sessions.service.ts:1628-1654`) pero el whitelist default-deny del SSE de staff no lo incluye (`table-sessions.controller.ts:51-82`) y ningún cliente lo escucha.
- **Decision:** Extraer `projectOrderPaymentToTableSession(orderId, paymentId)` como única función que escribe el efecto de un cobro sobre `table_sessions`, e invocarla desde los cuatro escritores. La primitiva ya existe y **no hay que escribirla**: `markSessionPaid` (`table-sessions.service.ts:1542`) es idempotente sobre `paid_at`, acepta `tx` opcional y deja la mesa `occupied` — exactamente la semántica elegida. La función canónica la envuelve y resuelve alrededor de ella la sesión vigente, el evento y la transacción. La proyección marca la cuenta como pagada y **deja la mesa ocupada**; el cierre y el paso a `cleaning` siguen siendo un acto explícito del mesero. El dueño lo decidió el 2026-09-20: *"Marcar pagada y mesa sigue ocupada, pero unificar en una fuente de verdad los flujos de cobro y los escritores"*. La proyección es idempotente: `paid_at` es re-derivable de `payments`, así que re-ejecutarla no produce efecto nuevo.
- **Consequences:** N5 (el «error súper grave») deja de ser un parche en un quinto escritor y pasa a ser la consecuencia natural de la unificación. `webhook-handler` pierde su cierre automático, que era la divergencia más peligrosa: un pago en línea cerraba la mesa mientras el cliente seguía sentado. El evento entra al whitelist y la página de mesa se suscribe. Los cuatro escritores previos se conservan intactos hasta el paso de corte, lo que hace el rollback trivial por escritor.
- **Reversibility:** costly — revertir devuelve las cuatro semánticas divergentes, que es el defecto de origen.
- **Revisit if:** aparece un quinto carril de cobro con una semántica genuinamente distinta (por ejemplo prepago de mesa antes de sentarse); entonces la proyección recibe un modo, no un quinto escritor.
