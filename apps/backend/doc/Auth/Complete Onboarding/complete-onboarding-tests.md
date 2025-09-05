# Pruebas HTTP - Complete Onboarding

Este archivo contiene pruebas exhaustivas para el endpoint `POST /auth/onboarding/complete` de Vendix.

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

## Configuración de Variables

Para ejecutar las pruebas correctamente, necesitas configurar la variable `access_token`:

1. **Ejecuta primero** la prueba de registro (Test 1)
2. **Ejecuta el login** (Test 2) y copia el `access_token` de la respuesta
3. **Actualiza la variable** en la parte superior del archivo:
   ```
   @access_token = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

## Casos de prueba incluidos

### ✅ Casos de éxito
- **Completado exitoso**: Usuario con todos los datos requeridos
- **Validación de estado**: `onboarding_completed: true` en BD

### ⚠️ Casos de validación
- **Sin autenticación**: Token faltante → 401
- **Token inválido**: JWT malformado → 401
- **Email no verificado**: Usuario sin verificación → 401
- **Usuario ya completado**: Intento de repetir → 400
- **Datos faltantes**: Organización incompleta → 400 con lista detallada

### 🔒 Casos de seguridad
- **Autenticación requerida**: Solo usuarios con JWT válido
- **Prevención de duplicados**: No permite completar múltiples veces
- **Mensajes no reveladores**: No expone información sensible

## Cómo ejecutar las pruebas

1. **Abre el archivo** `complete-onboarding-tests.http` en VS Code
2. **Configura el token** después del login (Test 2)
3. **Ejecuta las requests** en orden secuencial haciendo clic en "Send Request"
4. **Verifica las respuestas** y códigos de estado

## Preparación de datos para pruebas

Para probar el **caso de éxito** (Test 7), necesitas configurar manualmente los datos en la base de datos:

```sql
-- 1. Marcar email como verificado
UPDATE users SET email_verified = true WHERE email = 'testcomplete@example.com';

-- 2. Actualizar datos de organización
UPDATE organizations SET
  name = 'Test Organization',
  description = 'Organización de prueba',
  email = 'contact@test.com',
  phone = '+1234567890'
WHERE id = (SELECT organization_id FROM users WHERE email = 'testcomplete@example.com');

-- 3. Crear dirección de organización
INSERT INTO addresses (organization_id, address_line1, city, state_province, postal_code, country_code, is_primary, type)
VALUES (
  (SELECT organization_id FROM users WHERE email = 'testcomplete@example.com'),
  'Calle Principal 123',
  'Ciudad de México',
  'CDMX',
  '12345',
  'MX',
  true,
  'billing'
);

-- 4. Crear tienda
INSERT INTO stores (organization_id, name, store_code, slug)
VALUES (
  (SELECT organization_id FROM users WHERE email = 'testcomplete@example.com'),
  'Tienda Principal',
  'STORE001',
  'tienda-principal'
);

-- 5. Crear dirección de tienda
INSERT INTO addresses (store_id, address_line1, city, state_province, postal_code, country_code, is_primary, type)
VALUES (
  (SELECT id FROM stores WHERE slug = 'tienda-principal'),
  'Av. Comercio 456',
  'Ciudad de México',
  'CDMX',
  '12346',
  'MX',
  true,
  'shipping'
);

-- 6. Configurar dominio y colores
INSERT INTO domain_settings (organization_id, hostname, config)
VALUES (
  (SELECT organization_id FROM users WHERE email = 'testcomplete@example.com'),
  'test.vendix.com',
  '{"branding": {"primaryColor": "#FF6B35", "secondaryColor": "#F7931E"}}'
);
```

## Resultados esperados

### Test 1: Registro exitoso
```json
{
  "message": "Bienvenido a Vendix! Tu organización ha sido creada.",
  "data": {
    "user": { /* datos del usuario */ },
    "access_token": "eyJ...",
    "refresh_token": "eyJ..."
  }
}
```

### Test 3: Sin autenticación
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### Test 5: Email no verificado
```json
{
  "message": "Email no verificado",
  "error": "Unauthorized",
  "statusCode": 401
}
```

### Test 6: Datos faltantes
```json
{
  "message": "Faltan datos requeridos: nombre y descripción de organización, email y teléfono de organización, dirección de organización, al menos una tienda configurada, configuración de dominio",
  "error": "Bad Request",
  "statusCode": 400
}
```

### Test 7: Éxito completo
```json
{
  "success": true,
  "message": "Onboarding completado exitosamente",
  "data": {
    "emailVerified": true,
    "canCreateOrganization": false,
    "hasOrganization": true,
    "organizationId": 4,
    "nextStep": "complete_setup",
    "currentStep": "complete"
  }
}
```

### Test 8: Usuario ya completado
```json
{
  "message": "Faltan datos requeridos: onboarding ya completado",
  "error": "Bad Request",
  "statusCode": 400
}
```

## Verificación en base de datos

Después del test exitoso, verifica en la base de datos:

```sql
SELECT id, email, onboarding_completed, state
FROM users
WHERE email = 'testcomplete@example.com';
```

Deberías ver:
- `onboarding_completed = true`
- `state = 'pending_verification'` (el estado no cambia con el onboarding)

## Limpieza para próximos tests

Para resetear el estado y poder ejecutar las pruebas nuevamente:

```sql
UPDATE users SET onboarding_completed = false
WHERE email = 'testcomplete@example.com';
```

## Notas importantes

- **Orden de ejecución**: Las pruebas están numeradas por orden recomendado
- **Dependencias**: Algunos tests requieren que los anteriores se ejecuten primero
- **Configuración manual**: El test de éxito requiere setup manual de datos
- **Variables dinámicas**: Actualiza `access_token` después del login
- **Base de datos**: Los cambios son persistentes, usa limpieza si es necesario</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Complete Onboarding/complete-onboarding-tests.md
