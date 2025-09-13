# Módulo Admin

Rutas definidas en `src/app/modules/admin/admin.routes.ts` con layout propio y children.

## Propósito
Panel de administración (Vendix u organización/tienda, según entorno) con páginas:
- Dashboard
- Organizations
- Stores
- Users
- Analytics
- Settings

## Estructura
- Layout: `layout/admin-layout.component.*`
- Páginas: `pages/*`

## Flujo principal
- Accedido bajo `/admin` (protegido por `AdminGuard`).
- Carga perezosa de componentes standalone.
