---
id: I.6
title: "Aceptación formal de la deuda que este plan no ejecuta"
phase: I
status: pending
owner: none
updated: 2026-09-20
contracts: [FB-06, ERR-40, DB-41]
adrs: []
skills: [vendix-business-analysis, vendix-fiscal-scope, vendix-payment-processors, vendix-accounting-rules]
---
# I.6 — Aceptación formal de la deuda que este plan no ejecuta

- **Skills:** `vendix-business-analysis` (cada elemento aceptado es una decisión económica: quién asume el riesgo y hasta cuándo) · `vendix-fiscal-scope` (la deuda de la cola fiscal se acepta sabiendo qué obligación queda sin automatizar) · `vendix-payment-processors` (el carril de cobro sobre orden adoptada se congela con su alcance real declarado) · `vendix-accounting-rules` (la compuerta aritmética protege una invariante contable y su apagado se acepta con nombre y condición). **[Sin skill — knowledge gap]** para el patrón «registrar deuda técnica aceptada con dueño, razón y condición de reapertura, y volver a mirarla en la fecha pactada»: se repite en cada plan crítico de este repo y hoy vive como prosa suelta; merecería un skill que fije el formato y el disparador de revisión.
- **Resources:** `## Non-Goals` y `## Knowledge Gaps` del hub (`PLAN.md`) · `apps/backend/src/domains/store/orders/shared/order-arithmetic.guard.ts:45-46` (compuerta apagada por ausencia de configuración, sin llamadores) · `apps/backend/src/jobs/pos-line-gross-invariant-audit.job.ts` (el job que existe pero audita otro predicado) · `apps/backend/src/domains/store/payments/services/payment-gateway.service.ts` · `apps/frontend/src/app/private/modules/store/pos/services/pos-payment.service.ts:1046-1060` (`chargeAdoptedOrder`) · `apps/backend/prisma/schema.prisma:8828-8848` · la base de la propina NO se acepta aquí: la ejecuta E.6, bloqueado hasta que el dueño elija base y se escriba su ADR · `:4589` y `order-flow.service.ts:1057-1060` (los dos estados finales del mismo retiro en mostrador) · `apps/backend/src/domains/store/shipping/shipping-derivation.util.ts:13-19` · fichas de origen `F-015`, `F-017`, `F-018`, `F-019` en `docs/critical-plans/CP-pos-order-flows-audit/findings/`.
- **Business decision:** la decisión de este paso es **no ejecutar**. Cinco elementos quedan fuera del alcance con dueño nombrado, razón escrita y condición de reapertura explícita, para que la ausencia sea una decisión tomada y no un olvido. Ninguno se cierra como «resuelto»: se aceptan, que es distinto, y el que los asume queda registrado. La **base de la propina** NO está entre ellos: la ejecuta E.6, que queda bloqueado hasta que el dueño elija base y esa elección se escriba como ADR — es decisión pendiente, no deuda aceptada. (1) El **estado final del retiro en mostrador**, que difiere según el carril de cobro, lo asume el dueño del producto; se reabre cuando un retiro de mostrador necesite remisión o cuando se abra el plan de simetría entre carriles que un plan anterior ya aplazó. (2) La **compuerta aritmética de línea** sigue apagada: lo prohíbe el `## Non-Goals` del hub y lo asumen el dueño del producto y el backend; se reabre cuando exista el vigilante de esa invariante —el que hay audita otro predicado— y mida treinta días en verde. (3) El **cajón de sastre del tipo de entrega no clasificado** lo asume el dueño del producto; se reabre cuando un método de envío a medida produzca un efecto observable aguas abajo en remisión, cocina o despacho. (4) El **cambio de esquema de la cola fiscal** lo asumen el backend y el contador; se reabre con ADR propio y con el checklist de migraciones de §6 cumplido, nunca dentro de este plan. (5) El **carril de cobro sobre orden adoptada de la pasarela de pagos** lo asume el dueño del producto; se reabre cuando se acote con certeza qué flujo de pantalla lo dispara, porque tocarlo a ciegas mueve la pasarela, los reembolsos y los webhooks a la vez.
- **Why:** el patrón que destapó esta auditoría es que un hallazgo parcialmente arreglado **se lee como cerrado**: la ficha sigue en abierto, el campo de resolución vacío, y el tramo que quedó vivo desaparece de la conversación. Aceptar sin registrar reproduce exactamente ese fallo, un nivel más arriba. Dos de estos elementos además ya fueron aplazados antes por otro plan y volvieron a aparecer aquí sin dueño: sin condición de reapertura escrita, volverán una tercera vez.
- **Output:** decisiones registradas, no código. Cada elemento queda con dueño, razón y condición de reapertura en su ficha del bundle de auditoría —campo de resolución poblado y estado movido a aceptado con quien lo acepta—, y el conjunto queda resumido en el registro de ejecución de este bundle. Ni una línea de código cambia en este paso, y las tres filas de registry citadas quedan congeladas por decisión, no por descuido.
- **Contracts touched:** FB-06, ERR-40, DB-41
- **Data impact:** none — paso documental. No lee ni escribe ninguna tabla de negocio, no toca la cola de reintentos, no cambia ninguna configuración de entorno y no ejecuta ninguna migración. Lo único que cambia son archivos de documentación dentro de los dos bundles.
- **Blast radius:** ninguna superficie de la aplicación. El riesgo es de gobierno: si un elemento se acepta sin dueño real o sin condición verificable de reapertura, queda enterrado y vuelve a costar dinero por el mismo mecanismo que lo trajo aquí. Lo nota quien audite el siguiente plan, cuando encuentre el mismo hallazgo por tercera vez.
- **Rollback:** reabrir el elemento: devolver su ficha a abierto y retirar la aceptación. No hay nada más que revertir, porque nada se ejecutó.
- **Verification:**
  - `bash skills/how-to-critical-plan/assets/cp-lint.sh docs/critical-plans/CP-pos-order-flows-remediation` → exit 0
  - `grep -rn "ORDER_ARITHMETIC_GUARD_ENABLED" . --include='*.env*' --include='*.yml' --include='*.yaml'` → sin resultados: la compuerta sigue apagada por ausencia de configuración, y el paso lo deja por escrito
  - `git diff --stat -- apps/backend/src/domains/store/payments/services/payment-gateway.service.ts` → vacío: la pasarela no se tocó en todo el plan
  - `SELECT count(*) FROM invoice_retry_queue;` de solo lectura, idéntico antes y después del plan completo → `evidence/I6-cola-intacta.txt`
  - Revisión de las seis fichas de origen en el bundle de auditoría: cada una con dueño, razón y condición de reapertura poblados → `evidence/I6-aceptaciones.txt`
- **Acceptance checklist:**
  - [ ] El estado final divergente del retiro en mostrador queda aceptado con dueño y condición de reapertura
  - [ ] La compuerta aritmética de línea queda aceptada apagada, con el vigilante en verde treinta días como única condición de cableado
  - [ ] El cajón de sastre del tipo de entrega no clasificado queda aceptado con dueño y con su disparador de reapertura
  - [ ] El cambio de esquema de la cola fiscal queda aceptado fuera del plan, condicionado a ADR propio y al checklist de migraciones
  - [ ] El carril de cobro sobre orden adoptada de la pasarela queda congelado, condicionado a acotar antes su disparador desde la UI
  - [ ] Las seis fichas de origen quedan con dueño, razón y condición escritas: ninguna queda abierta sin dueño
  - [ ] Ninguna línea de código, configuración o esquema cambió en este paso
  - [ ] F-009 — deep-link /admin/orders/sales/:id muerto: aceptar deuda o planear fix (minor)
- **Status:** pending
