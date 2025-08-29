# Checklist de Servicios de Autenticación y Seguridad en Vendix

## 1. Registro y Autenticación

### 1.1 Registro de Owner (Plataforma Vendix)
- [ ] Servicio de registro de owner (`POST /auth/register-owner`):
	- Crea usuario con rol `owner` y datos de organización
	- Inicia onboarding y asocia organización
	- Envía email de verificación

### 1.2 Registro de Customer (E-commerce de Tienda)
- [ ] Servicio de registro de customer (`POST /auth/register-customer`):
	- Crea usuario con rol `customer` asociado a una tienda/organización
	- Envía email de bienvenida/verificación

- [ ] Servicio de login (autenticación con email/usuario y contraseña)
- [ ] Servicio de generación y rotación de tokens JWT y refresh
- [ ] Servicio de cierre de sesión (logout y revocación de refresh token)

## 2. Gestión de Roles y Permisos
- [ ] Servicio para asignar roles a usuarios (desde interfaz privada)
- [ ] Servicio para invitar/crear usuarios especiales (admin, staff, etc.)
- [ ] Servicio para consultar roles y permisos del usuario autenticado

## 3. Verificación y Seguridad de Cuenta
- [ ] Servicio de envío de email de verificación
- [ ] Servicio de verificación de email (con token)
- [ ] Servicio para reenvío de email de verificación
- [ ] Servicio de recuperación de contraseña (enviar email)
- [ ] Servicio de restablecimiento de contraseña (con token)
- [ ] Servicio de cambio de contraseña autenticado
- [ ] Servicio de bloqueo/desbloqueo automático tras intentos fallidos

## 4. Auditoría y Sesiones
- [ ] Servicio de registro de intentos de login (exitosos/fallidos)
- [ ] Servicio de consulta de sesiones activas y revocación manual
- [ ] Servicio de validación avanzada de refresh token (fingerprint, IP, user agent)

## 5. Onboarding y Organización
- [ ] Servicio para iniciar onboarding tras registro de owner
- [ ] Servicio para crear organización durante onboarding
- [ ] Servicio para invitar miembros a la organización
- [ ] Servicio para consultar estado de onboarding

---

> **Nota:** Este checklist diferencia claramente el registro de owner (plataforma) y de customer (tienda), y cubre todos los flujos de autenticación y seguridad requeridos para una solución multi-tenant robusta en Vendix.
