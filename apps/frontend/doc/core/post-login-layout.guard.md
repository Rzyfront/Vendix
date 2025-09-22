# PostLoginLayoutGuard

Guarda que, tras el login (o al visitar `/post-login`), decide a qué layout redirigir según roles y preferencia del usuario.

## Flujo
1. Obtiene `user` desde `AuthService`.
2. Obtiene `domainApp` desde `TenantConfigService.domainConfig$` (o `DomainDetectorService`).
3. Llama a `LayoutRouterService.computePostLoginUrl(user, domainApp)`.
4. Navega a la URL destino. Si no hay layout permitido, navega a `/auth/forbidden`.

## Beneficios
- Centraliza la lógica de elección del layout.
- Facilita el soporte a casos especiales (Owner en Vendix landing, multi-org).
