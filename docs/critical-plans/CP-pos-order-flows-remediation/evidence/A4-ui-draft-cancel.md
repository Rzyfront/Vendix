# A.4 Cancelación de borrador desde detalle real

Playwright contra `https://vendix.com` con usuario dueño de la tienda QA local #10: POS «Guardar / Espera» → Para llevar → alias `QA A4 cancel UI 20260923` → Guardar borrador. `POST /api/store/payments/pos` respondió **201** con orden #1135 (`POS-2026-0329`), IVA 0, total $38.000. «Ver detalle» navegó a `/admin/orders/1135`: estado BORRADOR, menú de ACCIONES con **Registrar Pago**, **Modificar Orden** y **Cancelar Orden** (`A4-ui-draft-detail.png`).

«Cancelar Orden» abrió confirmación no destructiva con razón obligatoria (`A4-ui-cancel-confirm.png`). Se ingresó `QA A4 borrador abandonado desde UI`; `POST /api/store/orders/1135/flow/cancel` respondió **200**, `data.state=cancelled`. La página mostró CANCELADA, razón e historial, y sustituyó las acciones por **Reactivar Orden** (`A4-ui-cancelled.png`). No hubo DELETE. SQL: `A4-ui-integrity.sql/txt` comprueba cero pagos y reservas para #1135 y cero sesiones abiertas a órdenes canceladas en la tienda.

El guard de mesa abierta permanece cubierto por `A4-local-api-verification.md`: borrador #1105/sesión #103 retornó 409 `ORD_CANCEL_OPEN_TABLE_001` con `table_session_id` y no cambió su estado. Sin cambios de configuración ni datos de producción.
