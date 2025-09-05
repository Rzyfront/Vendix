# Checklist de Implementación: Módulo de Autenticación Multi-Inquilino

## Fase 1: Cimientos Multi-Inquilino (Completado)
- [x] **Schema de Base de Datos:** Refactorizar `schema.prisma` para eliminar la unicidad global del `email` y establecer la relación `user -> organization`.
- [x] **Registro de Dueño:** Implementar el servicio `registerOwner` para crear un `user` y su `organization` de forma transaccional.
- [x] **Login Contextual:** Implementar el servicio de `login` que requiere `email`, `password` y `organizationSlug` para validar al usuario en el contexto de su inquilino.
- [x] **DTOs Actualizados:** Adaptar `LoginDto` y `RegisterOwnerDto` para soportar el nuevo flujo multi-inquilino.
- [x] **Errores de Compilación (Global):** Solucionar todos los errores de compilación causados por la refactorización del esquema, regenerando el cliente de Prisma y adaptando los servicios (`addresses`, `orders`, `users`, etc.) para que el proyecto sea compilable.

## Fase 2: Funcionalidades Críticas (Pendiente)
- [ ] **Recuperación de Contraseña:** Implementar el flujo completo de `forgotPassword` y `resetPassword`, asegurando que sea contextual a la organización.
- [ ] **Registro de Clientes:** Implementar la lógica en `registerCustomer` para crear usuarios con rol "cliente" asociados a una tienda y su respectiva organización.

## Fase 3: Flujos Secundarios y de Soporte (Pendiente)
- [ ] **Verificación de Email:** Implementar los servicios `verifyEmail` y `resendEmailVerification`.
- [ ] **Onboarding Inconcluso:** Añadir la lógica para detectar y redirigir a usuarios con un proceso de onboarding pendiente, como se describe en el documento de diseño.
- [ ] **Registro de Staff:** Implementar la funcionalidad para que un administrador pueda crear cuentas de staff desde el panel de control.

## Fase 4: Seguridad y Mejoras (Pendiente)
- [ ] **Asignación de Roles:** Asignar automáticamente los roles de `owner` y `customer` durante los flujos de registro correspondientes.
- [ ] **Seguridad de Tokens:** Implementar `device fingerprinting` y seguimiento de IP en los `refresh_tokens` para mayor seguridad.

---

> **Nota:** Este checklist refleja el estado del proyecto tras la refactorización inicial a una arquitectura multi-inquilino. La Fase 1 está completa, sentando las bases para el desarrollo de las funcionalidades pendientes.