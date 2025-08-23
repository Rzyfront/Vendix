# Vendix Backend - API Routes Reference

## 🔗 Endpoints Disponibles

### Base URL
```
Development: http://localhost:3000/api
Production: https://api.vendix.com/api
```

---

## 🔐 Authentication & Authorization

### Public Auth Endpoints
```http
# Registro de usuario
POST /auth/register
Content-Type: application/json
{
  "email": "usuario@ejemplo.com",
  "password": "contraseña123",
  "firstName": "Juan",
  "lastName": "Pérez"
}

# Login
POST /auth/login
Content-Type: application/json
{
  "email": "usuario@ejemplo.com",
  "password": "contraseña123"
}

# Refresh Token
POST /auth/refresh
Content-Type: application/json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}

# Verificar Email
POST /auth/verify-email
Content-Type: application/json
{
  "token": "verification-token-here"
}

# Solicitar Reset de Contraseña
POST /auth/forgot-password
Content-Type: application/json
{
  "email": "usuario@ejemplo.com"
}

# Reset Contraseña
POST /auth/reset-password
Content-Type: application/json
{
  "token": "reset-token-here",
  "newPassword": "nuevaContraseña123"
}
```

### Protected Auth Endpoints
```http
# Logout (requiere JWT)
POST /auth/logout
Authorization: Bearer <jwt-token>

# Obtener perfil actual
GET /auth/profile
Authorization: Bearer <jwt-token>

# Actualizar perfil
PUT /auth/profile
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "firstName": "Juan Carlos",
  "lastName": "Pérez García"
}

# Cambiar contraseña
POST /auth/change-password
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "currentPassword": "contraseñaActual",
  "newPassword": "nuevaContraseña123"
}
```

---

## 🌐 Public Domain Resolution

### Domain Configuration (No Authentication Required)
```http
# Resolver configuración de dominio
GET /public/domains/resolve/:hostname
GET /public/domains/resolve/tienda.ejemplo.com
GET /public/domains/resolve/localhost:4200?subdomain=luda

# Ejemplo de respuesta:
{
  "success": true,
  "data": {
    "hostname": "tienda.ejemplo.com",
    "organizationId": 1,
    "storeId": 1,
    "config": {
      "branding": {
        "companyName": "Mi Empresa",
        "storeName": "Mi Tienda",
        "primaryColor": "#007bff"
      },
      "theme": {
        "layout": "sidebar",
        "colorScheme": "light"
      }
    }
  }
}
```

---

## 🏢 Organizations Management

### Organization Endpoints (Protected)
```http
# Listar organizaciones
GET /organizations
Authorization: Bearer <jwt-token>
Query Parameters: ?page=1&limit=10&search=empresa

# Crear organización
POST /organizations
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "name": "Mi Empresa",
  "slug": "mi-empresa",
  "legalName": "Mi Empresa S.A.",
  "taxId": "12345678901",
  "email": "contacto@miempresa.com",
  "phone": "+1234567890",
  "website": "https://miempresa.com"
}

# Obtener organización por ID
GET /organizations/:id
Authorization: Bearer <jwt-token>

# Actualizar organización
PUT /organizations/:id
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "name": "Mi Empresa Actualizada",
  "phone": "+0987654321"
}

# Eliminar organización
DELETE /organizations/:id
Authorization: Bearer <jwt-token>

# Obtener usuarios de organización
GET /organizations/:id/users
Authorization: Bearer <jwt-token>

# Agregar usuario a organización
POST /organizations/:id/users
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "userId": 123,
  "roleId": 2
}
```

---

## 🏪 Stores Management

### Store Endpoints (Protected)
```http
# Listar tiendas
GET /stores
Authorization: Bearer <jwt-token>
Query Parameters: ?organizationId=1&page=1&limit=10

# Crear tienda
POST /stores
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "name": "Mi Tienda Online",
  "slug": "mi-tienda-online",
  "organizationId": 1,
  "description": "La mejor tienda online",
  "email": "tienda@miempresa.com",
  "phone": "+1234567890"
}

# Obtener tienda por ID
GET /stores/:id
Authorization: Bearer <jwt-token>

# Actualizar tienda
PUT /stores/:id
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "name": "Mi Tienda Actualizada",
  "description": "Descripción actualizada"
}

# Eliminar tienda
DELETE /stores/:id
Authorization: Bearer <jwt-token>

# Obtener staff de tienda
GET /stores/:id/staff
Authorization: Bearer <jwt-token>

# Agregar staff a tienda
POST /stores/:id/staff
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "userId": 123,
  "roleId": 3
}
```

---

## 🌍 Domain Settings Management

### Domain Configuration Endpoints (Protected)
```http
# Crear configuración de dominio
POST /domain-settings
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "hostname": "tienda.ejemplo.com",
  "organizationId": 1,
  "storeId": 1,
  "config": {
    "branding": {
      "companyName": "Mi Empresa",
      "storeName": "Mi Tienda",
      "logoUrl": "https://ejemplo.com/logo.png",
      "primaryColor": "#007bff"
    },
    "features": {
      "inventory": true,
      "orders": true,
      "customers": true
    }
  }
}

# Listar configuraciones de dominio
GET /domain-settings
Authorization: Bearer <jwt-token>
Query Parameters: ?organizationId=1&storeId=1&search=ejemplo&limit=10&offset=0

# Obtener configuración por hostname
GET /domain-settings/hostname/:hostname
Authorization: Bearer <jwt-token>
GET /domain-settings/hostname/tienda.ejemplo.com

# Obtener configuración por ID
GET /domain-settings/:id
Authorization: Bearer <jwt-token>

# Actualizar configuración
PUT /domain-settings/hostname/:hostname
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "config": {
    "branding": {
      "primaryColor": "#28a745"
    }
  }
}

# Eliminar configuración
DELETE /domain-settings/hostname/:hostname
Authorization: Bearer <jwt-token>

# Duplicar configuración
POST /domain-settings/hostname/:hostname/duplicate
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "newHostname": "nueva-tienda.ejemplo.com"
}

# Obtener configuraciones por organización
GET /domain-settings/organization/:organizationId
Authorization: Bearer <jwt-token>

# Obtener configuraciones por tienda
GET /domain-settings/store/:storeId
Authorization: Bearer <jwt-token>

# Validar hostname
POST /domain-settings/validate-hostname
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "hostname": "nueva-tienda.ejemplo.com"
}
```

---

## 👥 Users Management

### User Endpoints (Protected)
```http
# Listar usuarios
GET /users
Authorization: Bearer <jwt-token>
Query Parameters: ?page=1&limit=10&search=juan&role=admin

# Crear usuario
POST /users
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "email": "nuevo@usuario.com",
  "firstName": "Nuevo",
  "lastName": "Usuario",
  "password": "contraseña123"
}

# Obtener usuario por ID
GET /users/:id
Authorization: Bearer <jwt-token>

# Actualizar usuario
PUT /users/:id
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "firstName": "Nombre Actualizado",
  "lastName": "Apellido Actualizado"
}

# Eliminar usuario
DELETE /users/:id
Authorization: Bearer <jwt-token>

# Obtener roles de usuario
GET /users/:id/roles
Authorization: Bearer <jwt-token>

# Asignar rol a usuario
POST /users/:id/roles
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "roleId": 2,
  "organizationId": 1
}
```

---

## 🛒 Products Management

### Product Endpoints (Protected)
```http
# Listar productos
GET /products
Authorization: Bearer <jwt-token>
Query Parameters: ?storeId=1&categoryId=1&page=1&limit=10&search=producto

# Crear producto
POST /products
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "name": "Producto Ejemplo",
  "slug": "producto-ejemplo",
  "description": "Descripción del producto",
  "price": 29.99,
  "sku": "PROD-001",
  "storeId": 1,
  "categoryId": 1,
  "brandId": 1
}

# Obtener producto por ID
GET /products/:id
Authorization: Bearer <jwt-token>

# Actualizar producto
PUT /products/:id
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "name": "Producto Actualizado",
  "price": 39.99
}

# Eliminar producto
DELETE /products/:id
Authorization: Bearer <jwt-token>

# Obtener variantes de producto
GET /products/:id/variants
Authorization: Bearer <jwt-token>

# Crear variante de producto
POST /products/:id/variants
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "name": "Variante Ejemplo",
  "sku": "PROD-001-VAR",
  "price": 34.99,
  "stock": 100
}
```

---

## 📦 Orders Management

### Order Endpoints (Protected)
```http
# Listar órdenes
GET /orders
Authorization: Bearer <jwt-token>
Query Parameters: ?storeId=1&customerId=1&status=pending&page=1&limit=10

# Crear orden
POST /orders
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "customerId": 1,
  "storeId": 1,
  "items": [
    {
      "productId": 1,
      "variantId": 1,
      "quantity": 2,
      "price": 29.99
    }
  ],
  "shippingAddress": {
    "street": "Calle Ejemplo 123",
    "city": "Ciudad",
    "zipCode": "12345",
    "country": "España"
  }
}

# Obtener orden por ID
GET /orders/:id
Authorization: Bearer <jwt-token>

# Actualizar orden
PUT /orders/:id
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "status": "shipped",
  "trackingNumber": "TRACK123456"
}

# Cancelar orden
POST /orders/:id/cancel
Authorization: Bearer <jwt-token>

# Obtener items de orden
GET /orders/:id/items
Authorization: Bearer <jwt-token>
```

---

## 👤 Customers Management

### Customer Endpoints (Protected)
```http
# Listar clientes
GET /customers
Authorization: Bearer <jwt-token>
Query Parameters: ?storeId=1&page=1&limit=10&search=juan

# Crear cliente
POST /customers
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "email": "cliente@ejemplo.com",
  "firstName": "Juan",
  "lastName": "Cliente",
  "phone": "+1234567890",
  "storeId": 1
}

# Obtener cliente por ID
GET /customers/:id
Authorization: Bearer <jwt-token>

# Actualizar cliente
PUT /customers/:id
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "firstName": "Juan Carlos",
  "phone": "+0987654321"
}

# Eliminar cliente
DELETE /customers/:id
Authorization: Bearer <jwt-token>

# Obtener órdenes de cliente
GET /customers/:id/orders
Authorization: Bearer <jwt-token>
```

---

## 💳 Payments Management

### Payment Endpoints (Protected)
```http
# Listar pagos
GET /payments
Authorization: Bearer <jwt-token>
Query Parameters: ?orderId=1&status=completed&page=1&limit=10

# Crear pago
POST /payments
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "orderId": 1,
  "amount": 59.98,
  "method": "credit_card",
  "paymentMethodId": 1
}

# Obtener pago por ID
GET /payments/:id
Authorization: Bearer <jwt-token>

# Actualizar estado de pago
PUT /payments/:id
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "status": "completed",
  "transactionId": "TXN123456"
}

# Reembolsar pago
POST /payments/:id/refund
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "amount": 29.99,
  "reason": "Producto defectuoso"
}
```

---

## 📊 Inventory Management

### Inventory Endpoints (Protected)
```http
# Obtener inventario
GET /inventory
Authorization: Bearer <jwt-token>
Query Parameters: ?storeId=1&productId=1&lowStock=true

# Actualizar stock
PUT /inventory/:id
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "quantity": 150,
  "reason": "Restock"
}

# Obtener transacciones de inventario
GET /inventory/transactions
Authorization: Bearer <jwt-token>
Query Parameters: ?productId=1&type=sale&page=1&limit=10

# Crear transacción de inventario
POST /inventory/transactions
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "productId": 1,
  "variantId": 1,
  "type": "adjustment",
  "quantity": 10,
  "reason": "Inventory adjustment"
}
```

---

## 🔍 Search & Filters

### Common Query Parameters
```http
# Paginación
?page=1&limit=10

# Búsqueda
?search=término

# Filtros por fecha
?startDate=2025-01-01&endDate=2025-12-31

# Ordenamiento
?sortBy=name&sortOrder=asc

# Filtros específicos
?status=active&category=electronics
```

---

## 📧 Email System

### Email Endpoints (Protected)
```http
# Enviar email de prueba
POST /email/test
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "to": "test@ejemplo.com",
  "subject": "Email de Prueba",
  "text": "Contenido del email"
}

# Obtener plantillas de email
GET /email/templates
Authorization: Bearer <jwt-token>

# Crear plantilla de email
POST /email/templates
Authorization: Bearer <jwt-token>
Content-Type: application/json
{
  "name": "welcome",
  "subject": "Bienvenido a {{companyName}}",
  "html": "<h1>Bienvenido {{firstName}}!</h1>"
}
```

---

## 🔧 System & Health

### System Endpoints
```http
# Health Check
GET /health
# Response: { "status": "ok", "timestamp": "2025-07-04T12:00:00Z" }

# App Version
GET /version
# Response: { "version": "1.0.0", "environment": "development" }

# Database Status
GET /health/database
Authorization: Bearer <jwt-token>
# Response: { "status": "connected", "migrations": "up-to-date" }
```

---

## 🚫 Error Responses

### Standard Error Format
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "timestamp": "2025-07-04T12:00:00Z",
  "path": "/api/organizations",
  "details": [
    {
      "field": "email",
      "message": "Email must be a valid email address"
    }
  ]
}
```

### Common HTTP Status Codes
- `200` - OK
- `201` - Created
- `204` - No Content
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `422` - Unprocessable Entity
- `429` - Too Many Requests
- `500` - Internal Server Error

---

## 🔐 Permission Levels

### Role-Based Access Control
- **super_admin**: Acceso completo a todo el sistema
- **organization_admin**: Gestión de su organización y tiendas
- **store_admin**: Gestión de su tienda específica
- **store_staff**: Operaciones básicas en su tienda
- **customer**: Acceso limitado a sus datos

### Permission Matrix
| Endpoint | super_admin | org_admin | store_admin | store_staff | customer |
|----------|-------------|-----------|-------------|-------------|----------|
| POST /organizations | ✅ | ❌ | ❌ | ❌ | ❌ |
| GET /organizations | ✅ | ✅ | ❌ | ❌ | ❌ |
| POST /stores | ✅ | ✅ | ❌ | ❌ | ❌ |
| GET /stores | ✅ | ✅ | ✅ | ✅ | ❌ |
| POST /products | ✅ | ✅ | ✅ | ❌ | ❌ |
| GET /products | ✅ | ✅ | ✅ | ✅ | ✅ |
| POST /orders | ✅ | ✅ | ✅ | ✅ | ✅ |
| GET /orders | ✅ | ✅ | ✅ | ✅ | ✅* |

*Customers only see their own orders

---

## 📋 Testing Examples

### Using cURL
```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@vendix.com", "password": "password123"}'

# Get domain configuration
curl -X GET http://localhost:3000/api/public/domains/resolve/tienda.ejemplo.com

# Create domain setting
curl -X POST http://localhost:3000/api/domain-settings \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hostname": "nueva-tienda.com", "organizationId": 1, "config": {"branding": {"companyName": "Nueva Tienda"}}}'
```

### Using JavaScript/Fetch
```javascript
// Login
const login = async () => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'admin@vendix.com',
      password: 'password123'
    })
  });
  const data = await response.json();
  return data.accessToken;
};

// Get domain config
const getDomainConfig = async (hostname) => {
  const response = await fetch(`/api/public/domains/resolve/${hostname}`);
  return await response.json();
};
```

---

## 📞 Support

Para soporte técnico sobre las APIs:
- **Documentación completa**: [docs.vendix.com](https://docs.vendix.com)
- **Postman Collection**: [Download](https://postman.com/vendix/collection)
- **OpenAPI Spec**: [swagger.json](https://api.vendix.com/api/swagger.json)
- **Support Email**: api-support@vendix.com
