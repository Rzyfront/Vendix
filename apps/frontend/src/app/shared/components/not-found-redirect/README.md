# app-not-found-redirect

Componente de la ruta catch-all (`**`) para rutas no encontradas.

## Comportamiento

| Estado | Resultado |
| --- | --- |
| No autenticado (visitantes y robots) | Muestra «Página no encontrada» con enlace al inicio, `noindex, follow` y sin canonical. **No redirige** (SEO-TECH-03: redirigir a `/` hacía que Google viera cada URL desconocida como copia de la portada). |
| VENDIX_ADMIN | Redirige a `/super-admin/dashboard` |
| ORG_ADMIN / STORE_ADMIN | Redirige a `/admin/dashboard` |
| STORE_ECOMMERCE / STORE_LANDING / ORG_LANDING (autenticado) | Redirige a `/` |
| STORE_DELIVERY | Redirige a `/repartos` |

## Uso

```typescript
{ path: '**', loadComponent: () => import('...').then((c) => c.NotFoundRedirectComponent) }
```

## Importante

- Los metadatos (título, robots y canonical) se restauran al salir de la vista 404.
- Muestra un toast de advertencia solo al usuario autenticado que es redirigido.
- Suprime notificaciones durante el logout o la terminación de sesión vía `SessionService`.
- El HTTP sigue siendo 200 (CloudFront sirve `index.html` a toda ruta sin extensión). `noindex` hace que Google no indexe la URL.
