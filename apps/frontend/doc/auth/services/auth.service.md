# AuthService (Módulo Auth)

Ubicación: `src/app/modules/auth/services/auth.service.ts`

## Propósito
Servicio de registro de propietario (owner onboarding) desde el módulo de Auth.

## Endpoint
- POST `http://localhost:3000/auth/register-owner`

## Manejo de errores
- Traducidos a mensajes amigables según status (400, 409, 500).

## Diferencias vs Core AuthService
- Este servicio solo gestiona registro (no tokens). El Core AuthService maneja login/refresh/logout.
