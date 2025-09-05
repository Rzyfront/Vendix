# Pruebas HTTP - Register Owner

Este archivo contiene pruebas exhaustivas para el endpoint `POST /auth/register-owner` de Vendix.

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
- **Registro exitoso**: Nuevo owner con todos los campos
- **Sin teléfono**: Campo opcional omitido
- **Caracteres especiales**: Nombres con acentos y apóstrofes
- **Email con subdominio**: Emails complejos
- **Username único**: Manejo automático de colisiones

### ⚠️ Casos de validación
- **Usuario existente con onboarding pendiente**: Retorna 409 con instrucciones
- **Email ya existe en organización**: Conflicto de email
- **Contraseña débil**: Validación de fortaleza
- **Email inválido**: Formato incorrecto
- **Campos requeridos faltantes**: Validación de DTO
- **Organización sin nombre**: Campo requerido faltante

### 🔒 Casos de seguridad
- **Enumeración prevention**: Mensajes genéricos que no revelan existencia de emails
- **Hash de refresh tokens**: Almacenamiento seguro
- **Username uniqueness**: Evita colisiones automáticamente

## Cómo ejecutar las pruebas

1. **Abre el archivo** `register-owner-tests.http` en VS Code
2. **Ejecuta las requests** en orden secuencial haciendo clic en "Send Request" sobre cada una
3. **Revisa las respuestas** en el panel derecho
4. **Verifica códigos de estado**:
   - `201`: Registro exitoso
   - `409`: Conflicto (usuario existente)
   - `400`: Validación fallida
   - `422`: Datos inválidos

## Respuestas esperadas

### Registro exitoso (201)
```json
{
  "message": "Bienvenido a Vendix! Tu organización ha sido creada.",
  "data": {
    "user": { ... },
    "access_token": "...",
    "refresh_token": "..."
  }
}
```

### Usuario existente con onboarding pendiente (409)
```json
{
  "message": "Ya tienes un registro pendiente. Completa tu onboarding.",
  "nextStep": "complete_onboarding",
  "organizationId": 1,
  "data": { ... }
}
```

### Validación fallida (400/422)
```json
{
  "message": "La contraseña debe tener al menos 8 caracteres",
  "error": "Bad Request",
  "statusCode": 400
}
```

## Notas importantes

- **Multi-tenant**: Los emails pueden existir en diferentes organizaciones
- **Onboarding detection**: Detecta usuarios con `onboarding_completed: false`
- **Username generation**: Automática desde email con manejo de colisiones
- **Security**: No revela existencia de emails en respuestas de error
- **Transactions**: Toda la creación (org + user + roles) es atómica

## Troubleshooting

- **Error de conexión**: Verifica que el backend esté corriendo en el puerto correcto
- **Errores de base de datos**: Asegúrate de que las migraciones estén aplicadas
- **Errores de validación**: Revisa que los datos cumplan con las reglas del DTO
- **409 inesperado**: Puede haber un usuario con onboarding pendiente
