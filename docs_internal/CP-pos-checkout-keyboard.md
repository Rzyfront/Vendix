# CP-POS-CHECKOUT-KEYBOARD — Teclado total del modal de pago (flechas + Enter en todos los pasos)

## Plan Identity
- **Id:** CP-pos-checkout-keyboard
- **Criticality:** El checkout cobra dinero real. Un Enter que dispare el submit en el paso equivocado, o una flecha que salte un gate, produce cobros duplicados, ventas a cliente equivocado o ventas sin datos requeridos. Todo es irreversible sin nota crédito / reversión manual.
- **Owner:** rzy
- **Created:** 2026-09-05 · **Last updated:** 2026-09-05
- **Status:** planning
- **Linear / issue:** none

## Execution Ledger
| Phase | Steps | Done | In progress | Blocked | Status |
|-------|-------|------|-------------|---------|--------|
| A — Fundamentos | 2 | 0 | 0 | 0 | ⬜ Not started |
| B — Motor de teclado | 3 | 0 | 0 | 0 | ⬜ Not started |
| C — Defaults por paso | 4 | 0 | 0 | 0 | ⬜ Not started |
| D — Verificación E2E | 2 | 0 | 0 | 0 | ⬜ Not started |
| E — Convergencia | 2 | 0 | 0 | 0 | ⬜ Not started |

**Current position:** planning — pendiente aprobación humana.
**Owner:** rzy · **Last updated:** 2026-09-05
**Open blockers:** none.
**Handoff notes:** Trabajo previo ya en `dev`: `onShellKeydown` básico (69aa6f94e) + preselect Efectivo/Transferencia (69aa6f94e). Este plan los absorbe y corrige: hoy las flechas pueden disparar cobro en modo crédito, Consumo se salta con Enter sin validar mesa, Envío no tiene default y el foco no se mueve al avanzar.

## Context
El modal de pago del POS (`app-pos-checkout-shell`) es un wizard con pasos mayores dinámicos (Consumo, Cliente, Envío, Cobro según matriz de `steps()`) y sub-wizards presentacionales dentro de Cliente (Tipo → Cliente/Alias → Dirección), Envío (Método → Costo) y Cobro/collector (Forma de pago → Método → Monto). El footer muestra Siguiente (avance) o el CTA terminal (Cobrar / Finalizar venta / Guardar / Actualizar / Crear Venta a Crédito).

El dueño opera el POS a velocidad de caja y exige operarlo casi entero con teclado: flechas para atrás/adelante y Enter/Intro para avanzar/confirmar usando los valores por defecto preseleccionados en cada paso, con una única excepción explícita: el cobro final solo se dispara con Enter/Intro, nunca con flechas. Si algo bloquea, el modal debe decir qué falta (flashes/toasts existentes), nunca quedarse mudo ni saltarse el gate.

Estado actual (verificado en código el 2026-09-05): existe `onShellKeydown` global (→/↓ siguiente, ←/↑ anterior, Enter primario; en inputs de texto las flechas no navegan; sobre botones deja el click nativo). Preselect solo en Método de Cobro (Efectivo → Transferencia → ninguno). Brechas conocidas: (1) en modo crédito las flechas pueden llegar a `onPrimaryConfirm` vía la rama `cobro` de `attemptNextStep` — una flecha podría cobrar; (2) Enter/→ en paso Consumo cae al `nextStep()` genérico sin consultar fulfillment ni mesa — avanza sin validar; (3) Envío no preselecciona método — flujo solo-Enter imposible; (4) Enter dentro del buscador de Cliente dispara búsqueda (propio del input) Y `attemptNextStep`/`resolveIfNeeded` a la vez — doble efecto; (5) tras avanzar con teclado el foco queda donde estaba — contexto perdido para lector de pantalla y para seguir navegando; (6) Cobro-crédito y Wompi no tienen camino solo-teclado definido paso a paso.

## Criticality Justification
Solicitud explícita que invoca el skill (cita textual del dueño): "las flechas, enter e intro deberia funciona en casi que todos los pasos y subpasos, usando el valor por defaul preselto en cada uno, entonces alli y solo cuando estemos en cobrar en con entrer o intro y ojo esto analizalo super minuciosamente es un .agents/skills/how-to-critical-plan/SKILL.md". Función en riesgo: cobro de ventas (dinero real, caja, inventario, KDS, facturación). Afectados: todos los cajeros en `vendix.com/admin/pos`. Costo de fallo: cobro duplicado o a cliente/monto incorrecto — no recuperable con un follow-up commit (requiere reversión operativa). Señales de la skill presentes: función crítica (dinero), fallo no recuperable por commit, múltiples contratos de navegación tocados a la vez.

## General Objective
Operar el checkout del POS casi por completo con flechas + Enter/Intro usando defaults preseleccionados, cobrando solo con Enter/Intro en el CTA terminal y sin saltar ningún gate.

## Specific Objectives
1. Flechas navegan atrás/adelante en todos los pasos y subpasos del modal sin disparar nunca un submit.
2. Enter/Intro ejecuta la acción primaria del contexto (avanzar / confirmar monto / cobrar) en todos los pasos.
3. Cada paso/subpaso con default lo muestra preseleccionado: Tipo de venta, Forma de pago, Método de cobro, Monto (efectivo), Método de envío, fulfillment de Consumo.
4. Cliente no tiene default seleccionable (seguridad) y Enter en su buscador solo busca, nunca avanza solo.
5. Todo bloqueo muestra qué falta (flash/toast existente reutilizado, ninguno nuevo silencioso).
6. El foco visible sigue a la navegación por teclado.
7. Los requests de cobro generados por teclado son byte-equivalentes a los generados por click.

## Non-Goals
- Parrilla de productos del POS con teclado: excluido por decisión del dueño (alcance = solo modal de pago). Requiere reabrir alcance.
- Reasignar atajos existentes (F3 vaciar, Escape cerrar, Tab trap): no se tocan.
- Atajos nuevos con letras/números: no se agregan.
- Cambios de backend, DTOs o migraciones: ninguno; si la E2E revela que falta un endpoint, se escala al humano en vez de improvisarlo.

## Approach Chosen
Evolucionar el handler global existente (`onShellKeydown` en el shell) a una matriz explícita paso × tecla × contexto, en vez de repartir listeners por cada step. Razón: la navegación cruza componentes (shell, consumo, cliente, envío, cobro, collector) y el shell ya es dueño del cursor (`currentStep`), del footer y de `attemptNextStep`/`onPrimaryConfirm`; un solo punto de decisión hace auditable la invariante "las flechas nunca hacen submit". Los steps exponen drivers ya existentes (`advanceSubStepOrConfirm`, `canConfirm`+`flashValidation`, `resolveIfNeeded`, `onFulfillmentReselected`) y solo se les agrega lo mínimo que les falta (preselect de envío, driver de avance de consumo). Los defaults viven donde vive el estado (cada step), nunca en el handler. Cada gate existente se reutiliza, no se duplica: el teclado llama a los mismos métodos que los botones, así que click y teclado no pueden divergir.

## Alternatives Considered
- **Listeners por step (cada step maneja sus teclas):** rechazado. La invariante "flechas nunca submit" quedaría repartida en 5 componentes y cada step nuevo la tendría que reimplementar; una omisión = cobro por flecha. El handler único la hace imposible por construcción.
- **Simular clicks en los botones del footer (`document.querySelector('.btn-confirm').click()`):** rechazado. Acopla a clases CSS, rompe con el CTA deshabilitado (click en disabled no hace nada y no destella qué falta) y duplica el camino en vez de reutilizar el método.
- **Preseleccionar cliente automáticamente (primera sugerencia):** rechazado por seguridad (ver ADR-2). Cobrar a la persona equivocada es el peor fallo posible de este plan.

## Architecture Decision Records
### ADR-1 — Un solo handler global en el shell, matriz explícita paso × tecla
- **Context:** La navegación cruza 5 componentes y el footer; los gates viven en shell + steps.
- **Decision:** `onShellKeydown` en `PosCheckoutShellComponent` decide todo; los steps solo exponen drivers.
- **Consequences:** La invariante anti-submit-por-flecha se audita en un solo método. El handler debe conocer `currentStepKey` y sub-estados (acoplamiento aceptado: el shell ya los lee para el footer).
- **Reversibility:** trivial (`git revert` del commit; los botones siguen intactos).
- **Revisit if:** aparece un step cuyo avance requiera gestos que el shell no puede observar.

### ADR-2 — Cliente sin default: Enter en su buscador solo busca
- **Context:** El dueño pidió default en "casi todos" los pasos; cliente es el caso peligroso.
- **Decision:** Sin preselección de cliente. Enter en el buscador = buscar (comportamiento actual del input). Avanzar exige elegir cliente/alias/anónima + Siguiente/flecha.
- **Consequences:** El flujo solo-Enter se detiene en Cliente hasta elegir persona. Un cobro nunca cae en el cliente equivocado por un default.
- **Reversibility:** trivial.
- **Revisit if:** el dueño pide explícitamente "cliente más frecuente" con confirmación visual obligatoria.

### ADR-3 — Envío preselecciona el primer método habilitado
- **Context:** Sin default, Enter en Envío solo puede destellar "elige método". Decisión del dueño (2026-09-05).
- **Decision:** Al resolver métodos, preseleccionar el primero habilitado en el orden del backend, sin avanzar sub-paso (igual que Método de cobro).
- **Consequences:** Flujo solo-Enter posible en delivery. Si el primero no es el deseado, un click/tab lo cambia igual que hoy.
- **Reversibility:** trivial.
- **Revisit if:** el negocio define default por tienda (p. ej. "recoger en tienda primero").

### ADR-4 — El foco sigue a la navegación
- **Context:** Tras avanzar con teclado el foco queda en el paso anterior; el cajero y el lector de pantalla pierden contexto.
- **Decision:** Tras cada avance/retroceso por teclado, foco al encabezado del panel activo (`tabindex="-1"`, sin scroll brusco).
- **Consequences:** Toque mínimo en 3 templates (atributo + `id`/ref). Sin cambios visuales.
- **Reversibility:** trivial.
- **Revisit if:** el focus visible genera scroll indeseado en móvil.

## Blast Radius
| Surface | What breaks if this plan is wrong | Who notices | Detection signal |
|---------|-----------------------------------|-------------|------------------|
| Cobro pickup contado | Cobro duplicado o con método/monto equivocado | Cajero + cuadre de caja | Total cobrado ≠ total esperado en E2E D.2 |
| Cobro delivery | Venta finalizada sin método/costo de envío válido | Cajero (flash ausente) + cliente | Orden delivery sin costo en E2E |
| Cobro crédito | Venta a crédito sin plan o sin cliente | Cartera | Submit con `creditTerms == null` (gate lo impide; E2E lo prueba) |
| Paso Cliente | Venta asociada al cliente equivocado | Cliente + facturación | ADR-2 lo hace imposible por construcción; E2E lo confirma |
| Crear/Editar borrador | Guardar/Actualizar disparado a destiempo | Cajero | Borrador sin items o update sin cambios (E2E) |
| Accesibilidad | Foco perdido tras navegar | Lector de pantalla / teclado | Auditoría a11y del Convergence round |

## Critical Files
- apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/pos-checkout-shell.component.ts
- apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/pos-checkout-shell.component.html
- apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-payment-step.component.ts
- apps/frontend/src/app/shared/components/payment-collector/payment-collector.component.ts
- apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-shipping-step.component.ts
- apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-consumo-step.component.ts
- apps/frontend/src/app/private/modules/store/pos/components/pos-customer-selector/pos-customer-selector.component.ts
- apps/frontend/src/app/shared/components/modal/modal.component.ts

## Reusable Assets
- `attemptNextStep()` / `prevStep()` / `onPrimaryConfirm()` (shell): drivers reutilizados sin cambios de firma.
- `advanceSubStepOrConfirm()` + `canConfirmAmount` + `flashValidation()` (payment-step/collector): gates reutilizados.
- `canConfirm()` + `flashValidation()` (shipping-step): gates reutilizados.
- `onFulfillmentReselected()` (consumo-step): semántica entrega/mesa reutilizada para el driver de teclado.
- Efecto de preselect de Método de cobro (payment-step, 69aa6f94e): patrón a replicar en Envío.
- `focusFirstInvalid` (core/utils): ya usado para llevar foco a lo que falta.

## Contract Inventory
### Frontend↔Backend Contract Registry
El plan no cambia ningún DTO ni shape. Los endpoints en el radio son solo-regresión: el teclado invoca los mismos métodos que los botones, así que los requests deben ser idénticos. Cada fila se verifica en E2E D.2 comparando el payload generado por teclado contra el generado por click.

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | POST `{apiUrl}` venta contado (`pos-payment.service.ts:352` `processSaleWithPayment`) | `PaymentRequest` | orden creada | payment-step `onCollectorSubmit` | none (regression check only) | Divergencia click vs teclado | E2E D.2: payload Enter ≡ payload click | - [ ] |
| FB-02 | POST `{apiUrl}` cobro adoptada (`chargeAdoptedOrder`) | `PaymentRequest` + `linkedOrderId` | orden cobrada | payment-step | none (regression check only) | Divergencia click vs teclado | E2E D.2 | - [ ] |
| FB-03 | POST `{apiUrl}` envío (`pos-payment.service.ts:509` `processShippingSale`) | `PaymentRequest` + envío | orden delivery | shipping-step `execute` | none (regression check only) | Finalizar sin costo válido | E2E D.2 flujo delivery | - [ ] |
| FB-04 | POST `{apiUrl}` crédito (`pos-payment.service.ts:717/812`) | `creditConfig` | venta a crédito | payment-step | none (regression check only) | Plan incompleto | E2E D.2 flujo crédito | - [ ] |
| FB-05 | POST `/store/orders/:id/flow/pay` (`store-orders.service.ts:494`) | pay DTO | orden pagada | shell `onConfirm` post-edit | none (regression check only) | Cobro doble orden | E2E D.2 flujo edit→cobrar | - [ ] |
| FB-06 | PUT `/store/orders/:id/editor` (`store-orders.service.ts:637`) | editor DTO | orden actualizada | shell `onUpdateEditor` | none (regression check only) | Update a destiempo por Enter | E2E D.2 flujo edit | - [ ] |
| FB-07 | PUT `/store/orders/:id/items` (`pos-api.service.ts:75`) | items[] | orden | cart-service adopted | none (regression check only) | N/A teclado (fuera de alcance) | Sin cambio; suite existente | - [ ] |
| FB-08 | GET `searchCustomers` (selector, Enter) | `{ query, limit }` | `{ data: [] }` | customer-selector `runSearch` | none (regression check only) | Enter avanza además de buscar | E2E D.1 paso Cliente | - [ ] |

### Database Contract Registry
El plan no toca backend ni base de datos: cero puntos de lectura/escritura, cero migraciones. Sin filas por registrar; la regresión de datos (totales, items, cliente de la orden creada) se verifica en E2E D.2 contra los mismos invariantes que el flujo por click.

### Error Code Registry
Los gates son client-side (signals), sin códigos HTTP nuevos. Cada bloqueo debe producir feedback visible:

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | UI `method` flash | n/a | Siguiente/Enter en Método sin método | Flash 3s en grid + no avanza | "Elige un método de pago" | E2E D.1 | - [ ] |
| ERR-02 | UI `reference` flash | n/a | Confirmar transferencia sin referencia/cuenta | Flash + no confirma | "Ingresa la referencia…" / "Selecciona la cuenta…" | E2E D.1 | - [ ] |
| ERR-03 | UI `cash` flash | n/a | Confirmar efectivo insuficiente | Flash + no confirma | "El efectivo recibido no cubre el total" | E2E D.1 | - [ ] |
| ERR-04 | UI `customer` flash | n/a | Cobro exige cliente y no hay | Flash + (wallet/crédito) pide cliente | "Selecciona un cliente…" | E2E D.1 | - [ ] |
| ERR-05 | UI dirección | n/a | Avanzar sin dirección válida | `showAddressErrors` + foco al campo | Badge "Obligatoria" + hints | E2E D.1 | - [ ] |
| ERR-06 | UI envío | n/a | Avanzar sin método de envío | `flashValidation` + no avanza | "Selecciona un método de envío" (texto actual del step) | E2E D.1 | - [ ] |
| ERR-07 | UI crédito/Wompi | n/a | Confirmar plan/datos incompletos | Flash + no confirma | "Completa el plan de crédito" / Wompi | E2E D.1 | - [ ] |

## Data Integrity Plan
- **Migrations:** none. **Backfills:** none.
- **Invariants that must hold before and after:** total cobrado = total del carrito (+ flete en delivery); items cobrados = items del carrito; `customer_id` = cliente elegido o null solo si anónima permitida; sin doble submit (un Enter = una acción).
- **Snapshot taken:** n/a (sin mutación de datos; el riesgo es transaccional en E2E contra staging/dev con datos de prueba).
- **Dry-run dataset:** tienda de prueba con: producto simple, producto con variantes, servicio con booking, método Efectivo + Transferencia con cuentas, envío con 2 métodos, cliente con dirección, `allow_anonymous_sales` on/off.

## Phases and Steps
### Phase A — Fundamentos
#### A.1 Tag de baseline + rama de trabajo
   Skills: git-workflow
   Resources: repo en `dev` limpio; tag `checkpoint/CP-pos-checkout-keyboard`
   Business decision: Se trabaja en rama desde `origin/dev` (no directo en `dev`) por ser cambio en cobro; el push a `dev` solo vía PR con review ≥80%.
   Why: Punto de retorno garantizado antes de tocar el checkout.
   Output: tag + rama `feat/CP-pos-checkout-keyboard` al día con `origin/dev`.
   Contracts touched: none — read-only step
   Data impact: none — read-only step
   Blast radius: Si está mal, ningún impacto en código (solo git).
   Rollback: borrar tag/rama.
   Verification: `git status` limpio + `git rev-parse HEAD` anotado en Execution Log.
   Acceptance checklist:
   - [ ] `git status` limpio antes del tag
   - [ ] Tag creado y SHA anotado en Execution Log
   - [ ] Rama creada desde `origin/dev` actualizado
   - [ ] Engram import ejecutado (`./scripts/engram-import.sh`)
   Status: pending

#### A.2 Snapshot de comportamiento actual (matriz teclado × paso)
   Skills: vendix-frontend, how-to-test
   Resources: `onShellKeydown` actual; matriz `steps()`/`stepKeys()`; 4 flujos (pickup anónimo, pickup cliente, delivery, restaurante)
   Business decision: Ninguna; observación pura.
   Why: Sin baseline observable no se puede probar que el plan mejoró algo ni detectar regresiones.
   Output: Tabla en Execution Log: para cada paso/subpaso × (→, ←, Enter) qué hace HOY (incluye los 6 defectos del Contexto).
   Contracts touched: none — read-only step
   Data impact: none — read-only step
   Blast radius: Ninguno (no toca código).
   Rollback: n/a.
   Verification: Tabla completa con 6 defectos reproducidos y citados con archivo:línea.
   Acceptance checklist:
   - [ ] Matriz cubre Cliente (3 subpasos), Envío (2), Cobro (3), Consumo
   - [ ] Defecto flecha-submit en crédito reproducido
   - [ ] Defecto salto de Consumo reproducido
   - [ ] Defecto doble Enter en buscador Cliente reproducido
   - [ ] Foco post-avance documentado (se queda atrás)
   Status: pending

### Phase B — Motor de teclado
#### B.1 Matriz explícita paso × tecla en `onShellKeydown`
   Skills: vendix-frontend, vendix-zoneless-signals
   Resources: `pos-checkout-shell.component.ts` (`onShellKeydown`, `attemptNextStep`, `onPrimaryConfirm`, `prevStep`, `cobroNeedsAdvance`, `confirmDisabled`)
   Business decision: Enter sobre botón = click nativo (sin duplicar); Enter en TEXTAREA se ignora; en inputs de texto las flechas no navegan.
   Why: Un solo punto de decisión auditable para la invariante anti-submit-por-flecha (ADR-1).
   Output: `onShellKeydown` reescrito como matriz: por cada `currentStepKey` + sub-estado, qué hace →/←/Enter; rama `consumo` delega en driver C.2; rama `cliente` con foco en buscador solo permite flechas de navegación mayor si no edita texto.
   Contracts touched: none (no cambia requests; D.2 lo prueba)
   Data impact: none — read-only hasta CTA terminal
   Blast radius: Si está mal, avances saltan gates → lo detecta D.1 antes de merge.
   Rollback: `git revert` del commit B.
   Verification: `npx tsc` del archivo en verde + matriz A.2 re-ejecutada muestra los 6 defectos cerrados salvo los que son de defaults (Fase C).
   Acceptance checklist:
   - [ ] →/↓ en paso intermedio = Siguiente; en terminal = no-op (nunca submit)
   - [ ] ←/↑ = Anterior en todos los pasos (no-op en el primero)
   - [ ] Enter = Siguiente intermedio / primario en terminal
   - [ ] Enter en buscador Cliente NO avanza (solo busca) — ver C.3
   - [ ] `event.defaultPrevented` (radiogroup Tipo) no dispara doble navegación
   - [ ] Sin cambios en firmas de `attemptNextStep`/`onPrimaryConfirm`
   Status: pending

#### B.2 Cerrar el submit-por-flecha en crédito y terminales
   Skills: vendix-frontend, vendix-error-handling
   Resources: rama `cobro` de `attemptNextStep` (línea ~1045: `if (pay?.mode() === 'credito') onPrimaryConfirm()`)
   Business decision: Las flechas son navegación pura SIEMPRE; el CTA terminal es exclusivo de Enter/click.
   Why: Hoy una flecha en plan de crédito puede cobrar (defecto 1). La exigencia del dueño ("allí y solo… con enter o intro") debe cumplirse por construcción, no por estado.
   Output: La rama crédito-submit sale de `attemptNextStep` (o queda tras un flag `viaKeyboard=false` explícito); el footer por flecha en terminal = no-op; Enter en terminal con `confirmDisabled()` destella (ERR-01..07) en vez de quedar mudo.
   Contracts touched: FB-04, FB-05 (mismo request, distinto trigger; regresión en D.2)
   Data impact: none — bloquea submits, no crea nuevos
   Blast radius: Si está mal, flecha cobra o Enter no cobra → D.1/D.2 lo capturan.
   Rollback: `git revert` del commit B.
   Verification: E2E: 20 pulsaciones → en plan de crédito terminal + Enter con plan incompleto muestra ERR-07 y cero requests.
   Acceptance checklist:
   - [ ] → en terminal (cualquier modo) = no-op verificable (cero requests en red)
   - [ ] Enter en terminal con gate cerrado = flash, cero requests
   - [ ] Enter en terminal con gate abierto = exactamente 1 request
   - [ ] Doble Enter rápido no duplica submit (`footerProcessing`/`isProcessing` lo absorbe — probar)
   - [ ] Crédito por click sigue intacto (regresión)
   Status: pending

#### B.3 El foco sigue a la navegación
   Skills: vendix-frontend, vendix-zoneless-signals
   Resources: templates de shell + 3 steps (`tabindex="-1"`, `focus({preventScroll:true})`)
   Business decision: Foco programático al panel activo tras cada avance/retroceso por teclado (ADR-4).
   Why: Sin esto el cajero pierde contexto y el lector de pantalla anuncia el paso viejo.
   Output: Helper `focusActiveStep()` invocado en avances por teclado; encabezados focuseables sin cambio visual.
   Contracts touched: none
   Data impact: none
   Blast radius: Scroll indeseado en móvil → probar en viewport móvil en D.1.
   Rollback: `git revert` del commit B.
   Verification: E2E con teclado: `document.activeElement` cae dentro del panel activo tras cada →/Enter.
   Acceptance checklist:
   - [ ] Foco cae en panel activo en Cliente/Envío/Cobro/Consumo
   - [ ] Sin scroll brusco (preventScroll) en desktop y móvil
   - [ ] Focus trap del modal intacto (Tab no escapa)
   - [ ] Sin cambios visuales (diff de screenshots)
   Status: pending

### Phase C — Defaults por paso
#### C.1 Preselect de método de envío (primer habilitado)
   Skills: vendix-frontend, vendix-zoneless-signals
   Resources: `pos-shipping-step.component.ts` (`shippingMethods`, `selectedShippingMethod`, `selectShippingMethod` que auto-avanza)
   Business decision: ADR-3 (decisión del dueño 2026-09-05).
   Why: Sin default no hay flujo solo-Enter en delivery.
   Output: Efecto que al resolver métodos preselecciona el primero habilitado SIN avanzar sub-paso (parámetro `advance:false` como en collector, o preselect sin `goToShipSubStep`); réplica el patrón del preselect de cobro.
   Contracts touched: FB-03 (mismo request; regresión en D.2)
   Data impact: none
   Blast radius: Método equivocado por defecto → el cajero lo cambia con click; costo detectado en E2E.
   Rollback: `git revert` del commit C.
   Verification: E2E delivery: abrir Envío → primer método resaltado, sub-paso sigue en Método.
   Acceptance checklist:
   - [ ] Primer habilitado preseleccionado al cargar métodos
   - [ ] No avanza solo al sub-paso Costo
   - [ ] Elección manual del cajero nunca es sobreescrita
   - [ ] Con 0 métodos, Enter destella ERR-06 (sin crash)
   - [ ] Costo recalculado tras preselect (efecto existente lo cubre — probar)
   Status: pending

#### C.2 Driver de avance por teclado para Consumo
   Skills: vendix-frontend, vendix-restaurant-ops
   Resources: `pos-consumo-step.component.ts` (`fulfillment` default 'entrega', `needsTable`, `onFulfillmentReselected`, `openTablePicker`), rama `cobro`-style en shell
   Business decision: Enter/→ en Consumo = `onFulfillmentReselected(fulfillment())`: entrega avanza; consumo sin mesa abre el picker (no avanza); con mesa avanza.
   Why: Hoy el teclado salta Consumo sin validar (defecto 2): se podría cobrar consumo en mesa sin mesa.
   Output: Rama `consumo` en el shell (o método `advanceConsumo()`) con esa semántica; Enter con picker abierto no lo cierra (el picker se opera con click/Escape).
   Contracts touched: none (mesa viaja en el pay existente; D.2 lo confirma)
   Data impact: none
   Blast radius: Mesa no seleccionada al cobrar → `needsTable` del footer ya bloquea Cobrar; E2E restaurante lo prueba.
   Rollback: `git revert` del commit C.
   Verification: E2E restaurante: Enter en Consumo-entrega avanza; en consumo-sin-mesa abre picker y NO avanza.
   Acceptance checklist:
   - [ ] Default fulfillment sigue 'entrega'
   - [ ] Enter con entrega = avanza al siguiente paso mayor
   - [ ] Enter con consumo sin mesa = abre picker, no avanza
   - [ ] Mesa elegida + Enter = avanza
   - [ ] Cobrar sigue exigiendo mesa (`needsTable`) aunque se llegue por teclado
   Status: pending

#### C.3 Cliente: Enter solo busca + caminos por defecto
   Skills: vendix-frontend, vendix-zoneless-signals
   Resources: `pos-customer-selector` (`onSearchEnter`, `resolveIfNeeded`), sub-pasos Tipo/Cliente/Alias/Dirección, defaults de `saleMode`
   Business decision: ADR-2 + decisión del dueño (Enter = solo buscar).
   Why: Evita cobrar a cliente equivocado y el doble efecto Enter (defecto 4).
   Output: Handler global no avanza cuando el foco está en el buscador de Cliente; Tipo usa default de settings (ya existe); Alias/Dirección responden a Enter vía `attemptNextStep` (ya); sin cliente elegido, Siguiente/→ en sub-paso Cliente corre `resolveIfNeeded` o destella (comportamiento actual preservado).
   Contracts touched: FB-08 (solo timing de búsqueda; shape intacto)
   Data impact: none
   Blast radius: Cajero no puede avanzar sin elegir persona → es lo pedido (fricción aceptada por seguridad).
   Rollback: `git revert` del commit C.
   Verification: E2E: Enter en buscador = solo busca (cero avances); Siguiente sin cliente = toast/error actual.
   Acceptance checklist:
   - [ ] Enter en buscador dispara búsqueda y nada más
   - [ ] Anónima + Enter/Siguiente avanza (flujo rápido intacto)
   - [ ] Alias vacío + Enter = error visible, no avanza
   - [ ] Dirección inválida + Enter = errores + foco al campo
   - [ ] Ningún camino preselecciona cliente solo
   Status: pending

#### C.4 Cobro: completar la matriz (forma/monto/crédito/Wompi)
   Skills: vendix-frontend, vendix-zoneless-signals, vendix-error-handling
   Resources: collector (`initialMode`, `modoOffset`, `montoIndex`, `canConfirmAmount`, cash auto-seed), payment-step preselect (ya), modos crédito/Wompi
   Business decision: Los defaults existentes mandan (Forma por settings, Método Efectivo→Transferencia, Monto auto en efectivo). Crédito y Wompi son manuales: el teclado los recorre pero Enter destella lo que falte (ERR-07).
   Why: Cierra "casi todos los subpasos": Forma→Método→Monto solo-Enter en contado; crédito/Wompi guiados por flashes.
   Output: Verificación + ajustes mínimos (si Forma no respetara `initialMode` en algún modo, corregirlo); matriz documentada Forma×Método×Monto×(Enter/flechas).
   Contracts touched: FB-01, FB-02, FB-04 (regresión en D.2)
   Data impact: none
   Blast radius: Monto confirmado con dato incompleto → `canConfirmAmount` lo impide; E2E lo prueba por método.
   Acceptance checklist:
   - [ ] Contado+Efectivo: 3 Enters llegan a Cobrar terminal
   - [ ] Transferencia sin referencia/cuenta: Enter destella ERR-02, cero requests
   - [ ] Crédito sin plan/cliente: Enter destella ERR-07, cero requests
   - [ ] Wompi incompleto: Enter destella, cero requests
   - [ ] Monto colapsado + Enter = Cobrar (1 request)
   - [ ] Anónima con `requireCustomer`: Enter en terminal destella ERR-04
   Status: pending

## Perspective Audit Matrix
| # | Perspective | Round run | Findings (B/M/M/N) | Status |
|---|-------------|-----------|--------------------|--------|
| 1 | Architecture | — | — | pending |
| 2 | Implementation | — | — | pending |
| 3 | Frontend↔Backend contracts | — | — | pending |
| 4 | Database contracts & integrity | — | N/A — el plan no toca backend ni DB, cero migraciones | N/A con razón |
| 5 | Error handling & codes | — | — | pending |
| 6 | Security & authorization | — | N/A — sin cambios de auth, permisos ni scoping; el teclado invoca los mismos métodos que los botones | N/A con razón |
| 7 | Data validation | — | — | pending (montos/referencia por teclado) |
| 8 | Data load & performance | — | N/A — cero requests nuevos; los submits son los mismos del click | N/A con razón |
| 9 | Development strategy | — | — | pending (orden Fase B→C→D, rama + PR) |
| 10 | UI/UX & reachability | — | — | pending (foco, hints de teclado) |
| 11 | Accessibility | — | — | pending (foco, aria, trap intacto) |
| 12 | User comprehension | — | — | pending (copy de flashes ante Enter) |
| 13 | Observability & traceability | — | — | pending (cero submits silenciosos; doble Enter) |

## Convergence Loop Log
| Round | Date | Blockers | Majors | Minors | New steps filed | Outcome |
|-------|------|----------|--------|--------|-----------------|---------|

Vacío antes de la ejecución (Fase 7). Cierre = 2 rondas limpias consecutivas.

## End-to-End Verification
Herramienta: Playwright MCP contra entorno dev con el dataset del Data Integrity Plan. Nivel integración:
- Los 4 flujos de D.1 operados 100% por teclado (salvo elegir cliente y mesa, que son click).
- Red capturada: cada submit por teclado difunde payload idéntico al de click (D.2).
- Teclado completo: Tab no escapa del modal, Escape sigue cerrando, F3 intacto.
- Viewports desktop + móvil (el handler es compartido; el foco no debe hacer scroll brusco).

## Rollback Plan
| Phase | Trigger to roll back | Procedure | Data recoverable? | Who decides |
|-------|----------------------|-----------|-------------------|-------------|
| A | Rama base incorrecta | Borrar rama/tag, recrear | n/a | rzy |
| B | Matriz rompe navegación por click | `git revert` commit(s) B en la rama | n/a (frontend) | rzy |
| C | Default incorrecto (envío/mesa) | `git revert` commit C correspondiente | n/a (frontend) | rzy |
| D | E2E revela submits divergentes | No mergear; volver a B/C | n/a | rzy |
| Global abort | Cualquier cobro duplicado/erróneo en E2E sin causa clara | Abortar plan, `git revert` rama completa, escalar a humano | Las órdenes de prueba se anulan en dev | rzy |

Todo el plan es frontend: cada commit es revertible y ningún paso migra datos. La única irreversibilidad real sería un cobro en prod, por eso la E2E corre solo en dev/staging y el merge es vía PR.

## Knowledge Gaps
- Patrón "keyboard-first POS checkout" (matriz paso×tecla + defaults + foco): si converge, proponer skill `vendix-pos-keyboard`.
- Playwright MCP contra POS con sesión/caja abierta: documentar credenciales y setup en `how-to-test` si falta.

## Execution Log
| Date | Who | Step | Event | Evidence |
|------|-----|------|-------|----------|

### Phase D — Verificación E2E
#### D.1 Matriz teclado × pasos en navegador (4 flujos)
   Skills: how-to-test, vendix-frontend
   Resources: Playwright MCP contra dev (vendix.com local), dataset del Data Integrity Plan
   Business decision: La verdad es el navegador, no el código leído.
   Why: Los gates son señales reactivas; solo el DOM + red prueban la matriz real.
   Output: 4 guiones ejecutados (pickup anónimo, pickup con cliente, delivery, restaurante consumo) con tabla paso×tecla×resultado y captura de red.
   Contracts touched: FB-01..FB-08, ERR-01..ERR-07 (todas las filas a [x])
   Data impact: órdenes de prueba en dev/staging (datos descartables, nunca prod)
   Blast radius: Ninguno en prod (todo contra entorno de prueba).
   Rollback: n/a (verificación).
   Verification: Cada celda de la matriz con evidencia (request HAR o screenshot del flash).
   Acceptance checklist:
   - [ ] Pickup anónimo entero solo-Enter hasta Cobrar + 1 request
   - [ ] Pickup cliente: Enter en buscador no avanza; flujo completo OK
   - [ ] Delivery: preselect envío + Cobro final con flete correcto
   - [ ] Restaurante: consumo sin mesa no avanza; con mesa sí
   - [ ] 20 Enters en terminal-crédito-incompleto = 0 requests
   - [ ] Foco sigue al panel en cada avance (a11y)
   - [ ] ERR-01..ERR-07 observadas al menos una vez cada una
   Status: pending

#### D.2 Equivalencia click ≡ teclado en submits
   Skills: how-to-test, vendix-error-handling
   Resources: HAR de D.1 (click) vs D.1 (teclado) en los 6 submits FB-01..FB-06
   Business decision: El teclado no inventa requests: mismo método, ruta, DTO y orden de llamadas.
   Why: Es la garantía central del plan (ADR-1): dos caminos, un solo driver.
   Output: Diff de payloads por endpoint: idénticos salvo timestamps/ids de idempotencia.
   Contracts touched: FB-01..FB-06
   Data impact: órdenes de prueba (descartables)
   Blast radius: Ninguno.
   Rollback: n/a.
   Verification: `diff` de HARs пары por par, adjuntado como evidencia.
   Acceptance checklist:
   - [ ] FB-01..FB-06 con fila Status [x] y evidencia
   - [ ] Cero requests extra/missing en camino teclado
   - [ ] Idempotencia: doble Enter rápido = 1 efecto (o 2do absorbido con error tipado, nunca 2 cargos)
   - [ ] Confirmado contra dataset representativo (no DB vacía)
   Status: pending

### Phase E — Convergencia
#### E.1 Rondas de perspectivas + fixes
   Skills: agent-teams, pr-code-review
   Resources: Perspective Audit Matrix; PR a `dev`
   Business decision: Ningún finding se cierra re-rateando; solo fix o `- [-]` con autorizador.
   Why: Cierre autoverificado del plan crítico.
   Output: Rondas registradas en Convergence Loop Log hasta 2 limpias consecutivas; `pr-code-review` ≥80%.
   Contracts touched: según findings
   Data impact: según findings (cero esperado)
   Blast radius: Según findings.
   Rollback: Por fix (cada fix en su commit revertible).
   Verification: Log con 2 rondas limpias + review ≥80% enlazado.
   Acceptance checklist:
   - [ ] 13 perspectivas corridas (N/A con razón donde aplique)
   - [ ] Blockers/majors en cero o aceptados por escrito
   - [ ] PR con review ≥80% y tag Aprobado
   - [ ] Ledger y Execution Log al día
   Status: pending

#### E.2 Cierre, memoria y entrega
   Skills: git-workflow, vendix-engram
   Resources: plan file, PR mergeado
   Business decision: Merge a `dev` vía PR (no push directo) por tratarse de cobro.
   Why: Trazabilidad y revisión cruzada en dinero.
   Output: Plan en `done`, memoria Engram con decisiones, push + PR + Linear si aplica.
   Contracts touched: none
   Data impact: none
   Blast radius: Ninguno (cierre administrativo).
   Rollback: n/a.
   Verification: Ledger 100%, gates de `git-workflow` RULES 5-8 cumplidas.
   Acceptance checklist:
   - [ ] Todas las filas FB/ERR en [x] con evidencia
   - [ ] Ledger completo, cero blockers abiertos
   - [ ] Memoria Engram guardada (decisiones + qué probar la próxima)
   - [ ] PR linkeado en Execution Log
   - [ ] Skill gap evaluado (¿nuevo skill de keyboard-nav POS?)
   Status: pending

## Approval Request
This critical plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`, with the Living Document Protocol and the Convergence Loop in force. Reply with corrections to revise the plan in place.
