# AdminGuard

Ubicación: `src/app/core/guards/admin.guard.ts`

## Propósito
Proteger rutas de administración. Actualmente permite acceso a cualquier usuario autenticado.

## Lógica
- Si `AuthService.isLoggedIn()` ⇒ true, permite acceso.
- Si no, redirige a `/auth/login` y deniega.

## Mejora sugerida
- Verificar rol (p. ej., `isAdmin()`) y/o permisos por ruta cuando estén disponibles.
