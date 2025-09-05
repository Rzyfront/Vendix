# Pruebas HTTP - Password Recovery Service

Este archivo contiene pruebas exhaustivas para los endpoints de recuperación de contraseña de Vendix.

## Requisitos previos

1. **Backend corriendo**: Asegúrate de que el backend esté ejecutándose en `http://localhost:3000/api`
2. **Base de datos preparada**: Ejecuta el seed si no lo has hecho:
   ```bash
   npx prisma db seed
   ```
3. **Migraciones aplicadas**: Asegúrate de que las migraciones estén aplicadas
4. **Extension REST Client**: En VS Code, instala la extensión "REST Client" de Huachao Mao
5. **Usuario de prueba**: Crea un usuario de prueba con email conocido para las pruebas

## Verificar que el servidor esté funcionando

Antes de ejecutar las pruebas, verifica que el servidor responda:

```
GET http://localhost:3000/api/health
```

Deberías recibir una respuesta 200 OK.

## Casos de prueba incluidos

### ✅ Casos de éxito
- **Recuperación exitosa**: Email válido genera token y envía email
- **Reset exitoso**: Token válido actualiza contraseña correctamente
- **Cambio exitoso**: Usuario autenticado cambia contraseña
- **Contraseña fuerte**: Cumple todos los requisitos de seguridad
- **Email con caracteres especiales**: Manejo de emails complejos

### ⚠️ Casos de validación
- **Email no existente**: Mensaje genérico (no revela existencia)
- **Token expirado**: Mensaje claro de expiración
- **Token ya usado**: Prevención de reutilización
- **Token inválido**: Validación de formato
- **Usuario inactivo**: Verificación de estado de cuenta
- **Contraseña débil**: Validación de fortaleza
- **Contraseña igual**: Prevención de reutilización
- **Campos vacíos**: Validación de entrada requerida

### 🔒 Casos de seguridad
- **Rate limiting**: 5 intentos por IP cada 15 minutos
- **Enumeración prevention**: Mensajes genéricos que no revelan existencia de emails
- **Session invalidation**: Todas las sesiones se limpian después del cambio
- **Audit logging**: Registro completo de todos los eventos
- **Token uniqueness**: Cada token es único y no reutilizable

### 🚦 Casos de rate limiting
- **Múltiples intentos**: Verificar bloqueo después de 5 intentos
- **Ventana de tiempo**: 15 minutos de cooldown
- **Reinicio automático**: Después de la ventana, permite nuevos intentos

## Cómo ejecutar las pruebas

1. **Abre el archivo** `password-recovery-tests.http` en VS Code
2. **Ejecuta las requests** en orden secuencial haciendo clic en "Send Request" sobre cada una
3. **Verifica las respuestas** y compara con los resultados esperados
4. **Para pruebas de rate limiting**: Ejecuta las requests 6-11 en secuencia rápida

## Resultados esperados

### Respuestas exitosas

#### Forgot Password (Solicitud de recuperación)
```json
{
  "message": "Si el email existe, recibirás instrucciones para restablecer tu contraseña"
}
```

#### Reset Password (Restablecimiento exitoso)
```json
{
  "message": "Contraseña restablecida exitosamente"
}
```

#### Change Password (Cambio exitoso)
```json
{
  "message": "Contraseña cambiada exitosamente. Todas las sesiones han sido invalidadas por seguridad."
}
```

### Respuestas de error

#### Token expirado
```json
{
  "statusCode": 400,
  "message": "Token expirado. Solicita un nuevo enlace de recuperación.",
  "error": "Bad Request"
}
```

#### Contraseña débil
```json
{
  "statusCode": 400,
  "message": "La contraseña debe tener al menos 8 caracteres, incluyendo mayúsculas, minúsculas y números",
  "error": "Bad Request"
}
```

#### Rate limiting excedido
```json
{
  "statusCode": 429,
  "message": "Too many requests from this IP, please try again later.",
  "error": "Too Many Requests",
  "retryAfter": "900"
}
```

## Secuencia de pruebas recomendada

### 1. Pruebas básicas (1-3)
- Verificar funcionamiento básico
- Confirmar emails se envían correctamente

### 2. Pruebas de validación (4-8)
- Probar diferentes tipos de error
- Verificar mensajes de error apropiados

### 3. Pruebas de seguridad (9-11)
- Verificar rate limiting
- Probar múltiples intentos

### 4. Pruebas de edge cases (12-20)
- Emails con caracteres especiales
- Contraseñas en diferentes formatos
- Campos vacíos y valores límite

## Notas importantes

### Tokens de prueba
- **Para las pruebas reales**: Necesitas tokens válidos generados por el sistema
- **Token expirado**: Espera más de 1 hora después de generar el token
- **Token usado**: Usa un token que ya hayas utilizado para reset

### Usuario de prueba
- **Email conocido**: Usa un email de un usuario que existe en la base de datos
- **Contraseña actual**: Necesaria para pruebas de cambio de contraseña
- **Estado activo**: Asegúrate de que el usuario esté en estado 'active'

### Rate Limiting
- **Contador**: Se reinicia cada 15 minutos
- **Por IP**: Afecta a toda la IP del cliente
- **Endpoints afectados**: forgot-password y reset-password

### Emails
- **Verificación**: Revisa la consola del backend para ver logs de envío
- **Contenido**: Los emails contienen enlaces con tokens de reset
- **Plantillas**: Usa las plantillas configuradas en el servicio de email

## Troubleshooting

### Problemas comunes

#### "Usuario no encontrado o cuenta inactiva"
- Verifica que el usuario existe en la base de datos
- Confirma que el estado del usuario es 'active'
- Revisa que el email esté escrito correctamente

#### "Token inválido"
- Verifica que el token no tenga espacios extra
- Confirma que el token no haya expirado (1 hora límite)
- Asegúrate de que el token no haya sido usado previamente

#### Rate limiting no funciona
- Verifica que el middleware esté configurado correctamente
- Confirma que las requests vengan de la misma IP
- Espera 15 minutos para que se reinicie el contador

#### Emails no se envían
- Verifica la configuración del servicio de email
- Revisa las credenciales de SendGrid/Resend
- Confirma que el backend tenga conectividad a internet

### Logs útiles
```bash
# Ver logs del backend
tail -f logs/backend.log

# Ver logs de email
grep "email" logs/backend.log

# Ver logs de auditoría
grep "PASSWORD_RESET" logs/backend.log
```

## Métricas de éxito

Después de ejecutar todas las pruebas, deberías tener:
- ✅ 3 respuestas exitosas (forgot, reset, change)
- ✅ 8+ respuestas de error con mensajes apropiados
- ✅ Rate limiting funcionando después de 5 intentos
- ✅ Emails enviados correctamente (verificar logs)
- ✅ Auditoría registrada para todos los eventos

---

**Estado de las pruebas**: ✅ **Listo para ejecución**
**Última actualización**: Septiembre 2025
**Versión**: 1.0.0
