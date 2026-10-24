---
id: ADR-01
title: "Atribución inmutable de orden a sesión origen"
status: accepted
reversibility: costly
updated: 2026-10-06
---
# ADR-01 — Atribución inmutable de orden a sesión origen

- **Context:** No hay FK orden→sesión; movimientos sólo existen después de pagos y pueden pertenecer a otro turno.
- **Decision:** Agregar `origin_cash_session_id` nullable con FK compuesta a la misma tienda. Fijarlo una vez al persistir orden POS con sesión propia abierta, bajo lock de sesión; editor/pago no lo reasignan. No backfill desde `sale`: ese movimiento prueba cobro, no creación. Sesiones existentes se marcan sin tracking y nunca se atribuyen por inferencia; las nuevas se abren con tracking. La UI avisa sólo si el endpoint devuelve órdenes pendientes por estado o saldo.
- **Consequences:** Más migración e integración POS/checkout; pedidos legacy permanecen null y nunca se atribuyen silenciosamente.
- **Reversibility:** costly — afecta contratos, datos y auditoría.
- **Revisit if:** Producto decide atribuir por primer cobro y renuncia explícitamente a drafts.
