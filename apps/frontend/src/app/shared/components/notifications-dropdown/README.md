# notifications-dropdown

Dropdown de notificaciones con contaje de no leidas, navegacion automatica y facade de notificaciones.

## Uso

```html
<!-- Solo colocar en el layout — no requiere configuracion -->
<app-notifications-dropdown></app-notifications-dropdown>
```

```typescript
// Se integra automaticamente con NotificationsFacade
// No necesita inputs — todo viene del store NgRx
```

## Inputs

No tiene inputs. Toda la data viene del `NotificationsFacade` inyectado.

## Importante

- Se integra con `NotificationsFacade` — observables: `notifications$` y `unreadCount$`
- Click fuera o `Escape` cierra el dropdown
- Cada notificacion tiene navegacion automatica al hacer click segun su `type`:
  - `new_order`, `order_status_change`, `payment_received` -> `/admin/orders/...`
  - `new_customer` -> `/admin/customers/...`
  - `low_stock` -> `/admin/products/...`
  - `layaway_*` -> `/admin/orders/layaway/...`
  - `installment_*` -> `/admin/orders/credits/...`
- `formatTime()` muestra: "Ahora", "hace Xm", "hace Xh" o fecha curta
- El icono se selecciona automaticamente por `type` via `getIconForType()`
- Marcar todas como leidas con `markAllRead()`
- Requiere `Router` para navegacion
