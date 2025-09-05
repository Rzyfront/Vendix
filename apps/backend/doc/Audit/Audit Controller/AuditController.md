# Audit Controller - API de Consultas de Auditoría

## 📋 Descripción General

El `AuditController` proporciona endpoints REST para consultar y gestionar los logs de auditoría del sistema Vendix. Permite a los administradores y usuarios autorizados acceder al historial de actividades.

## 🏗️ Arquitectura

### Ubicación
```
src/modules/audit/audit.controller.ts
```

### Dependencias
- **AuditService**: Servicio principal para consultas de auditoría
- **Auth Guards**: Para control de acceso a los endpoints
- **DTOs**: Para validación de parámetros de consulta

### Endpoints Disponibles

## 🚀 Endpoints de la API

### 1. `GET /audit/logs` - Obtener Logs de Auditoría

Obtiene una lista paginada de logs de auditoría con filtros opcionales.

**Parámetros de Query:**
```typescript
{
  userId?: number;        // Filtrar por ID de usuario
  action?: string;        // Filtrar por tipo de acción
  resource?: string;      // Filtrar por tipo de recurso
  resourceId?: number;    // Filtrar por ID de recurso específico
  fromDate?: string;      // Fecha desde (ISO 8601)
  toDate?: string;        // Fecha hasta (ISO 8601)
  page?: number;          // Página (default: 1)
  limit?: number;         // Límite por página (default: 50, max: 100)
}
```

**Ejemplos de Uso:**

```bash
# Obtener todos los logs de un usuario
GET /audit/logs?userId=123

# Obtener logs de creación de productos
GET /audit/logs?action=CREATE&resource=products

# Obtener logs de un período específico
GET /audit/logs?fromDate=2025-01-01&toDate=2025-01-31

# Obtener logs con paginación
GET /audit/logs?page=2&limit=25

# Combinar múltiples filtros
GET /audit/logs?userId=123&action=UPDATE&resource=products&fromDate=2025-01-01
```

**Respuesta Exitosa (200):**
```json
{
  "data": [
    {
      "id": 1,
      "user_id": 123,
      "action": "CREATE",
      "resource": "products",
      "resource_id": 456,
      "old_values": null,
      "new_values": {
        "name": "Producto Nuevo",
        "sku": "PROD-001",
        "base_price": 29.99
      },
      "metadata": {
        "store_id": 789
      },
      "ip_address": "192.168.1.100",
      "user_agent": "Mozilla/5.0...",
      "created_at": "2025-01-15T10:30:00Z",
      "users": {
        "id": 123,
        "first_name": "Juan",
        "last_name": "Pérez",
        "email": "juan@example.com"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "totalPages": 3
  }
}
```

### 2. `GET /audit/stats` - Obtener Estadísticas de Auditoría

Obtiene estadísticas agregadas de los logs de auditoría por período.

**Parámetros de Query:**
```typescript
{
  fromDate?: string;  // Fecha desde (ISO 8601)
  toDate?: string;    // Fecha hasta (ISO 8601)
}
```

**Ejemplo de Uso:**
```bash
# Estadísticas del mes actual
GET /audit/stats?fromDate=2025-01-01&toDate=2025-01-31

# Estadísticas de hoy
GET /audit/stats?fromDate=2025-01-15&toDate=2025-01-15
```

**Respuesta Exitosa (200):**
```json
{
  "totalLogs": 1250,
  "logsByAction": [
    { "action": "CREATE", "_count": { "id": 450 } },
    { "action": "UPDATE", "_count": { "id": 380 } },
    { "action": "DELETE", "_count": { "id": 120 } },
    { "action": "LOGIN", "_count": { "id": 300 } }
  ],
  "logsByResource": [
    { "resource": "products", "_count": { "id": 400 } },
    { "resource": "users", "_count": { "id": 350 } },
    { "resource": "orders", "_count": { "id": 300 } },
    { "resource": "stores", "_count": { "id": 200 } }
  ],
  "period": {
    "from": "2025-01-01T00:00:00Z",
    "to": "2025-01-31T23:59:59Z"
  }
}
```

## 🔐 Control de Acceso

### Guards y Decoradores
```typescript
## 🔐 Control de Acceso

### Guards y Decoradores
```typescript
@Controller('audit')
export class AuditController {
  @Get('logs')
  @UseGuards(JwtAuthGuard, OrganizationAuditGuard) // ✅ Guards aplicados
  async getAuditLogs(@Query() query: AuditLogQueryDto) {
    // ...
  }
}
```

### Niveles de Acceso Multi-Tenant
1. **Super Admin**: Acceso completo a todos los logs del sistema
2. **Admin de Organización**: Acceso solo a logs de su organización
3. **Usuario Regular**: Solo puede ver sus propios logs
4. **Sistema**: Sin acceso directo a consultas

### Filtrado Automático por Organización
```typescript
// El OrganizationAuditGuard automáticamente:
// 1. Verifica si el usuario es super admin
// 2. Si no es super admin, agrega organizationId del usuario a la consulta
// 3. Filtra los resultados por organización
```
```

### Niveles de Acceso
1. **Administradores**: Acceso completo a todos los logs
2. **Auditores**: Acceso de solo lectura a logs
3. **Usuarios Regulares**: Solo pueden ver sus propios logs
4. **Público**: Sin acceso

## 📊 Consultas Avanzadas

### Filtrado por Usuario
```bash
# Logs de un usuario específico
GET /audit/logs?userId=123

# Logs de múltiples usuarios (si se implementa)
GET /audit/logs?userIds=123,456,789
```

### Filtrado por Acción
```bash
# Solo logs de creación
GET /audit/logs?action=CREATE

# Múltiples acciones
GET /audit/logs?action=CREATE,UPDATE
```

### Filtrado por Recurso
```bash
# Logs de productos
GET /audit/logs?resource=products

# Logs de un producto específico
GET /audit/logs?resource=products&resourceId=456
```

### Filtrado por Fecha
```bash
# Logs de hoy
GET /audit/logs?fromDate=2025-01-15&toDate=2025-01-15

# Logs de la última semana
GET /audit/logs?fromDate=2025-01-08&toDate=2025-01-15

# Logs de un rango amplio
GET /audit/logs?fromDate=2025-01-01&toDate=2025-12-31
```

### Combinación de Filtros
```bash
# Usuario específico + acción específica + período
GET /audit/logs?userId=123&action=UPDATE&resource=products&fromDate=2025-01-01&toDate=2025-01-31
```

## 📈 Paginación

### Parámetros de Paginación
```typescript
{
  page: number;   // Página actual (default: 1)
  limit: number;  // Registros por página (default: 50, max: 100)
}
```

### Respuesta con Paginación
```json
{
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 25,
    "total": 150,
    "totalPages": 6,
    "hasNext": true,
    "hasPrev": true
  }
}
```

### Navegación
```bash
# Primera página
GET /audit/logs?page=1&limit=25

# Página específica
GET /audit/logs?page=3&limit=25

# Última página
GET /audit/logs?page=6&limit=25
```

## 🚨 Manejo de Errores

### Códigos de Error Comunes

**400 Bad Request:**
```json
{
  "statusCode": 400,
  "message": "Invalid date format",
  "error": "Bad Request"
}
```

**401 Unauthorized:**
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

**403 Forbidden:**
```json
{
  "statusCode": 403,
  "message": "Insufficient permissions",
  "error": "Forbidden"
}
```

**404 Not Found:**
```json
{
  "statusCode": 404,
  "message": "Audit logs not found",
  "error": "Not Found"
}
```

**500 Internal Server Error:**
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

## 🧪 Pruebas

### Archivo de Pruebas HTTP
```http
### Obtener logs de auditoría
GET http://localhost:3000/audit/logs
Authorization: Bearer YOUR_JWT_TOKEN

### Obtener logs con filtros
GET http://localhost:3000/audit/logs?userId=123&action=CREATE
Authorization: Bearer YOUR_JWT_TOKEN

### Obtener estadísticas
GET http://localhost:3000/audit/stats?fromDate=2025-01-01&toDate=2025-01-31
Authorization: Bearer YOUR_JWT_TOKEN
```

### Casos de Prueba
1. **Consulta básica**: Obtener logs sin filtros
2. **Filtros simples**: Usuario, acción, recurso
3. **Filtros combinados**: Múltiples parámetros
4. **Paginación**: Navegación entre páginas
5. **Fechas**: Rangos de fecha válidos e inválidos
6. **Permisos**: Acceso autorizado y no autorizado
7. **Límites**: Validación de límites de paginación

## 📊 Rendimiento

### Optimizaciones
- **Índices de BD**: Campos filtrados están indexados
- **Paginación eficiente**: Usa LIMIT y OFFSET optimizados
- **Caché**: Resultados frecuentes pueden cachearse
- **Compresión**: Respuestas grandes se comprimen

### Límites Recomendados
- **Límite por página**: Máximo 100 registros
- **Período máximo**: Máximo 1 año por consulta
- **Timeout**: 30 segundos máximo por consulta

## 🔄 Integración con Frontend

### Ejemplo de Consulta en React
```typescript
const fetchAuditLogs = async (filters: AuditFilters) => {
  const queryParams = new URLSearchParams();

  if (filters.userId) queryParams.append('userId', filters.userId.toString());
  if (filters.action) queryParams.append('action', filters.action);
  if (filters.resource) queryParams.append('resource', filters.resource);
  if (filters.fromDate) queryParams.append('fromDate', filters.fromDate);
  if (filters.toDate) queryParams.append('toDate', filters.toDate);
  if (filters.page) queryParams.append('page', filters.page.toString());
  if (filters.limit) queryParams.append('limit', filters.limit.toString());

  const response = await fetch(`/api/audit/logs?${queryParams}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return response.json();
};
```

### Ejemplo de Dashboard
```typescript
const AuditDashboard = () => {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetchAuditLogs({}).then(setLogs);
    fetchAuditStats().then(setStats);
  }, []);

  return (
    <div>
      <h1>Audit Dashboard</h1>
      <StatsCards stats={stats} />
      <AuditLogTable logs={logs} />
    </div>
  );
};
```

Esta API proporciona una interfaz completa para consultar y analizar los logs de auditoría del sistema Vendix, permitiendo a los administradores mantener un control detallado de todas las actividades del sistema.</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Audit/Audit Controller/AuditController.md
