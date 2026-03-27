# app-not-found-redirect

Redireccion inteligente para rutas no encontradas (404). Ejecuta logica en `ngOnInit` sin mostrar contenido.

## Estrategia de Redireccion

| Estado                                        | Redireccion              |
| --------------------------------------------- | ------------------------ |
| No autenticado                                | `/` (landing)            |
| VENDIX_ADMIN                                  | `/super-admin/dashboard` |
| ORG_ADMIN                                     | `/admin/dashboard`       |
| STORE_ADMIN                                   | `/admin/dashboard`       |
| STORE_ECOMMERCE / STORE_LANDING / ORG_LANDING | `/`                      |

## Uso

Se utiliza como componente en rutas catch-all.

```typescript
// En routing module
{ path: '**', component: NotFoundRedirectComponent }
```

## Importante

- No tiene template visible; toda la logica es en `ngOnInit`.
- Muestra toast de advertencia si la ruta no existe y no hay supresion de notificaciones.
- Suprime notificaciones durante logout/terminacion de sesion via `SessionService`.
- Necesita `Store`, `Router`, `SessionService` y `ToastService`.
