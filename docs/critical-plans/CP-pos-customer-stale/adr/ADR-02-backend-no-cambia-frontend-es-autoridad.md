---
id: ADR-02
title: "Backend no cambia, frontend es autoridad del customer_id"
status: proposed
reversibility: trivial
updated: 2026-09-11
---
# ADR-02 — Backend no cambia, frontend es autoridad del customer_id

- **Context:** `POST /store/payments/pos` valida pertenencia del customer a la tienda y persiste lo recibido; no adivina ni re-resuelve.
- **Decision:** No cambiar DTO ni servicio de pagos; el fix vive en el selector y la sincronización de estado frontend.
- **Consequences:** Blast radius mínimo, sin riesgo DIAN/PUC; la regresión se concentra en UI y payload.
- **Reversibility:** trivial — no hay contrato ni migración que deshacer.
- **Revisit if:** Aparece evidencia de que el backend sobrescribe customer_id en algún flujo alterno.
