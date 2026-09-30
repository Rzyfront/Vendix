# C.3 — KDS evita acción inválida y explica dónde entregar (QA local)

Tienda #10, 2026-09-23, Playwright Node en `https://vendix.com/admin/restaurant-ops/kds` con cocinero #242, estación Barra #7. Ticket **mixto #108** (`ready`, ítems #1907 para llevar y #1908 de mesa) y ticket **100% para llevar #109** (`ready`, ítem #1909) se generaron con producto #333 sin receta ni stock; 0 movimientos de inventario. El producto se restauró a `kds_id=NULL` tras cada fire.

Antes del ajuste, `deliverDisabledReason` devolvía «La entrega la registra el mesero o el cajero, no la cocina» **precisamente cuando `allTakeaway=true` y el botón Entregar estaba habilitado**: copy invertida y contradictoria en tarjeta y modal. Ahora ambas superficies muestran:

| Ticket | Tarjeta «Entregar» | Modal «Entregar» |
| --- | --- | --- |
| #108 mixto | deshabilitado; título «Este ticket incluye platos de mesa: entrégalos por ítem desde la mesa. Cocina solo entrega tickets 100% para llevar.» | mismo estado y título |
| #109 100% para llevar | habilitado; `title=null` | mismo estado, `title=null` |

Playwright registró **0 errores JS**. Prueba Angular focalizada `kds-delivery-hint.spec.ts` **2/2** para ambas superficies y ambos estados. Capturas locales `/tmp/c3-{mixed,takeaway}-kds-{card,modal}.png`, log `/tmp/c3-ui-both-hints.log`, Karma `/tmp/c3-hint-karma.log`. No se pulsó Entregar en #109 (era una línea QA, no un servicio real). La respuesta 422 `KITCHEN_TICKET_NOT_TAKEAWAY` se probó por API en la matriz C.3 anterior; en la UI del KDS el control deshabilitado la evita antes del request. Es incorrecto exigir un *toast* 422 por un clic real imposible sin carrera/cliente alterado; falta aún capturar el toast alcanzable `KDS_STATION_LOCKED` con dos operadores KDS.

Limpieza de #109: mesa/sesión #123 cerrada (201); ticket cancelado (201); orden #1185 cancelada (200) con `kitchenDisposition=reuse`, necesario incluso siendo receta-less sin consumo; producto #333 otra vez `kds_id=NULL`, mesa #26 `cleaning`, 0 movimientos. El ticket mixto #108 y sus dos líneas siguen como historial QA de C.1, con sesión #122 cerrada.
