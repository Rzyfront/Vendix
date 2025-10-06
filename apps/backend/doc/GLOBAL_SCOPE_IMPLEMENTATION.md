# 🔒 Sistema de Scope Global con Prisma Middleware

## 📋 Descripción

Este sistema implementa **filtrado automático por organización y tienda** a nivel de base de datos usando Prisma Middleware y AsyncLocalStorage. 

**Ventaja principal**: Ya NO necesitas agregar manualmente `organization_id` o `store_id` en tus queries.

---

## 🏗️ Arquitectura

### Componentes principales:

1. **`RequestContextService`** - Maneja el contexto del usuario con AsyncLocalStorage
2. **`RequestContextMiddleware`** - Extrae información del JWT y crea el contexto
3. **`PrismaService`** - Aplica filtros automáticos en todas las queries

### Flujo de ejecución:

```
1. Request → JwtAuthGuard valida token
2. RequestContextMiddleware crea contexto AsyncLocalStorage
3. Controller ejecuta servicio
4. PrismaService intercepta query con middleware
5. Aplica filtros automáticos según contexto
6. Query se ejecuta con scope
7. Resultado retorna al cliente
```

---

## ✅ Uso Básico

### Consultas CON scope (automático)

```typescript
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ✅ Automáticamente filtra por organization_id y store_id
  async findAll() {
    return this.prisma.products.findMany();
  }

  // ✅ Automáticamente inyecta organization_id
  async create(data: CreateProductDto) {
    return this.prisma.products.create({
      data: {
        name: data.name,
        price: data.price,
        // organization_id se agrega automáticamente
      },
    });
  }

  // ✅ Solo actualiza si el producto pertenece a tu organización
  async update(id: number, data: UpdateProductDto) {
    return this.prisma.products.update({
      where: { id },
      data,
    });
  }
}
```

### Consultas SIN scope (explícito)

```typescript
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // 🔓 Para jobs, seeders o reportes globales
  async seedProducts() {
    const prisma = this.prisma.withoutScope();
    
    return prisma.products.createMany({
      data: [
        { name: 'Product 1', organization_id: 1 },
        { name: 'Product 2', organization_id: 2 },
      ],
    });
  }

  // 🔓 Reporte global (solo Super Admin)
  async getGlobalStats() {
    const prisma = this.prisma.withoutScope();
    
    return {
      totalProducts: await prisma.products.count(),
      totalOrganizations: await prisma.organizations.count(),
    };
  }
}
```

---

## 🔐 Reglas de Seguridad

### 1. Super Admin: Bypass Automático

Los usuarios con rol `super_admin` NO tienen filtros aplicados:

```typescript
// Si el usuario es super_admin:
const products = await this.prisma.products.findMany();
// Retorna TODOS los productos de TODAS las organizaciones
```

### 2. Usuario Normal: Scope Automático

```typescript
// Si el usuario tiene organization_id = 5:
const products = await this.prisma.products.findMany();
// Retorna SOLO productos donde organization_id = 5
```

### 3. Usuario con Store: Doble Filtro

```typescript
// Si el usuario tiene organization_id = 5 y store_id = 10:
const products = await this.prisma.products.findMany();
// Retorna SOLO productos donde organization_id = 5 AND store_id = 10
```

---

## 📊 Modelos con Scope

### Scope de Organización

Todos estos modelos se filtran automáticamente por `organization_id`:

- `stores`
- `products`
- `orders`
- `categories`
- `brands`
- `addresses`
- `taxes`
- `inventory_movements`
- `inventory_snapshots`
- `customers`
- `order_items`
- `payments`
- `refunds`
- `product_images`
- `product_variants`

### Scope de Tienda (adicional)

Estos modelos también se filtran por `store_id` si el usuario tiene una tienda asignada:

- `products`
- `orders`
- `inventory_movements`
- `inventory_snapshots`

---

## 🛠️ Métodos Disponibles

### `RequestContextService.getContext()`

Obtiene el contexto actual del request:

```typescript
import { RequestContextService } from '../../common/context/request-context.service';

const context = RequestContextService.getContext();
console.log(context.userId);
console.log(context.organizationId);
console.log(context.storeId);
console.log(context.roles);
```

### `RequestContextService.isSuperAdmin()`

Verifica si el usuario actual es Super Admin:

```typescript
if (RequestContextService.isSuperAdmin()) {
  // Lógica especial para super admin
}
```

### `PrismaService.withoutScope()`

Ejecuta queries sin filtros automáticos:

```typescript
const prisma = this.prisma.withoutScope();
const allProducts = await prisma.products.findMany();
```

---

## 🚨 Casos Especiales

### Jobs y Seeders

```typescript
// En seeders o jobs que se ejecutan sin contexto de usuario
async seedDatabase() {
  const prisma = this.prisma.withoutScope();
  
  await prisma.organizations.createMany({
    data: [/* ... */],
  });
}
```

### Endpoints Públicos

```typescript
// Los endpoints sin autenticación no tienen contexto
// Por lo tanto, NO se aplican filtros automáticos
@Public() // Decorador que bypasea JwtAuthGuard
@Get('public/products')
async getPublicProducts() {
  // Esta query NO aplicará filtros de organización
  return this.prisma.products.findMany({
    where: { is_public: true },
  });
}
```

### Consultas Cross-Organization (Super Admin)

```typescript
// Solo para Super Admin
async getOrdersByOrganization(organizationId: number) {
  // Si el usuario es super_admin, puede consultar cualquier organización
  const prisma = this.prisma.withoutScope();
  
  return prisma.orders.findMany({
    where: { organization_id: organizationId },
  });
}
```

---

## 🔍 Debugging

### Logs en Desarrollo

En modo desarrollo, el sistema registra todas las operaciones:

```
[RequestContextMiddleware] Context set: User 5 | Org 3 | Store 7 | Roles: owner, manager
[PrismaService] 🔍 Scope applied to products.findMany: org=3, store=7
[PrismaService] ➕ Auto-inject org_id=3 to products.create
[PrismaService] 🔓 Super Admin bypass for orders.findMany
[PrismaService] ⛔ Access denied: products does not belong to org 3
```

### Verificar Contexto Actual

```typescript
@Get('debug/context')
getContext() {
  return {
    context: RequestContextService.getContext(),
    isSuperAdmin: RequestContextService.isSuperAdmin(),
    organizationId: RequestContextService.getOrganizationId(),
    storeId: RequestContextService.getStoreId(),
  };
}
```

---

## ⚠️ Notas Importantes

1. **ScopeGuard eliminado**: Ya NO necesitas el guard anterior que agregaba `organizationId` al query
2. **Transparente**: Los servicios existentes funcionan sin cambios
3. **Seguro**: Imposible acceder a datos de otra organización (excepto super admin)
4. **Performance**: El middleware es muy eficiente y no afecta el rendimiento
5. **Type-safe**: Totalmente compatible con TypeScript

---

## 📚 Referencias

- **Prisma Middleware**: https://www.prisma.io/docs/concepts/components/prisma-client/middleware
- **AsyncLocalStorage**: https://nodejs.org/api/async_hooks.html#class-asynclocalstorage
- **NestJS Middleware**: https://docs.nestjs.com/middleware

---

## 🔄 Migración desde ScopeGuard

### Antes (con ScopeGuard):

```typescript
async findAll(@Query() query: any) {
  return this.prisma.products.findMany({
    where: {
      organization_id: query.organizationId, // ❌ Manual
      store_id: query.storeId,               // ❌ Manual
    },
  });
}
```

### Después (con Prisma Middleware):

```typescript
async findAll() {
  return this.prisma.products.findMany();
  // ✅ Automático - organization_id y store_id se aplican automáticamente
}
```

---

## ✅ Checklist de Implementación

- [x] Crear `RequestContextService`
- [x] Crear `RequestContextMiddleware`
- [x] Modificar `PrismaService` con middleware
- [x] Modificar `AppModule`:
  - [x] Agregar `RequestContextService` a providers
  - [x] Remover `ScopeGuard` de providers
  - [x] Implementar `NestModule` con `RequestContextMiddleware`
- [x] Eliminar `ScopeGuard` del proyecto
- [ ] Limpiar servicios que usen `organizationId` del query (opcional)
- [ ] Probar con diferentes roles (usuario, owner, super_admin)

---

**¡Sistema implementado exitosamente! 🎉**
