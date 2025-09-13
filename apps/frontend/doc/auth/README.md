# Módulo Auth

Rutas: `src/app/modules/auth/auth.routes.ts`
- `/auth/login`
- `/auth/register`

## Propósito
Pantallas de autenticación para ingreso y registro de propietarios.

## Servicios internos
- `services/auth.service.ts`: registro de propietario (`/auth/register-owner`).

## Flujo
- Navegación desde guard o enlaces.
- Tras login en core.AuthService, se redirige a `/admin/dashboard`.
