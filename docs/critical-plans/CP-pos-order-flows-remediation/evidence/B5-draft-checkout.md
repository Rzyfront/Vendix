# B.5 Guardar borrador POS: mesa en limpieza frente a libre

El único consumidor real de `app-pos-open-table-modal` lo monta con `selectOnly=true`: escoger la mesa **no abre** sesión. La apertura efectiva ocurre al pulsar «Guardar borrador» en `pos-checkout-shell.openPickedTableThenAppend`. El aviso del POST interno del picker no era alcanzable en ese carril; el shell ahora lo emite después del POST exitoso y antes de anexar ítems. No hay confirmación extra.

Playwright real en `https://vendix.com/admin/pos` con producto 302, alias y «Guardar / Espera → Consumo en mesa → Elegir mesa → Guardar borrador»:

- Mesa QA #23 en `cleaning`: `POST /api/store/table-sessions` **201**, `previous_table_status=cleaning`, orden #1133/sesión #115; `add-items` **201**. Toast naranja «Esta mesa estaba en limpieza. Verifica que esté lista para atender.» sobre la confirmación de borrador. La confirmación ya lee `GET /store/orders/1133` y muestra `T-1790152166311-841`, alias y subtotal/total **$38.000** (`B5-draft-cleaning-warning.png`).
- Control mesa QA #24 en `available`: POST apertura **201** con `previous_table_status=available`, orden #1134/sesión #116, `add-items` **201**; confirmación muestra número/alias/$38.000 **sin** toast de limpieza (`B5-draft-free-no-warning.png`).
- El carril de cobro directo POS ya se validó con la mesa #19 en `B5-direct-pos-cleaning.md`: **201**, warning no bloqueante y mesa ocupada/pagada.

`B5-draft-snapshots.sql/txt` verifica sesiones abiertas, mesas ocupadas y una línea por borrador. La consulta de invariante de la tienda 10 encontró **0** sesiones abiertas sobre mesa con estado distinto de `occupied`. Los 37 tests del checkout shell y 3 del nombre POS pasaron (40/40 en total); el watcher Angular reportó ciclo OK sin errores. Datasets locales QA solamente, sin tocar producción.
