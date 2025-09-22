# Pasos de scaffolding sugeridos (Angular 16+ standalone/20)

1) Tipos compartidos
- Crear en `libs/shared-types` los enums `DomainApp` y `LayoutKey` y `UserProfile` (ya creados).

2) LayoutRouterService
- `src/app/core/services/layout-router.service.ts`
- Implementar `computeHomeUrlFor`, `computePostLoginUrl`, `layoutToUrl`.
- Añadir pruebas unitarias básicas.

3) DomainAppGuard
- `src/app/core/guards/domain-app.guard.ts` con `canMatch` para rutas raíz.
- Usa `DomainDetectorService` → `TenantConfigService` → `ThemeService` y luego `LayoutRouterService`.

4) PostLoginLayoutGuard
- `src/app/core/guards/post-login-layout.guard.ts` con `canActivate` en `/post-login`.

5) LayoutAccessGuard (por módulo)
- `src/app/core/guards/layout-access.guard.ts` que verifica si el layout del módulo actual está permitido al usuario.

6) Rutas
- Añadir ruta `/post-login` que sólo ejecuta guard y redirige.
- Aplicar `canMatch: [DomainAppGuard]` en ruta raíz para decidir home pública.

7) UI de preferencia de layout
- En perfil de usuario, dropdown para `preferredLayout`; persistir en backend.

8) Tema y branding
- Integrar `ThemeService.applyTenantConfiguration()` al inicio.

9) Validaciones
- Tests para LayoutRouterService con combinaciones de roles/preferencias.
- Smoke test de guards.
