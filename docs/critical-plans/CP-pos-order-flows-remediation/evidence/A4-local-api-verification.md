# A.4 — API local de cancelación de borrador (2026-09-23 UTC)

Entorno local, tienda seed 10, sin producción. La orden QA 1104 se creó en `draft` sin mesa (`A4-create-draft.*`). `GET /store/orders/1104` devolvió `cancellation_policy.can_cancel=true`; `POST /store/orders/1104/flow/cancel` devolvió 200 y persistió `state=cancelled` con `_flow_metadata.previous_state=draft`. Pagos y reservas activas: 0 antes/después.

Se creó la mesa QA 11 y se abrió la sesión 103 con orden `draft` 1105 (`A4-open-table.*`). La política devolvió `can_cancel=false`, `reason_code=ORD_CANCEL_OPEN_TABLE_001`; la cancelación devolvió 409 con `details.table_session_id=103`. SQL posterior: la orden 1105 sigue `draft`, sesión 103 abierta, 0 pagos/reservas. Consulta de integridad para la tienda 10: 0 sesiones abiertas que apunten a órdenes `cancelled`.

Evidencia HTTP: archivos `A4-*.request.json`, `A4-*.headers`, `A4-*.response.json`. Se guardó un subconjunto seguro de las respuestas (sin datos ajenos ni tokens). Backend: `order-flow.service.spec.ts` y `order-cancellation-policy.util.spec.ts`, 129 tests pasados. Frontend watcher OK y backend health 200. **Pendiente:** Playwright MCP/UI real, no disponible en esta sesión; paso permanece `in-progress`.
