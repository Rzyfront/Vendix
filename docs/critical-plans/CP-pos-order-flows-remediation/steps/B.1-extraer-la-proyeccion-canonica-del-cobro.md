---
id: B.1
title: "Extraer la proyección canónica del cobro sobre la sesión"
phase: B
status: in-progress
owner: Bernoulli
updated: 2026-09-20
contracts: [DB-17, DB-18, DB-19, DB-20, DB-21, ERR-33]
adrs: [ADR-03]
skills: [vendix-backend, vendix-restaurant-ops, vendix-error-handling, vendix-prisma-scopes, how-to-test]
---
# B.1 — Extraer la proyección canónica del cobro sobre la sesión

- **Skills:** `vendix-backend` (una función nueva en el servicio de sesiones, con `tx` opcional y sin ciclo de imports contra `payments`) · `vendix-restaurant-ops` (la semántica de mesa: pagada no es cerrada) · `vendix-error-handling` (ERR-33 entra al catálogo tipado, no como excepción cruda) · `vendix-prisma-scopes` (la resolución de la sesión vigente se consulta dentro del alcance de tienda) · `how-to-test`.
- **Resources:** ADR-03 (decisión, primitiva elegida y semántica) · `apps/backend/src/domains/store/tables/table-sessions.service.ts:1542-1626` (`markSessionPaid`: idempotente sobre `paid_at`, acepta `tx` opcional, deja la mesa `occupied`) y `:1628-1654` (`emitSessionPaid`) · `apps/backend/src/domains/store/payments/payments.service.ts:3828` y `:1983` (el único escritor que hoy ya tiene la forma correcta: marcar en tx, emitir post-commit) · `apps/backend/src/domains/store/tables/split-account-payment.service.ts:556` y `:572` · `apps/backend/src/domains/store/payments/services/webhook-handler.service.ts:601-660` · `apps/backend/prisma/schema.prisma` modelo `table_sessions` (`paid_at`, `closed_at`, `opened_by`, `@@index([store_id, paid_at])`) · registry `registry/db.md` filas DB-17 a DB-21 · `registry/err.md` fila ERR-33 · ficha de origen `F-026` en `docs/critical-plans/CP-pos-order-flows-audit/findings/`.
- **Business decision:** Cobrar marca la cuenta como **pagada** y deja la mesa **ocupada**; cerrar y mandar a limpieza sigue siendo un acto explícito del mesero. Lo fija ADR-03 con decisión del dueño del 2026-09-20 citada textualmente: *"Marcar pagada y mesa sigue ocupada, pero unificar en una fuente de verdad los flujos de cobro y los escritores"*. Este paso **no cambia todavía el comportamiento de ningún carril**: solo construye la fuente única que B.2 enchufa.
- **Why:** Hoy hay cuatro escritores con cuatro semánticas: uno marca y deja ocupada, otro marca y emite evento, otro **cierra la sesión y manda la mesa a limpieza** con el cliente todavía sentado, y el cuarto —el que usa el detalle de la orden— no proyecta nada. Esa divergencia no se arregla parcheando el carril que falta: eso crea un quinto dialecto. Se arregla dándoles a los cuatro una sola función que escriba el efecto. Separar la extracción del corte (B.2) tiene una razón concreta de riesgo: mientras la función no tenga llamadores, desplegarla no puede romper ningún cobro, y el corte posterior se revierte escritor por escritor.
- **Output:** `projectOrderPaymentToTableSession(orderId, paymentId, tx?)` en el servicio de sesiones de mesa, envolviendo `markSessionPaid` sin reescribirla: resuelve la sesión vigente de la orden, marca `paid_at` dentro de la transacción recibida (o abre una propia), deja `closed_at` y `tables.status` intactos, y deja el `emitSessionPaid` para después del commit. Orden sin ninguna sesión: no-op silencioso, no error. Orden con solo sesiones cerradas y ninguna abierta: rechazo tipado ERR-33. Entra `POS_TABLE_SESSION_PROJECTION_FAILED_001` al catálogo de códigos con su mensaje de frontend. Specs unitarias de los cuatro caminos. **Cero llamadores nuevos en este paso.**
- **Contracts touched:** DB-17 (`table_sessions.paid_at` gana su escritor único), DB-18 (`closed_at` queda explícitamente fuera del alcance de la proyección), DB-19 (el índice único parcial es lo que garantiza que "la sesión abierta" sea a lo sumo una), DB-20 (`order_id` no es único: por eso resolver la vigente es una decisión y no una lectura trivial), DB-21 (`tables.status` no se toca), ERR-33 (código nuevo).
- **Data impact:** none — la función queda sin llamadores hasta B.2, así que desplegar este paso no escribe una sola fila. Sin DDL: `paid_at`, `closed_at` y `opened_by` ya existen en el esquema y el índice `(store_id, paid_at)` ya está creado.
- **Blast radius:** Acotado por construcción: código muerto hasta B.2. El único riesgo real es de diseño y se materializa después — si la resolución de la sesión vigente elige mal (por ejemplo la cerrada más reciente en vez de la abierta), B.2 propagará ese error a los cuatro carriles a la vez. Riesgo secundario: si la proyección se escribiera fuera de la transacción del pago, un cobro exitoso podría quedar sin `paid_at`; lo nota el mesero al ver la cuenta sin marcar.
- **Rollback:** Trivial: revertir el commit. Al no tener llamadores ni haber escrito filas, la reversión no deja rastro en datos. El código ERR-33 recién añadido al catálogo puede quedarse sin costo: un código sin `throw` no es un defecto de runtime, solo deuda de catálogo que el paso de limpieza documenta.
- **Verification:**
  - `npm --prefix apps/backend run test:path -- src/domains/store/tables/table-sessions.service.spec.ts`
  - `grep -rn "projectOrderPaymentToTableSession" apps/backend/src | tee ../evidence/B.1-callers.txt` (espera: solo la definición y sus specs — ningún llamador de producción)
  - `grep -n "POS_TABLE_SESSION_PROJECTION_FAILED_001" apps/backend/src/common/errors/error-codes.ts apps/frontend/src/app/shared/utils/error-messages.ts` (debe aparecer en ambos)
  - `grep -rn "markSessionPaid" apps/backend/src | tee ../evidence/B.1-markpaid.txt` (confirma que la primitiva no fue reescrita ni duplicada)
  - `npx --prefix apps/backend tsc -p apps/backend/tsconfig.json --noEmit` (confirma que la función nueva no introdujo un ciclo de imports)
  - `psql "$DATABASE_URL" -c "SELECT count(*) FROM table_sessions WHERE closed_at IS NULL AND paid_at IS NOT NULL;"` (baseline previo al corte: se anota en `evidence/B.1-baseline.txt` para comparar en B.2)
- **Acceptance checklist:**
  - [ ] Existe una sola función que escribe el efecto de un cobro sobre `table_sessions`
  - [ ] La función envuelve `markSessionPaid` y no reimplementa la idempotencia sobre `paid_at`
  - [ ] Acepta una transacción opcional y usa la recibida cuando se la pasan
  - [ ] Nunca escribe `closed_at` ni `tables.status`
  - [ ] Resuelve la sesión vigente como la sesión ABIERTA de la orden, no como la más reciente
  - [ ] Una orden sin ninguna sesión de mesa es no-op silencioso, no un error
  - [ ] Una orden con solo sesiones cerradas produce el rechazo tipado de proyección
  - [ ] El evento de cuenta pagada se emite después del commit, nunca dentro de la transacción
  - [ ] El código nuevo está en el catálogo de errores y tiene mensaje en el frontend
  - [ ] Hay spec para cada uno de los cuatro caminos: sin sesión, abierta, solo cerradas, doble llamada idempotente
  - [ ] El spec de rechazo fija el código de error, no solo el tipo de la excepción
  - [ ] Ningún archivo de producción llama todavía a la función nueva
  - [ ] Las filas DB-17, DB-18, DB-19, DB-20, DB-21 y ERR-33 quedan marcadas con su evidencia enlazada
- **Status:** in-progress — función/código ERR-33 en 226c25ee6; 44 tests pasan; faltan baseline y cierre de aceptación.
