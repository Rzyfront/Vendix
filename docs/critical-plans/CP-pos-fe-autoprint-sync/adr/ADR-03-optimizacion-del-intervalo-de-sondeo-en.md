---
id: ADR-03
title: "Optimización del intervalo de sondeo en PosFiscalStatusComponent"
status: proposed
reversibility: trivial
updated: 2026-09-10
---
# ADR-03 — Optimización del intervalo de sondeo en PosFiscalStatusComponent

- **Context:** En `PosFiscalStatusComponent`, el intervalo de sondeo para consultar el estado fiscal de la venta estaba configurado rígidamente en 5000 ms (`POLL_MS = 5000`). La emisión automática en el backend suele resolverse entre 1.2s y 2.5s. Con un intervalo de 5 segundos, el cajero y el cliente experimentaban un retraso innecesario de hasta 5 segundos completos antes de que el frontend se enterara de que la factura ya había sido aceptada por la DIAN.
- **Decision:** Optimizar el intervalo de sondeo hacia un esquema adaptativo más ágil para el mostrador:
  - Primer reintento a los 1500 ms tras la carga inicial.
  - Segundo reintento a los 2500 ms.
  - Reintentos subsiguientes cada 4000 ms hasta alcanzar el límite máximo de sondeos.
  - Detener el sondeo de inmediato tan pronto el estado cambie a `issued`, `failed` o `contingency`.
- **Consequences:** El tiempo promedio de espera para la auto-impresión de la Factura Electrónica en caja se reduce de ~5-6 segundos a ~1.8-2.5 segundos, acelerando la atención en el punto de venta.
- **Reversibility:** trivial — Es una constante de configuración temporal en el componente frontend.
- **Revisit if:** Se implementa WebSockets o Server-Sent Events (SSE) directos para notificar la aceptación DIAN al POS en tiempo real sin sondeo.
