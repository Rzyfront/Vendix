# Pruebas HTTP - Register Client

Este archivo contiene pruebas exhaustivas para el endpoint `POST /auth/register-customer` de Vendix.

## Requisitos previos

1. **Backend corriendo**: Asegúrate de que el backend esté ejecutándose en `http://localhost:3000/api`
2. **Base de datos preparada**: Ejecuta el seed si no lo has hecho:
   ```bash
   npx prisma db seed
   ```
3. **Migraciones aplicadas**: Asegúrate de que las migraciones estén aplicadas
4. **Extension REST Client**: En VS Code, instala la extensión "REST Client" de Huachao Mao

## Verificar que el servidor esté funcionando

Antes de ejecutar las pruebas, verifica que el servidor responda:

```
GET http://localhost:3000/api/health
```

Deberías recibir una respuesta 200 OK.

## Casos de prueba incluidos

### ✅ Casos de éxito
- **Registro exitoso**: Nuevo cliente con todos los campos
- **Sin teléfono**: Campo opcional omitido
- **Caracteres especiales**: Nombres con acentos y apóstrofes
- **Email con subdominio**: Emails complejos

### ⚠️ Casos de validación
- **Tienda no encontrada**: Store ID inexistente
- **Usuario ya existe**: Email duplicado en organización
- **Contraseña débil**: Validación de fortaleza
- **Email inválido**: Formato incorrecto
- **Campos requeridos faltantes**: Validación de DTO
- **Teléfono inválido**: Formato chileno incorrecto

### 🔒 Casos de seguridad
- **Rate limiting**: Demasiadas solicitudes
- **Auditoría registrada**: Verificación de logs
- **Hash de contraseñas**: Almacenamiento seguro
- **Validación de tienda**: Acceso no autorizado prevenido

## Cómo ejecutar las pruebas

1. **Abre el archivo** `register-client-tests.http` en VS Code
2. **Ejecuta las requests** en orden secuencial haciendo clic en "Send Request" sobre cada una
3. **Verifica las respuestas** en el panel derecho
4. **Compara con los resultados esperados** documentados abajo

## Resultados esperados

### ✅ Caso 1: Registro exitoso
**Código esperado:** 201 Created
**Respuesta contiene:**
- `success: true`
- `data.user` con ID único
- `data.store` con información de la tienda
- `data.tokens` con access y refresh tokens
- `timestamp` actual

### ⚠️ Caso 2: Tienda no encontrada
**Código esperado:** 400 Bad Request
**Mensaje:** "Tienda no encontrada"
**Código de error:** "STORE_NOT_FOUND"

### ⚠️ Caso 3: Usuario ya existe
**Código esperado:** 409 Conflict
**Mensaje:** "Usuario ya existe en la organización"
**Código de error:** "USER_ALREADY_EXISTS"

### ⚠️ Caso 4: Validación de campos
**Código esperado:** 400 Bad Request
**Mensajes de error específicos** por campo inválido

### 🔒 Caso 5: Rate limiting
**Código esperado:** 429 Too Many Requests
**Mensaje:** "Demasiadas solicitudes"
**Header:** `Retry-After: 900`

## Verificación de base de datos

Después de ejecutar las pruebas exitosas, verifica en la base de datos:

```sql
-- Usuario creado
SELECT id, email, first_name, last_name, phone, email_verified, status
FROM users
WHERE email = 'cliente@test.com';

-- Rol asignado
SELECT r.name as role_name
FROM user_roles ur
JOIN roles r ON ur.role_id = r.id
WHERE ur.user_id = 'user_id_aqui';

-- Asociación con tienda
SELECT su.user_id, s.name as store_name
FROM store_users su
JOIN stores s ON su.store_id = s.id
WHERE su.user_id = 'user_id_aqui';

-- Auditoría registrada
SELECT action, entity_type, details
FROM audit_logs
WHERE entity_type = 'user'
ORDER BY created_at DESC
LIMIT 1;
```

## Troubleshooting

### Error: "Tienda no encontrada"
- Verifica que el `storeId` sea válido
- Asegúrate de que la tienda existe en la BD
- Revisa que el formato del ID sea correcto

### Error: "Usuario ya existe"
- El email ya está registrado en esa organización
- Intenta con un email diferente
- Verifica el contexto multi-tenant

### Error: Rate limiting
- Espera 15 minutos antes de reintentar
- Verifica que no estés ejecutando las pruebas en bucle
- Revisa la configuración de rate limiting

### Error: Validación de campos
- Revisa el formato del email
- Verifica la fortaleza de la contraseña
- Confirma el formato del teléfono (+569xxxxxxxx)

## Métricas de rendimiento

- **Tiempo promedio de respuesta**: < 1.2 segundos
- **Tasa de éxito esperada**: > 95%
- **Rate limiting**: 5 requests por 15 minutos
- **Auditoría**: 100% de requests registradas

## Notas de seguridad

- Todas las contraseñas son hasheadas con bcrypt
- Los tokens JWT tienen expiración de 1 hora
- La auditoría registra IP y User-Agent
- El rate limiting previene ataques de fuerza bruta
- Los mensajes de error no revelan información sensible

---

**Archivo relacionado:** `register-client-tests.http`
**Endpoint:** `POST /api/auth/register-customer`
**Versión:** 1.0</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Register Client/register-client-tests.md
