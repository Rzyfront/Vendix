# Ronda 0 — revalidacion del orquestador (2026-09-11)

Ronda previa al plan: cada HIGH/MEDIUM del review PR-793 se verifico por segunda via independiente.

## F-001 — CONFIRMADO (blocker)

Evidencia: transpile con el TypeScript del repo (`node -e transpileModule`, independiente del `tsc` del revisor).
`invoice-detail.component.ts` -> 4 errores TS1005 (@726, @727, @1198); `invoice-create-page.component.ts` -> 7 errores (@1550, @1551, @3016, @3017).
Ambos usan `template: \`` inline (lineas 80 y 1514): los backticks de los comentarios HTML cierran el literal.

## F-002 — CONFIRMADO (major)

Evidencia: `grep -rn 'abandoned'` en `apps/backend/src/domains/ecommerce/` + scripts devuelve cero escritores; `customers-analytics.service.ts` tiene 33 menciones lectoras (5 queries con `state = 'abandoned'` + `EXISTS items`).

## F-003 — CONFIRMADO (major)

Evidencia: `git diff origin/main..origin/develop -- pqr-detail-page.component.ts` muestra `- signal(true)` / `+ signal(false)` en `isInternal` y `- signal(false)` / `+ signal(true)` en `notifyRequester`.

## F-004 — CONFIRMADO (major, con directiva)

Evidencia: `toggle.component.ts:40` = `isDisabled() ? muted : isOn() ? primary : danger`. Directiva de usuario: mantener codigo, corregir comentario (ADR-02, QUI-801).

## F-005 — CONFIRMADO (minor, con directiva)

Evidencia: `checkout.component.ts:1766` = `shippable.find(postal_code_match) ?? shippable[0]`. Directiva de usuario: no tocar logica, solo comentario (ADR-03).

## Falsos positivos descartados en Ronda 0

Ciclo NestJS credit-notes, `where: { order_id }` invalido, CRLF en emails PQR, `ROUND_DOWN` de checkout, SQLi en analytics, gate de auto-impresion anulado: todos refutados con evidencia y registrados como no-findings.
