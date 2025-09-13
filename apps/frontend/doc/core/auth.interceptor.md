# AuthInterceptor

Ubicación: `src/app/core/interceptors/auth.interceptor.ts`

## Propósito
Adjuntar token de autenticación a cada petición y gestionar renovación de token en caso de 401.

## Flujo
1. Lee token con `AuthService.getToken()` y lo añade a `Authorization: Bearer <token>`.
2. Si respuesta 401:
   - Intenta `AuthService.refreshToken()` (si existe `refresh_token`);
   - Guarda el nuevo `access_token` y reintenta la petición original.
   - Si falla, ejecuta `logout()`.
3. Si ya hay un refresh en curso, espera a que `refreshTokenSubject` emita nuevo token.

## Notas
- Usar `environment.apiUrl` para bases de URL en servicios ayuda a evitar interceptar dominios externos si es necesario (no imprescindible).
