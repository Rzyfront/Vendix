# Servicio Domains - Vendix

## 📋 Descripción General

El servicio `domains` es el **motor de resolución multi-tenant** que permite mapear dominios a organizaciones y tiendas específicas. Este servicio es crítico porque maneja la resolución de dominios públicos, la gestión completa del ciclo de vida de configuraciones de dominio, y la verificación DNS para dominios personalizados.

## 🎯 Función Principal

### ¿Qué hace el servicio?
- **Resolución de dominios**: Mapea hostnames a configuraciones de organización/tienda (público)
- **CRUD de dominios**: Gestión completa de configuraciones de dominio (privado)
- **Verificación DNS**: Valida configuración DNS para dominios personalizados
- **Gestión de caché**: Optimización de rendimiento con caché inteligente
- **Validación de hostnames**: Asegura integridad de nombres de dominio

## 🏗️ Arquitectura de Resolución de Dominios

### Diseño del Sistema
- **Resolución en cascada**: Busca dominio exacto → organización → tienda
- **Caché inteligente**: TTL de 60 segundos con invalidación automática
- **Soporte multi-tenant**: Un hostname = una organización/tienda específica
- **Validación estricta**: Solo dominios verificados pueden ser activos

### Estructura de Resolución
```
Hostname Entrante
     ↓
Validación Básica (formato, longitud)
     ↓
Búsqueda en Caché
     ↓
Consulta Base de Datos
     ↓
Resolución Jerárquica:
├── Dominio Exacto Encontrado
│   ├── Tipo: organization_root/store_custom
│   └── Retorna: orgId, store_id?, config
├── Subdominio .vendix.com
│   ├── tienda.vendix.com → store_subdomain
│   └── org.vendix.com → organization_subdomain
└── No Encontrado → 404
```

## 🔄 Flujo de Resolución Completo

### 1. Entrada y Normalización
```typescript
// Normalizar hostname
let resolvedHostname = hostname.toLowerCase().trim();

// Soporte localhost con subdominios
if (resolvedHostname.includes('localhost') && subdomain) {
  resolvedHostname = `${subdomain}.${resolvedHostname}`;
}

// Headers forwarded (útil para proxies)
if (forwardedHost) {
  resolvedHostname = forwardedHost.toLowerCase().trim();
}
```

### 2. Verificación de Caché
```typescript
const cached = this.getFromCache(resolvedHostname);
if (cached) {
  return cached; // Hit de caché
}
```

### 3. Consulta de Base de Datos
```typescript
const domainConfig = await this.prisma.domain_settings.findUnique({
  where: { hostname: resolvedHostname },
  include: { organization: true, store: true }
});
```

### 4. Construcción de Respuesta
```typescript
const response: DomainResolutionResponse = {
  id: domainConfig.id,
  hostname: domainConfig.hostname,
  organization_id: domainConfig.organization_id!,
  store_id: domainConfig.store_id || undefined,
  config: domainConfig.config,
  // ... metadatos adicionales
};
```

## 📝 Tipos de Dominio Soportados

### Dominios Vendix Core
- **Patrón**: `*.vendix.com`
- **Ejemplos**: `app.vendix.com`, `admin.vendix.com`
- **Inferencia**: `vendix_core`
- **Estado**: Siempre `active`

### Subdominios de Organización
- **Patrón**: `org.vendix.com`
- **Ejemplo**: `miempresa.vendix.com`
- **Inferencia**: `organization_subdomain`
- **Estado**: `active`

### Subdominios de Tienda
- **Patrón**: `tienda.org.vendix.com`
- **Ejemplo**: `ventas.miempresa.vendix.com`
- **Inferencia**: `store_subdomain`
- **Estado**: `active`

### Dominios Personalizados de Organización
- **Patrón**: `midominio.com`
- **Ejemplo**: `tienda-propia.com`
- **Inferencia**: `organization_root`
- **Estado**: `pending_dns` → `pending_ssl` → `active`

### Dominios Personalizados de Tienda
- **Patrón**: `sub.midominio.com`
- **Ejemplo**: `ventas.tienda-propia.com`
- **Inferencia**: `store_custom`
- **Estado**: `pending_dns` → `pending_ssl` → `active`

## 🔐 Gestión de Estados y Ciclo de Vida

### Estados del Dominio
```typescript
enum DomainStatus {
  PENDING_DNS = 'pending_dns',    // Esperando configuración DNS
  PENDING_SSL = 'pending_ssl',    // DNS verificado, esperando SSL
  ACTIVE = 'active',              // Completamente funcional
  DISABLED = 'disabled',          // Deshabilitado manualmente
  FAILED_DNS = 'failed_dns'       // Verificación DNS fallida
}
```

### Estados SSL
```typescript
enum SSLStatus {
  NONE = 'none',          // Sin certificado
  PENDING = 'pending',    // Solicitud en proceso
  ISSUED = 'issued',      // Certificado emitido
  ERROR = 'error',        // Error en emisión
  REVOKED = 'revoked'     // Certificado revocado
}
```

### Transiciones de Estado
```
CREATED (pending_dns)
    ↓ TXT/CNAME/A verificados
PENDING_SSL
    ↓ SSL emitido
ACTIVE ✅
```

## 🔍 Verificación DNS Automática

### Checks Disponibles
- **TXT**: Verificación de token de propiedad
- **CNAME**: Apuntamiento a `edge.vendix.com`
- **A**: Registros IPv4 hacia IPs específicas
- **AAAA**: Registros IPv6 (opcional)

### Proceso de Verificación
```typescript
// Verificar registros DNS
const results = await Promise.all([
  dns.resolveTxt(hostname),    // TXT records
  dns.resolveCname(hostname),  // CNAME records
  dns.resolve4(hostname),      // A records
]);

// Evaluar resultados
const allPassed = results.every(check => check.passed);

// Actualizar estado
if (allPassed) {
  statusAfter = 'pending_ssl';
  nextAction = 'issue_certificate';
} else {
  statusAfter = 'failed_dns';
}
```

## 📊 Gestión de Caché Inteligente

### Estrategia de Caché
- **TTL**: 60 segundos por defecto
- **Invalidación**: Automática en cambios (EventEmitter)
- **Alcance**: Por hostname específico
- **Persistencia**: En memoria (reinicia con servicio)

### Eventos de Invalidación
```typescript
// Invalidación automática
this.eventEmitter.emit('domain.cache.invalidate', { hostname });

// Listener en el servicio
this.eventEmitter.on('domain.cache.invalidate', (payload) => {
  if (payload?.hostname) {
    this.cache.delete(payload.hostname);
  }
});
```

## 🔄 Endpoints y Funcionalidades

### Endpoints Públicos (sin autenticación)
- `GET /domains/resolve/:hostname` - Resuelve configuración de dominio
- `GET /domains/check/:hostname` - Verifica disponibilidad de hostname

### Endpoints Privados (requiere autenticación)
- `POST /domains` - Crear configuración de dominio
- `GET /domains` - Listar dominios con filtros
- `GET /domains/hostname/:hostname` - Obtener por hostname
- `GET /domains/:id` - Obtener por ID
- `PUT /domains/hostname/:hostname` - Actualizar dominio
- `DELETE /domains/hostname/:hostname` - Eliminar dominio
- `POST /domains/hostname/:hostname/duplicate` - Duplicar dominio
- `GET /domains/organization/:orgId` - Dominios por organización
- `GET /domains/store/:store_id` - Dominios por tienda
- `POST /domains/validate-hostname` - Validar formato hostname
- `POST /domains/hostname/:hostname/verify` - Verificar DNS

## 📈 Métricas y Monitoreo

### KPIs a Medir
- **Tasa de resolución**: Éxito en resolución de dominios
- **Hit rate de caché**: Porcentaje de resoluciones desde caché
- **Tiempo de resolución**: Latencia promedio
- **Errores de verificación**: Fallos en checks DNS
- **Dominios activos**: Número de dominios en estado `active`

### Alertas Recomendadas
- 🔴 Resoluciones fallidas > 5% (problema de configuración)
- 🟡 Caché hit rate < 80% (rendimiento degradado)
- 🟡 Verificaciones fallidas > 20% (problemas DNS)
- 🔴 Sin dominios activos en 1h (servicio caído)

## 🚨 Manejo de Errores y Edge Cases

### Errores Comunes
- **Hostname no encontrado**: Dominio no configurado
- **Formato inválido**: Hostname mal formado
- **Conflicto de primario**: Múltiples primarios en mismo scope
- **Verificación fallida**: Registros DNS incorrectos
- **Cache corrupto**: Datos obsoletos en caché

### Recuperación de Errores
- **Reintento automático**: Para errores temporales de DNS
- **Invalidación manual**: `clearCache()`, `clearOne(hostname)`
- **Fallback**: Resolución sin caché si falla
- **Logging detallado**: Trazabilidad completa de errores

### Casos Edge
- **Subdominios localhost**: Soporte desarrollo local
- **Headers forwarded**: Compatibilidad con proxies
- **Dominios Unicode**: Normalización automática
- **Timeouts DNS**: Límites de tiempo en verificaciones

## 🔗 Integración con Otros Servicios

### Servicios que Dependen
- **Frontend**: Resuelve configuración por dominio
- **Auth**: Dominios para registro/login contextual
- **Organizations/Stores**: Configuración de branding
- **SSL Certificate Manager**: Emisión automática
- **CDN**: Configuración de edge domains

### Servicios que Preceden
- **Organization Setup**: Crea organización base
- **Store Creation**: Tiendas para dominios específicos
- **DNS Management**: Configuración externa de registros

## 🎯 Conclusión

El servicio `domains` es el **backbone del multi-tenancy** en Vendix. Proporciona resolución confiable de dominios, gestión completa del ciclo de vida, y verificación automática que asegura que solo dominios correctamente configurados puedan servir contenido. Su arquitectura de caché inteligente y manejo robusto de errores garantiza alta disponibilidad y rendimiento óptimo.

### Principios de Diseño
- **Resolución determinística**: Un hostname = una configuración exacta
- **Caché agresivo**: Optimización de rendimiento sin sacrificar consistencia
- **Verificación automática**: Confianza en configuración DNS
- **Estados explícitos**: Transparencia completa del ciclo de vida
- **Idempotencia**: Operaciones seguras para reintento