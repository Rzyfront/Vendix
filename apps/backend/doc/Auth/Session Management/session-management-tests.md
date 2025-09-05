# 🧪 Tests de Gestión de Sesiones

**Archivo de pruebas HTTP para Postman/Insomnia**

---

## 📋 **Pre-requisitos**

1. **Usuario autenticado** con token JWT válido
2. **Sesiones activas** en el sistema
3. **Backend corriendo** en `http://localhost:3000`

---

## 🔐 **1. Autenticación**

### **Login para obtener token**
```http
POST http://localhost:3000/api/auth/login
Content-Type: application/json

{
  "email": "superadmin@vendix.com",
  "password": "password123",
  "organizationSlug": "vendix-corp"
}
```

**Guardar el token de la respuesta para las siguientes pruebas**

---

## 📱 **2. Listar Sesiones Activas**

### **GET - Obtener todas las sesiones**
```http
GET http://localhost:3000/api/auth/sessions
Authorization: Bearer {{auth_token}}
```

**Respuesta esperada:**
```json
{
  "message": "Sesiones obtenidas exitosamente",
  "data": [
    {
      "id": 14,
      "device": {
        "browser": "Chrome",
        "os": "Windows 10",
        "type": "Desktop"
      },
      "ipAddress": "192.168.1.100",
      "lastUsed": "2025-09-05T16:48:23.968Z",
      "createdAt": "2025-09-05T16:48:23.970Z",
      "isCurrentSession": false
    }
  ]
}
```

---

## ❌ **3. Cerrar Sesión Específica**

### **DELETE - Revocar sesión por ID**
```http
DELETE http://localhost:3000/api/auth/sessions/14
Authorization: Bearer {{auth_token}}
```

**Respuesta esperada:**
```json
{
  "message": "Sesión revocada exitosamente",
  "data": {
    "session_revoked": 14
  }
}
```

---

## 🔄 **4. Verificar Cambios**

### **GET - Confirmar que la sesión fue cerrada**
```http
GET http://localhost:3000/api/auth/sessions
Authorization: Bearer {{auth_token}}
```

**Verificar que:**
- La sesión con ID 14 ya no aparece en la lista
- El número total de sesiones disminuyó en 1

---

## 🚫 **5. Casos de Error**

### **DELETE - Intentar cerrar sesión de otro usuario**
```http
DELETE http://localhost:3000/api/auth/sessions/999
Authorization: Bearer {{auth_token}}
```

**Respuesta esperada:**
```json
{
  "message": "Sesión no encontrada o no pertenece al usuario",
  "error": "Not Found",
  "statusCode": 404
}
```

### **DELETE - Sesión ya revocada**
```http
DELETE http://localhost:3000/api/auth/sessions/14
Authorization: Bearer {{auth_token}}
```

**Respuesta esperada:**
```json
{
  "message": "Sesión no encontrada o no pertenece al usuario",
  "error": "Not Found",
  "statusCode": 404
}
```

---

## 🔄 **6. Logout Completo (Funcionalidad existente)**

### **POST - Cerrar todas las sesiones**
```http
POST http://localhost:3000/api/auth/logout
Authorization: Bearer {{auth_token}}
Content-Type: application/json

{
  "all_sessions": true
}
```

**Respuesta esperada:**
```json
{
  "message": "Sesión cerrada exitosamente",
  "data": {
    "sessions_revoked": 5
  }
}
```

---

## 📊 **7. Tests de Rendimiento**

### **Múltiples sesiones activas**
```bash
# Crear múltiples sesiones (desde diferentes navegadores/IPs)
# Verificar que todas se listen correctamente
# Probar cierre selectivo de varias sesiones
```

### **Rate Limiting**
```bash
# Hacer múltiples requests en poco tiempo
# Verificar que no se bloquee el servicio
```

---

## 🔍 **8. Tests de Seguridad**

### **Intento de acceso sin autenticación**
```http
GET http://localhost:3000/api/auth/sessions
```

**Respuesta esperada:** `401 Unauthorized`

### **Token expirado**
```http
GET http://localhost:3000/api/auth/sessions
Authorization: Bearer {{expired_token}}
```

**Respuesta esperada:** `401 Unauthorized`

---

## 📋 **Variables para Tests**

```json
{
  "auth_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expired_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "session_id": 14,
  "invalid_session_id": 999
}
```

---

## ✅ **Checklist de Tests**

### **Funcionalidad Básica**
- [ ] Login y obtención de token
- [ ] Listar sesiones activas
- [ ] Cerrar sesión específica
- [ ] Verificar cambios después del cierre

### **Casos de Error**
- [ ] Sesión no encontrada
- [ ] Sesión de otro usuario
- [ ] Sesión ya revocada
- [ ] Sin autenticación

### **Seguridad**
- [ ] Token expirado
- [ ] Token inválido
- [ ] Acceso sin autorización

### **Rendimiento**
- [ ] Múltiples sesiones
- [ ] Rate limiting
- [ ] Respuestas rápidas

---

## 🐛 **Reportar Issues**

Si encuentras algún problema durante las pruebas:

1. **Documentar** el request completo
2. **Incluir** la respuesta obtenida
3. **Especificar** el comportamiento esperado
4. **Adjuntar** logs del servidor si es posible

**Formato de reporte:**
```
Issue: [Descripción breve]
Request: [Método + URL + Headers + Body]
Response: [Status Code + Body]
Expected: [Comportamiento esperado]
Actual: [Comportamiento obtenido]
```</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Auth/Session Management/session-management-tests.md
