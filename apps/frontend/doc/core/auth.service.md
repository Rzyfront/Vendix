# AuthService (Core)

Ubicación: `src/app/core/services/auth.service.ts`

## Propósito
Autenticación base de la app (fuera del módulo Auth):
- Login, logout, refresh token.
- Gestión de tokens en localStorage y estado del usuario actual (BehaviorSubject).
- Helpers: isLoggedIn, isAdmin, getToken, redirectAfterLogin.

## Endpoints
Base: `http://localhost:3000/api/auth`
- POST `/login` ⇒ guarda `access_token`, `refresh_token`, `user`.
- POST `/refresh`
- POST `/register-owner` (para alta de propietario).

## Notas
- Redirige a `/admin/dashboard` tras login (uniforme para todos los roles por ahora).
- Considerar mover a `environment.apiUrl` y derivar base path.
