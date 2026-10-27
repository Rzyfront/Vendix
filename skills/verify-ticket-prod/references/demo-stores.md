# Demo account — multi-store test bench

The demo login is an owner ("Dueño") of org `vendix` ("Vendix Electronics") with 8 stores, each a
test bench for one industry. Pick the store whose industry matches the ticket.

| Store | `store_slug` | Use for |
| --- | --- | --- |
| Vendix Smart Gym | `suple-deportivo-y-salud` | Gym, memberships, supplements |
| Vendix Ferreterias | `tuerca-mia` | Hardware + online sales, dispatch routes / bulk shipping (highest data volume) |
| Vendix Style Men | `baxter` | Men's fashion retail (no services) |
| Vendix Aura Care Spa | `aura-care` | Spa, bookings, services |
| Vendix Moto & Car Parts and Services | `moto-and-car` | Automotive parts & services |
| Vendix Miramor Restaurant | `miramor` | Restaurant: tables, KDS, menus, recipes |
| Vendix Electronics | `e-tech` | Serialized tech products, strict inventory |
| Vendix Demo | `vendix-demo` | Generic sandbox |

## Switching store

1. User menu (top-right avatar, "Vendix Demo / Dueño") → **"Administrar Organización"**.
2. Org view → **"Todas las tiendas (8)"** → click the target store row.
3. Confirm the active store in the header before any scheme (right ticket, wrong store = false result).

Gotcha: "*N módulos nuevos disponibles. Actívalos en Configuración*" — a module missing in the store
may need activation in user settings; that is a config state, not necessarily "not deployed".

## Linear UUIDs used when closing

- `Done`: `30f4c5c5-e1de-43a7-b00e-b737fc6e73a4`
- `Todo`: `1c3e8e81-3fa4-46fa-9674-0d46e6bb003f`
- label `Devuelto`: `dbdfcb7c-af6f-49bb-825f-3f38f9df218e`

Full catalog: `linear-issues/references/states.md` and `labels.md`.
