# Reusable Assets

<!-- [MANDATORY] From Reuse Discovery — one line per asset: `path` — what it provides, or `none — <reason>` if empty. -->
`apps/frontend/src/app/shared/components/item-list/item-list.component.ts` — Render y ejecución accesible de acciones; evita un botón personalizado.
`apps/frontend/src/app/shared/components/responsive-data-view/responsive-data-view.component.ts` — Ya separa tabla y tarjeta en 768 px; permite una entrada móvil aditiva.
`apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts` — Reutilizar los mismos `TableAction` y `cancelOrder()` con confirmación y gate.
`apps/frontend/src/app/shared/components/button/button.component.ts` — `customClasses` y `ariaLabel` permiten ajuste local sin cambiar tamaños globales.
`apps/frontend/src/app/shared/components/options-dropdown/options-dropdown.component.scss` — Medidas canónicas de los triggers vecinos.
