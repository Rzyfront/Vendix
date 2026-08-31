# Permisos por rol: `mesero` y `cocina` (QUI-727)

> Documenta los dos roles de operación de restaurante creados por la épica
> **QUI-727** ("Mejora integral de experiencia operativa — Pollo Árabe",
> plan crítico `CP-POLLO-ARABE-727`) y las reglas transversales que gobiernan
> cómo se definen, sincronizan y verifican los permisos de un rol en Vendix.
>
> Fuente de verdad verificada línea por línea antes de escribir este documento:
> - `apps/backend/prisma/seeds/permissions-roles.seed.ts`
> - `apps/backend/prisma/seeds/shared/sync-role-permissions.ts`
> - `apps/backend/src/domains/auth/guards/permissions.guard.ts`
> - `apps/backend/src/common/utils/role-scope.util.ts`

## 1. Propósito y alcance

`mesero` y `cocina` son roles de sistema (`is_system_role: true`,
`organization_id: null`) creados para el flujo de restaurante: el mesero abre
mesas, agrega ítems, dispara pedidos a cocina y cobra; cocina prepara,
marca el estado de los tickets y **nunca ve una cifra de dinero**. Ambos son
asignables desde organización y desde tienda (`ASSIGNABLE_SYSTEM_ROLES`, ver
§9).

Reglas transversales que gobiernan cómo se definen sus permisos:

- **ADR-2** — lista explícita, nunca derivación de otro rol (§4).
- **ADR-10** — ninguna superficie de cocina muestra dinero, garantizado en el
  servicio, no en el template (§5).
- El helper de sincronización del seed es **aditivo-solo**: no revoca por sí
  mismo, así que cada rol de lista explícita necesita su propio `deleteMany`
  de limpieza (§6).

## 2. Tabla de permisos de `mesero`

Lista canónica exacta (`meseroPermissionNames`,
`permissions-roles.seed.ts:5038-5085`) — **13 permisos**:

| # | Permiso | Ruta / método | Capacidad operativa que habilita |
|---|---------|----------------|-----------------------------------|
| 1 | `store:tables:read` | `GET /api/store/tables` | Ver el mapa de mesas (floor-map) y su estado (libre/ocupada). |
| 2 | `store:table_sessions:read` | `GET /api/store/table-sessions/:id` | Leer el detalle de una cuenta abierta (ítems, subtotal, total). |
| 3 | `store:table_sessions:update` | `PATCH /api/store/table-sessions/:id` | Agregar/quitar ítems, **cerrar la mesa, confirmar el pago y partir la cuenta (split)** — las cuatro capacidades del mismo endpoint (decisión ADR-2: mesero SÍ cobra y parte cuenta). |
| 4 | `store:table_sessions:create` | `POST /api/store/table-sessions` | Abrir una mesa disponible (crea la orden draft y vincula la sesión). Sin este permiso, la primera acción del mesero falla con 403. |
| 5 | `store:pos:access` | (gatea `POST /api/store/payments/pos`) | Cerrar el cobro de una mesa vía el flujo de pago POS. |
| 6 | `store:kitchen_fire:read` | `GET /api/store/kitchen-fire/tickets` (y `POST /kitchen-fire/preview`) | Previsualizar el disparo a cocina **antes** de disparar (el mesero llama `preview` antes de `fireOrderItems`). |
| 7 | `store:kitchen_fire:create` | `POST /api/store/kitchen-fire` | Disparar los ítems de la orden a cocina (consume inventario + crea ticket + emite COGS). |
| 8 | `store:recipes:read` | `GET /api/store/recipes` (y `/recipes/by-product/:id`) | Abrir el picker de exclusiones del plato (marcar "sin papas" antes de disparar). |
| 9 | `store:products:read` | `GET /api/store/products` | Listar el catálogo de productos para agregar ítems a la mesa. |
| 10 | `store:products:read:one` | `GET /api/store/products/:id` | Leer el detalle de un producto puntual. |
| 11 | `store:products:read:store` | `GET /api/store/products/store/:storeId` | Leer productos filtrados por tienda. |
| 12 | `store:products:read:slug` | `GET /api/store/products/slug/:slug/store/:storeId` | Resolver un producto por su slug. |
| 13 | `store:customers:read` | `GET /api/store/customers` | Leer clientes existentes (para asociar la venta a un cliente registrado en vez de anónimo/alias). |

**Nota histórica (no vigente):** durante F.1 Round 3 se agregó temporalmente
`store:settings:read` a esta lista para desatascar un 403 en el catálogo de
métodos de pago del cobro. Round 4 revirtió esa fila porque abría 12
controladores de configuración que nadie pidió, y corrigió el endpoint real
(`payments.controller`) para exigir `store:pos:access` en su lugar — permiso
que el mesero ya tenía. La lista de arriba es el estado final tal como está
en el código; el `deleteMany` de §6 es lo que limpia esa fila residual en
cualquier base sembrada con la versión intermedia.

## 3. Tabla de permisos de `cocina`

Lista canónica exacta (`cocinaPermissionNames`,
`permissions-roles.seed.ts:5134-5164`) — **12 permisos**:

| # | Permiso | Ruta / método | Capacidad operativa que habilita |
|---|---------|----------------|-----------------------------------|
| 1 | `store:kitchen_fire:read` | `GET /api/store/kitchen-fire/tickets` | Ver los tickets de cocina entrantes (comandas). |
| 2 | `store:kitchen_fire:update` | `PATCH /api/store/kitchen-fire/tickets/:id` | Actualizar el estado del ticket (`in_preparation` / `ready` / `delivered` / `cancelled`). |
| 3 | `store:kds:read` | `GET /api/store/kds/unique-read` | Leer las estaciones de cocina (KDS). |
| 4 | `store:kds:create` | `POST /api/store/kds/unique-create` | Crear una estación de cocina. |
| 5 | `store:kds:update` | `PUT /api/store/kds/:id/unique-update` | Actualizar una estación de cocina. |
| 6 | `store:kds:delete` | `DELETE /api/store/kds/:id/unique-delete` | Desactivar una estación de cocina. |
| 7 | `store:kds_sessions:read` | `GET /api/store/kds-sessions/unique-read` | Leer turnos de estación y su consumo de insumos (sin costos, ver §5). |
| 8 | `store:kds_sessions:create` | `POST /api/store/kds-sessions/open` | Abrir un turno de estación (reclamarla al empezar a trabajar). |
| 9 | `store:kds_sessions:update` | `POST /api/store/kds-sessions/:id/close` | Cerrar un turno de estación. |
| 10 | `store:tables:read` | `GET /api/store/tables` | Ver el mapa de mesas (floor-map **sin montos**) para ubicar a qué mesa pertenece un ticket. |
| 11 | `store:recipes:read` | `GET /api/store/recipes` (y `/recipes/by-product/:id`) | Ver el árbol de receta del plato (insumos) en el detalle del ticket. La receta no lleva montos, así que no viola ADR-10. |
| 12 | `store:products:read` | `GET /api/store/products` | Leer el catálogo de productos, con proyección reducida sin dinero (`stripCocinaMoney`, ver §5). |

**Deliberadamente ausente:** `store:table_sessions:read`. Ese endpoint abre el
detalle de la cuenta de mesa (`grand_total`, `subtotal`, `tax`, `discount`,
pagos pendientes) — dinero que ADR-10 prohíbe para cocina. El tablero de
cocina es `kitchen_fire` / `kds` / `kds_sessions`, no la cuenta de mesa.

## 4. ADR-2 — listas explícitas, nunca derivación

**Regla:** `mesero` y `cocina` se definen con un arreglo de nombres de
permiso enumerado a mano (`meseroPermissionNames`, `cocinaPermissionNames`),
**nunca** como "subconjunto de `cashier`" ni de ningún otro rol.

**Por qué:** `cashierPermissions` (el filtro de permisos de `cashier`, en
`permissions-roles.seed.ts:4855-4954`) se construye con una cadena de
`p.name.includes(...)` que **no contiene ninguna clave** `store:tables:`,
`store:table_sessions:`, `store:kitchen_fire:` ni `store:kds:` — verificado
leyendo el filtro completo. Un `mesero` derivado como subconjunto de
`cashier` heredaría el mismo vacío y sería **incapaz de abrir una mesa**: la
primera acción del flujo (`GET /store/tables` o `POST /store/table-sessions`)
devolvería 403 antes de que el mesero pudiera hacer nada.

El comentario que fija esta regla en el código está en
`permissions-roles.seed.ts:5031-5036`, justo antes de la lista de `mesero`.

## 5. ADR-10 — ninguna superficie de cocina muestra dinero

**Regla de producto:** cocina ve **qué plato, qué variante, qué exclusiones y
cuántas unidades de insumo**. Nada más — ni `cost_price`, ni `profit_margin`,
ni ningún precio de venta, ni totales de cuenta.

### Se cumple en el payload, no en el template

El dato de dinero **no debe viajar** en el JSON de respuesta cuando el rol
autenticado es `cocina`. Un `grep` limpio sobre los templates del frontend
del KDS **no es prueba suficiente** — el payload puede llevar el campo aunque
ninguna plantilla lo renderice. La prueba válida es un `curl` con el JWT de
un usuario `cocina` cuyo JSON de respuesta no contenga ninguna clave de
costo/precio (comando exacto en §8).

### Mecanismo: proyección por rol en el servicio (no un interceptor)

La decisión de dónde recortar el dato es explícita: se hace **en el
servicio**, función por función, no con un interceptor global. Un
interceptor lo haría implícito y difícil de auditar frente a otras lecturas
que sí deben mostrar dinero.

Tres funciones de strip, verificadas leyendo el código:

- **`stripCocinaMoney`** — `apps/backend/src/domains/store/products/products.service.ts:1448`.
  Quita `cost_price`, `profit_margin`, `base_price`, `sale_price`,
  `final_price`, `active_promotion` y `sale_config_summary` del producto, y
  `cost_price` / `profit_margin` / `sale_price` / `price_override` de cada
  variante. Se invoca desde `isKitchenRole()` (línea 1438) en varios puntos
  de lectura de `products.service.ts` (líneas 1810, 1994, 2258, 2392 y 3971
  al momento de escribir esto).
- **`stripCocinaRecipeMoney`** — `apps/backend/src/domains/store/recipes/recipes.service.ts:149`.
  Quita `base_price` del producto de la receta y `base_price`/`cost_price`
  del `component_product` de cada ítem. Se invoca en `findAll` (línea 221) y
  `findOne` (línea 270) de `recipes.service.ts`.
- **`stripSummaryCost`** — `apps/backend/src/domains/store/kds/sessions/kds-sessions.service.ts:71`.
  Quita `total_cost` y `unit_cost` del `summary` JSON persistido al cerrar un
  turno de estación (snapshots anteriores a esta regla podían traerlos). Se
  invoca en `findAll` (línea 61) de `kds-sessions.service.ts`. El reporte de
  consumo por turno (`ingredients`) es **solo cantidades**: el total
  monetario del turno **se retiró sin sustituto** en cocina — no hay ningún
  campo que lo reemplace, a propósito (ADR-10, comentarios en las líneas
  ~319 y ~414 del mismo archivo).

### `findByProduct` de recetas queda intacto — es el camino seguro

`recipes.service.ts::findByProduct` (la función que consume el KDS para el
detalle del ticket) **no aplica ningún strip** y es correcto que no lo haga:
su `select` de Prisma nunca incluye `base_price` ni `cost_price` en primer
lugar (verificado leyendo el `include` completo, líneas 273-297) — el dato
monetario nunca entra al objeto, así que no hay nada que recortar. `findAll`
y `findOne` sí necesitan el strip porque **sí** seleccionan esos campos (para
servir a otros roles que sí deben ver dinero).

## 6. Trampa: `syncRolePermissions` es aditivo-solo

**Esta es la sección más importante para quien mantenga estos roles.**

El helper `syncRolePermissions`
(`apps/backend/prisma/seeds/shared/sync-role-permissions.ts`) tiene un
docstring de función (líneas 20-45) que describe un comportamiento de dos
pasos — insertar lo faltante **y revocar** lo que sobra por
set-difference — pero la implementación real (líneas 60-79) **solo hace
`createMany({ skipDuplicates: true })`**. Nunca borra una fila de
`role_permissions`. El propio código lo señala en un comentario justo encima
de la inserción: *"Additive-only: insert missing assignments, never revoke
existing ones."*, y la interfaz de retorno documenta que `revoked` queda
`0` "kept for backward compatibility" (líneas 8-11).

**Consecuencia real que ya ocurrió:** durante la épica, una base de datos
sembrada con una lista intermedia de `cocina` (antes de que Round 1
retirara `store:table_sessions:read`) conservaba ese permiso para siempre —
volver a correr el seed con la lista canónica nueva no lo quitaba, porque
`syncRolePermissions` solo agrega. `cocina` seguía pudiendo leer
`order.grand_total` vía `GET /store/table-sessions/:id` pese a que la lista
canónica ya no lo incluía. Esto se detectó y se corrigió en F.1 Round 4
(commit `ade76d54a`).

**Por eso** los roles de lista explícita (`mesero`, `cocina`) llevan, además
del `syncRolePermissions`, un `deleteMany` idempotente propio sobre el
**complemento** de su lista canónica (`permission_id: { notIn: [...] }`) —
el mismo patrón que ya usaban `owner`/`admin`/`manager` para limpiar
`superadmin:*`:

- **Bloque de revocación de `mesero`:**
  `apps/backend/prisma/seeds/permissions-roles.seed.ts:5106-5119`.
- **Bloque de revocación de `cocina`:**
  `apps/backend/prisma/seeds/permissions-roles.seed.ts:5185-5198`.

Ambos son no-op en re-runs: si no hay filas fuera de la canónica, el
`deleteMany` no borra nada y no se imprime el log de "Revoked".

## 7. Cómo agregar un permiso a `mesero` o `cocina`

1. Editar la lista canónica correspondiente en el seed:
   `meseroPermissionNames` o `cocinaPermissionNames` en
   `apps/backend/prisma/seeds/permissions-roles.seed.ts` (líneas 5038 y 5134
   respectivamente). Si el permiso es nuevo (no existe en la tabla
   `permissions`), agregarlo primero en su bloque de definiciones más arriba
   en el mismo archivo.
2. Re-correr el seed (ver `vendix-prisma-seed` para el comando/entorno
   correcto del proyecto).
3. Verificar con `psql` que (a) el conteo de `role_permissions` del rol
   cambió y (b) no quedó ninguna fila fuera de la lista canónica:

   ```sql
   -- Conteo actual de permisos asignados al rol
   SELECT r.name, COUNT(rp.*) AS total_permisos
   FROM roles r
   JOIN role_permissions rp ON rp.role_id = r.id
   -- QUI-730b — renombrados a `kitchen` y `waiter`.
   WHERE r.name = 'kitchen'  -- o 'waiter'
   GROUP BY r.name;

   -- Filas fuera de la lista canónica (debe devolver 0 filas)
   SELECT p.name
   FROM role_permissions rp
   JOIN permissions p ON p.id = rp.permission_id
   JOIN roles r ON r.id = rp.role_id
   WHERE r.name = 'kitchen'  -- o 'waiter'
     AND p.name NOT IN (
       -- pegar aquí la lista canónica vigente del seed, ej.:
       'store:kitchen_fire:read', 'store:kitchen_fire:update',
       'store:kds:read', 'store:kds:create', 'store:kds:update', 'store:kds:delete',
       'store:kds_sessions:read', 'store:kds_sessions:create', 'store:kds_sessions:update',
       'store:tables:read', 'store:recipes:read', 'store:products:read'
     );
   ```

## 8. Cómo verificar el invariante ADR-10 en runtime

No basta con revisar el código: la prueba es un `curl` real con un JWT de un
usuario `cocina` sobre un endpoint que sirve productos o recetas, contando
claves monetarias en la respuesta con `jq`. El resultado esperado es `0`:

```bash
curl -s "http://localhost:3000/api/store/products" \
  -H "Authorization: Bearer $TOKEN_COCINA" \
  | jq '[.. | objects | keys[]] | map(select(test("cost|price"))) | length'
# Esperado: 0
```

Repetir contra `GET /api/store/recipes` y `GET /api/store/kds-sessions/unique-read`
con el mismo `$TOKEN_COCINA` para cubrir los otros dos puntos de strip.
Nunca commitear un token real ni una contraseña en este documento — usar
siempre un marcador como `$TOKEN_COCINA` obtenido de un login de prueba en
el entorno local.

## 9. Nota sobre `panel_ui` vs autorización

`panel_ui` controla **visibilidad de UI** en el frontend — qué módulos ve un
usuario en el sidebar — y ese guard corre en el navegador (Angular). **No es
autorización.** La defensa real contra un llamado directo a la API es
`@Permissions(...)` + `PermissionsGuard` en el backend
(`apps/backend/src/domains/auth/guards/permissions.guard.ts`), que es lo que
este documento describe en las secciones anteriores.

No prometer nunca que ocultar un módulo en `panel_ui` impide que ese rol
llame a su API: si el permiso backend existe, la llamada directa
(`curl`, DevTools, un cliente HTTP cualquiera) funciona igual esté o no el
módulo visible. `mesero` y `cocina` son además roles de sistema asignables
(`ASSIGNABLE_SYSTEM_ROLES.organization` y `.store` en
`apps/backend/src/common/utils/role-scope.util.ts`, líneas 91-92 y 101-102),
pero eso gobierna quién puede **asignar el rol**, no qué puede hacer un
usuario que ya lo tiene — eso lo deciden únicamente las tablas de §2 y §3.

**Ver también** — `apps/backend/src/common/services/README-panel-ui-per-user.md`
para cómo configurar `panel_ui` por usuario (endpoints, DTO con whitelist,
deep-merge por `app_type`, `sync-panel-ui` masivo, marca de "visto"). El
presente documento y ese son complementarios: este gobierna **qué puede
hacer** un usuario con un rol; aquel gobierna **qué módulos ve** el
mismo usuario en el sidebar.

## 10. Referencias

- `apps/backend/prisma/seeds/permissions-roles.seed.ts` — listas canónicas
  (`meseroPermissionNames` línea 5038, `cocinaPermissionNames` línea 5134),
  bloques de revocación (líneas 5106-5119 y 5177-5190), definición de
  `cashierPermissions` (líneas 4855-4954) y comentario de la regla ADR-2
  (líneas 5031-5036).
- `apps/backend/prisma/seeds/shared/sync-role-permissions.ts` — helper
  `syncRolePermissions`, aditivo-solo pese a su docstring.
- `apps/backend/src/domains/auth/guards/permissions.guard.ts` — `PermissionsGuard`.
- `apps/backend/src/common/utils/role-scope.util.ts` — `ASSIGNABLE_SYSTEM_ROLES`,
  `HIDDEN_ROLE_NAMES`.
- `apps/backend/src/domains/store/products/products.service.ts` — `stripCocinaMoney` (línea 1448), `isKitchenRole` (línea 1438).
- `apps/backend/src/domains/store/recipes/recipes.service.ts` — `stripCocinaRecipeMoney` (línea 149), `findByProduct` (línea 273).
- `apps/backend/src/domains/store/kds/sessions/kds-sessions.service.ts` — `stripSummaryCost` (línea 71).
