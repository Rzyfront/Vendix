# B.1 — Item "cero llamadores" DESCARTADO (precondición invalidada)

- **Step:** B.1 — Extraer la proyección canónica del cobro sobre la sesión
- **Item:** "Ningún archivo de producción llama todavía a la función nueva"
- **Veredicto:** `[-] Descartado: precondición invalidada por B.2 parcial 71d62c94a`
- **Autorizó:** boss (orquestador) 2026-09-24
- **Fecha evidencia:** 2026-09-24 (HEAD 2431a1152)

## Por qué es incumplible

El checkpoint base 2431a1152 ya trae el corte B.2 parcial: el commit
71d62c94a (`fix(pos): project credit settle + isolate confirm projection
failures (B.2/T5)`) es ancestro de HEAD y con él aterrizaron llamadores de
producción de `projectOrderPaymentToTableSession`. La precondición de B.1
("cero llamadores nuevos en este paso") describe un árbol anterior al
checkpoint y no el árbol real de ejecución.

Evidencia cruda: `evidence/B.1-callers.txt` (28 líneas, definición + specs +
producción).

## Llamadores de producción existentes (verificado 2026-09-24)

| # | Archivo:línea | Contexto | Escritor B.2 |
|---|---|---|---|
| 1 | `apps/backend/src/domains/store/payments/payments.service.ts:1384` | `processPosPayment`: proyecta dentro de la tx del pago, `emitAfterCommit` post-commit | Escritor 1 (POS) |
| 2 | `apps/backend/src/domains/store/tables/split-account-payment.service.ts:550` | split totalmente pagado: proyecta en tx, emite post-commit | Escritor 2 (split) |
| 3 | `apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts:1624` | helper `projectPaidOrderToTable`: lo usan `payOrder` y `confirmPayment` | Escritor 4 (`flow/pay`) |
| 4 | `apps/backend/src/domains/store/tables/table-sessions.service.ts:2725` | auto-llamada desde `confirmPayment` (FB-53), post-commit con ERR-33 capturado | Confirmador sesión |

(Definición en `table-sessions.service.ts:1761`; referencia de tipo en
`split-account-payment.service.ts:546` — no es llamada.)

Comando: `grep -rn "projectOrderPaymentToTableSession" apps/backend/src
--include="*.ts" | grep -v ".spec.ts"`

## Obligación aparejada (B.2)

B.2 debe verificar que cada llamador listado pasa por la proyección canónica
—es su propósito— y enlazar esta evidencia en ambos sentidos. Auditoría s1
(fox, 2026-09-24): los 4 escritores + FB-53/FB-12 ya delegan; ningún path de
pago escribe `table_sessions` directo ni llama `closeSession`; ver step B.2.
