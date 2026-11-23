# Demo account — multi-store test bench

The demo login is an owner ("Dueño") of org **Demo Vendix** (`vendix-demo`, id 33) with 13 stores,
each a test bench for one niche. Pick the store whose niche matches the ticket. Every store keeps
`retail` as its base industry and only the industries of its niche (verified 2026-11-04).

| Store | `store_slug` | Industries | Use for |
| --- | --- | --- | --- |
| Vendix Demo | `vendix-demo` | retail | Generic sandbox |
| Vendix Ferreterias | `tuerca-mia` | retail | Hardware + online sales, dispatch routes / bulk shipping (highest data volume) |
| Vendix Style Men | `baxter` | retail | Men's fashion retail |
| Vendix Electronics | `e-tech` | retail | Serialized tech products, strict inventory |
| Vendix Smart Gym | `suple-deportivo-y-salud` | retail, gym | Gym, memberships, supplements |
| Vendix Aura Care Spa | `aura-care` | retail, service | Spa, bookings, services |
| Vendix Barber Club | `vendix-barber-club` | retail, service | Barbershop, bookings |
| Vendix Moto & Car Parts and Services | `moto-and-car` | retail, service | Automotive parts & workshop services |
| Vendix Miramor Restaurant | `miramor` | retail, restaurant | Restaurant: tables, KDS, menus, recipes |
| Vendix Pit & Grill | `vendix-pit-and-grill` | retail, restaurant | Grill restaurant |
| Vendix Granizzo | `testbalmes` | retail, restaurant | Drinks / granizados counter |
| Vendix Paradize | `vendix-paradize` | retail, hospitality | Hotel / lodging |
| Vendix Tours | `vendix-tours` | retail, service, hospitality | Tourism, tours |

If the roster drifts, the source of truth is `GET https://api.vendix.online/api/organization/stores?limit=100`
from the org session (read-only), not the UI table (see gotchas).

## Login (Step 0)

1. `https://vendix.online/auth/login` → Email + Contraseña.
2. **"Seleccionar comercio (opcional)"** → tab **"Organización"** → V-link `vendix-demo` → **Confirmar**.
   The modal stays open over the form; close it with Confirmar before clicking "Iniciar Sesión".
3. "Iniciar Sesión" lands on the **org panel** (`/admin/dashboard`, "Panel Principal", KPI
   "Total de Tiendas").

## Switching store

1. Org panel → **Tiendas → Ver Todas las Tiendas** (`/admin/stores`), or the store name under the
   sidebar "Tiendas" submenu.
2. Click the store row → modal **"Cambiar al entorno de la tienda"** → **"Cambiar de entorno"**.
3. Confirm the store name and slug in the sidebar header before any scheme (right ticket, wrong
   store = false result).
4. Back to the org: user menu (avatar "Vendix Demo / Dueño") → **"Administrar Organización"**
   (only shown inside a store).

## Gotchas (known prod bugs, do not report as the ticket's defect)

- The org store table and sidebar list **only 10 stores**, with no pagination
  ("Todas las tiendas (10)" vs. 13 real). If the target store is missing, switch via API:
  `POST /api/auth/switch-environment {target_environment:"STORE_ADMIN", store_slug}`.
- Org-context sidebar link points to another store's domain (`tuerca-mia-store.vendix.online`).
- Console 403s on `/api/store/notifications*` in org context and on `/api/organization/stores*`
  after switching to a store; avatar image 404. Noise, unrelated to most tickets.
- **Never** edit store industries through `PATCH /api/organization/stores/:id`: it replaces the whole
  `store_settings.settings` JSON with `{general:{industries}}`. Use the store settings panel
  (store context), which sends the full `general` section.
- "*N módulos nuevos disponibles. Actívalos en Configuración*": a module missing in the store may
  need activation in user settings; that is a config state, not necessarily "not deployed".

## Linear UUIDs used when closing

- `Done`: `30f4c5c5-e1de-43a7-b00e-b737fc6e73a4`
- `Todo`: `1c3e8e81-3fa4-46fa-9674-0d46e6bb003f`
- label `Devuelto`: `dbdfcb7c-af6f-49bb-825f-3f38f9df218e`

Full catalog: `linear-issues/references/states.md` and `labels.md`.
