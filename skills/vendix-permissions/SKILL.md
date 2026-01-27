# Vendix Permissions System

## Descripción General

El sistema de permisos de Vendix es un sistema RBAC (Role-Based Access Control) granular que protege los endpoints de la API mediante el decorador `@Permissions()` de NestJS. Los permisos se definen tanto en el código (controladores) como en la base de datos (seed), permitiendo auditoría completa y gestión dinámica.

**¿Por qué es importante mantenerlo sincronizado?**
- Los endpoints sin permisos correctos pueden ser inaccesibles o exponer funcionalidad no autorizada
- Los permisos obsoletos en el seed consumen memoria y confunden a los desarrolladores
- La inconsistencia entre código y base de datos causa errores en producción

## Formato de Permisos

### Patrones de Nomenclatura

Los permisos siguen estos patrones:

1. **Formato estándar**: `domain:resource:action`
   - Ejemplo: `store:products:create`
   - Ejemplo: `organization:users:update`

2. **Con subrecurso**: `domain:resource:subresource:action`
   - Ejemplo: `store:products:variants:create`
   - Ejemplo: `organization:roles:permissions:read`

3. **Formato alternativo**: `domain.resource.action`
   - Ejemplo: `auth.login`
   - Ejemplo: `audit.logs`
   - Ejemplo: `domains.create`

### Estructura de un Permiso en el Seed

```typescript
{
  name: 'domain:resource:action',
  description: 'Descripción clara en español',
  path: '/api/ruta/completa',
  method: 'METHOD',  // GET, POST, PATCH, PUT, DELETE
},
```

### Acciones Estándar

- `create` - POST para crear recursos
- `read` - GET para listar/ver recursos
- `update` - PATCH/PUT para actualizar
- `delete` - DELETE para eliminar
- `stats` - GET para estadísticas
- `search` - GET para búsquedas específicas
- `admin_delete` - DELETE hard (solo admin)

## Cómo Agregar Nuevos Permisos

### Paso 1: Agregar `@Permissions()` en el Controlador

```typescript
@Controller('store/products')
@UseGuards(PermissionsGuard)
export class ProductsController {
  @Post()
  @Permissions('store:products:create')
  async create(@Body() createProductDto: CreateProductDto) {
    // implementación
  }

  @Get()
  @Permissions('store:products:read')
  async findAll(@Query() query: ProductQueryDto) {
    // implementación
  }
}
```

### Paso 2: Agregar el Permiso al Seed

Abrir `/home/rzyfront/Vendix/apps/backend/prisma/seeds/permissions-roles.seed.ts` y agregar en la posición correcta (manteniendo orden alfabético por dominio):

```typescript
const permissions = [
  // ... otros permisos ...

  // Productos
  {
    name: 'store:products:create',
    description: 'Crear producto',
    path: '/api/store/products',
    method: 'POST',
  },
  {
    name: 'store:products:read',
    description: 'Leer productos',
    path: '/api/store/products',
    method: 'GET',
  },
  // agregar nuevo permiso aquí en orden alfabético
];
```

### Paso 3: Ejecutar el Seed

```bash
cd /home/rzyfront/Vendix/apps/backend
npx ts-node prisma/seeds/permissions-roles.seed.ts
```

### Ejemplo Completo Paso a Paso

**Escenario**: Agregar permiso para exportar productos a CSV

1. **En el controlador** (`store/products/products.controller.ts`):
```typescript
@Get('export/csv')
@Permissions('store:products:export:csv')
async exportToCsv(@Query() query: ProductQueryDto) {
  return this.productsService.exportToCsv(query);
}
```

2. **En el seed** (`prisma/seeds/permissions-roles.seed.ts`):
```typescript
// Agregar después de store:products:read y antes de store:products:update
{
  name: 'store:products:export:csv',
  description: 'Exportar productos a CSV',
  path: '/api/store/products/export/csv',
  method: 'GET',
},
```

3. **Ejecutar seed**:
```bash
npx ts-node prisma/seeds/permissions-roles.seed.ts
```

## Cómo Editar Permisos Existentes

### Cambiar Descripción

```typescript
// Antes
{
  name: 'store:products:read',
  description: 'Leer productos',
  path: '/api/store/products',
  method: 'GET',
},

// Después
{
  name: 'store:products:read',
  description: 'Leer productos de tienda (incluyendo variantes)',
  path: '/api/store/products',
  method: 'GET',
},
```

### Corregir Path o Método

**Importante**: Si cambias la ruta en el controlador, debes actualizar el seed también.

```typescript
// Controlador cambió de /store/products a /api/store/products
{
  name: 'store:products:read',
  description: 'Leer productos',
  path: '/api/store/products',  // actualizado
  method: 'GET',
},
```

## Cómo Eliminar Permisos Obsoletos

### Paso 1: Verificar que no se usan en Controladores

```bash
grep -r "@Permissions('store:products:old')" /home/rzyfront/Vendix/apps/backend/src/domains --include="*.controller.ts"
```

Si no hay resultados, el permiso no se usa y puede eliminarse.

### Paso 2: Eliminar del Seed

Simplemente elimina el objeto del permiso del array en `prisma/seeds/permissions-roles.seed.ts`.

### Paso 3: Ejecutar el Seed

```bash
npx ts-node prisma/seeds/permissions-roles.seed.ts
```

El seed eliminará automáticamente los permisos que ya no están en el array.

## Uso de Subagentes (Task Tool)

Para agilizar el análisis de permisos, usa la herramienta `Task` con subagentes. Esto permite procesar múltiples dominios en paralelo.

### Cuándo Usar Subagentes

- **Análisis completo de permisos**: Cuando necesites revisar todos los permisos de múltiples dominios
- **Sincronización masiva**: Cuando necesites verificar la consistencia entre muchos controladores y el seed
- **Refactorización de permisos**: Cuando cambies el nombre de muchos permisos a la vez

### Ejemplos de Prompts para Subagentes

#### Analizar un Dominio Completo

```
Analiza el dominio store en Vendix y extrae todos los @Permissions de sus controladores.
Para cada controlador en /domains/store/, extrae:
1. Nombre del permiso
2. Path completo del endpoint
3. Método HTTP
4. Línea de código

Organiza los resultados por subdominio (products, categories, brands, etc.)
```

#### Comparar con Seed Actual

```
Compara los permisos encontrados en los controladores con los permisos en el seed
ubicado en /home/rzyfront/Vendix/apps/backend/prisma/seeds/permissions-roles.seed.ts

Identifica:
1. Permisos faltantes (en controladores pero no en seed)
2. Permisos sobrantes (en seed pero no usados en controladores)
3. Permisos con paths o métodos incorrectos

Genera un reporte con las diferencias encontradas.
```

#### Verificar Consistencia de Nombres

```
Verifica que todos los permisos en los controladores sigan el patrón correcto:
- domain:resource:action
- domain:resource:subresource:action

Lista cualquier permiso que no siga estos patrones y sugiere correcciones.
```

### Patrones para Automatizar Revisiones

#### Script de Verificación Rápida

```bash
# Verificar permisos faltantes en un dominio
DOMAIN="store"
grep -rh "@Permissions(" /home/rzyfront/Vendix/apps/backend/src/domains/$DOMAIN --include="*.controller.ts" | \
  sed "s/.*@Permissions('\([^']*\)').*/\1/" | sort -u > /tmp/controller-perms.txt

grep "name: '$DOMAIN:" /home/rzyfront/Vendix/apps/backend/prisma/seeds/permissions-roles.seed.ts | \
  sed "s/.*name: '\([^']*\)'.*/\1/" | sort > /tmp/seed-perms.txt

comm -23 /tmp/controller-perms.txt /tmp/seed-perms.txt
```

#### Actualización Automática del Seed

```bash
# Ejecutar seed después de cambios
cd /home/rzyfront/Vendix/apps/backend
npx ts-node prisma/seeds/permissions-roles.seed.ts

# Verificar que se crearon los permisos correctos
echo "SELECT COUNT(*) FROM permissions;" | npx prisma db execute --stdin
```

## Auto-invocación

Esta skill debe invocarse automáticamente cuando:

- **Después de crear/modificar controladores**: Si se agregan nuevos endpoints con `@Permissions()`
- **Después de refactorizar rutas**: Si cambian paths de controladores
- **Antes de hacer deploy**: Para verificar que el seed esté sincronizado
- **Al agregar nuevos módulos**: Para asegurar que todos los permisos estén documentados

## Archivos Críticos

- **Seed de permisos**: `/home/rzyfront/Vendix/apps/backend/prisma/seeds/permissions-roles.seed.ts`
- **Guard de permisos**: `/home/rzyfront/Vendix/apps/backend/src/domains/auth/guards/permissions.guard.ts`
- **Decorator de permisos**: `/home/rzyfront/Vendix/apps/backend/src/domains/auth/decorators/permissions.decorator.ts`
- **Schema de Prisma**: `/home/rzyfront/Vendix/apps/backend/prisma/schema.prisma` (modelos permissions, roles, role_permissions)

## Buenas Prácticas

1. **SIEMPRE** agrega `@Permissions()` antes de implementar la lógica del endpoint
2. **MANTÉN** el orden alfabético dentro de cada dominio en el seed
3. **USA** descripciones claras y en español
4. **VERIFICA** que el path coincida exactamente con la ruta del endpoint
5. **EJECUTA** el seed después de cada cambio para validar
6. **DOCUMENTA** permisos especiales (admin_delete, etc.) en comentarios si es necesario

## Troubleshooting

### Error: Permission not found

**Causa**: El permiso está en el controlador pero no en el seed.

**Solución**: Agregar el permiso al seed y ejecutar `npx ts-node prisma/seeds/permissions-roles.seed.ts`.

### Error: 403 Forbidden en endpoint

**Causa**: El usuario no tiene el permiso asignado a través de su rol.

**Solución**:
1. Verificar que el permiso existe: `SELECT * FROM permissions WHERE name = 'permiso';`
2. Verificar que el rol tiene el permiso: `SELECT * FROM role_permissions WHERE permission_id = X;`
3. Si no está, ejecutar el seed de permisos o asignar manualmente.

### Permisos Duplicados

**Causa**: Dos permisos con el mismo nombre en el seed.

**Solución**: Los permisos tienen `@unique` en el schema. El seed usa `upsert` que actualiza si ya existe. Verificar que no haya duplicados en el array.

---

**Última actualización**: 2026-01-27
**Mantenedor**: Equipo Vendix
**Versión del sistema**: 1.0
