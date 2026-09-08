---
id: A.2
title: "Autofocus del buscador al cerrar modales POS"
phase: A
status: pending
owner: none
updated: 2026-09-08
contracts: []
adrs: []
skills: []
---
# A.2 — Autofocus del buscador al cerrar modales POS

- **Skills:** vendix-frontend, vendix-zoneless-signals
- **Resources:** `npx tsc --noEmit --skipLibCheck --target es2022 --moduleResolution bundler --module esnext apps/frontend/src/app/private/modules/store/pos/pos.component.ts` · recorrido manual de cierres en https://vendix.com
- **Business decision:** Cerrar cualquier modal del POS devuelve el foco al input de búsqueda de productos para que la venta continúe sin clic.
- **Why:** Va después de A.1 porque el flujo completo es cobrar con Enter y seguir vendiendo sin tocar el mouse; sin esto cada cierre rompe el ritmo de caja.
- **Output:** `focusSearch()` público en la selección + helper diferido en POS invocado desde cada cierre de modal.
- **Contracts touched:** none — frontend-only.
- **Data impact:** none — solo foco del DOM.
- **Blast radius:** Búsqueda POS; si el buscador no está montado el helper debe ser no-op — lo detecta el recorrido de cierres.
- **Rollback:** `git revert` del commit del run (checkpoint `checkpoint/parallel-pos-enter`).
- **Verification:**
  - tsc en cero errores sobre los componentes tocados.
  - Cierre manual de cada modal del POS deja el foco en Buscar productos.
- **Acceptance checklist:**
  - [ ] `focusSearch()` existe y es no-op si no hay buscador
  - [ ] Checkout/cliente/carrito/ítem/confirmación/cobro/sesión/horarios enfocan al cerrar
  - [ ] Sin excepciones en consola al cerrar modales
- **Status:** pending
