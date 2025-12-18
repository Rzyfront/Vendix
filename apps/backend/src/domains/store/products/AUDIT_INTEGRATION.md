# Integración de Auditoría en Módulo de Productos

## 📋 Ejemplo de Integración

### 1. Actualizar el Módulo de Productos
```typescript
import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module'; // ✅ Importar AuditModule

@Module({
  imports: [
    PrismaModule,
    AuditModule, // ✅ Agregar AuditModule a las importaciones
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
```

### 2. Actualizar el Servicio de Productos
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, AuditAction, AuditResource } from '../audit'; // ✅ Importar servicios de auditoría

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService, // ✅ Inyectar AuditService
  ) {}

  async create(createProductDto: CreateProductDto, userId: number) {
    // ... lógica de creación ...

    const result = await this.prisma.products.create({
      data: productData,
    });

    // ✅ Registrar auditoría
    await this.auditService.logCreate(
      userId,
      AuditResource.PRODUCTS,
      result.id,
      {
        name: result.name,
        sku: result.sku,
        base_price: result.base_price,
      }
    );

    return result;
  }

  async update(id: number, updateProductDto: UpdateProductDto, userId: number) {
    // ✅ Obtener valores anteriores
    const oldProduct = await this.prisma.products.findUnique({
      where: { id }
    });

    // ... lógica de actualización ...

    const result = await this.prisma.products.update({
      where: { id },
      data: updateProductDto,
    });

    // ✅ Registrar auditoría
    await this.auditService.logUpdate(
      userId,
      AuditResource.PRODUCTS,
      id,
      oldProduct,
      result,
      { updated_fields: Object.keys(updateProductDto) }
    );

    return result;
  }

  async remove(id: number, userId: number) {
    // ✅ Obtener producto antes de eliminar
    const product = await this.prisma.products.findUnique({
      where: { id }
    });

    // ... lógica de eliminación ...

    // ✅ Registrar auditoría
    await this.auditService.logDelete(
      userId,
      AuditResource.PRODUCTS,
      id,
      product,
      { reason: 'deleted_by_user' }
    );

    return result;
  }
}
```

### 3. Actualizar el Controller de Productos
```typescript
import { Controller, Get, Post, Body, Param, Put, Delete } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator'; // ✅ Asumiendo que tienes este decorador

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  create(
    @Body() createProductDto: CreateProductDto,
    @CurrentUser() user: any, // ✅ Obtener usuario actual
  ) {
    return this.productsService.create(createProductDto, user.id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
    @CurrentUser() user: any, // ✅ Obtener usuario actual
  ) {
    return this.productsService.update(+id, updateProductDto, user.id);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: any, // ✅ Obtener usuario actual
  ) {
    return this.productsService.remove(+id, user.id);
  }
}
```

## 🎯 Beneficios de la Integración

### ✅ Seguimiento Completo
- **Creación**: Registra quién creó cada producto y cuándo
- **Actualización**: Guarda cambios anteriores y nuevos valores
- **Eliminación**: Registra eliminación con valores anteriores

### ✅ Seguridad Mejorada
- **Auditoría de Cambios**: Historial completo de modificaciones
- **Responsabilidad**: Cada acción está ligada a un usuario
- **Detección de Anomalías**: Identifica cambios sospechosos

### ✅ Compliance
- **Regulatorio**: Cumple con requisitos de auditoría
- **Transparencia**: Historial visible de todas las operaciones
- **Reportes**: Generación de reportes de actividad

## 📊 Consultas de Auditoría para Productos

### Ver Historial de un Producto
```typescript
// GET /api/audit/logs?resource=products&resourceId=123
const productHistory = await auditService.getAuditLogs({
  resource: AuditResource.PRODUCTS,
  resourceId: 123,
});
```

### Ver Actividad de un Usuario en Productos
```typescript
// GET /api/audit/logs?userId=456&resource=products
const userProductActivity = await auditService.getAuditLogs({
  userId: 456,
  resource: AuditResource.PRODUCTS,
});
```

### Ver Cambios Recientes en Productos
```typescript
// GET /api/audit/logs?resource=products&action=UPDATE&fromDate=2025-01-01
const recentProductChanges = await auditService.getAuditLogs({
  resource: AuditResource.PRODUCTS,
  action: AuditAction.UPDATE,
  fromDate: new Date('2025-01-01'),
});
```

## 🚀 Próximos Pasos

1. **Aplicar el Patrón**: Usar este mismo patrón en otros módulos
2. **Interceptor Automático**: Implementar interceptor para operaciones CRUD comunes
3. **Dashboard de Auditoría**: Crear interfaz para visualizar logs
4. **Alertas**: Configurar alertas para actividades sospechosas
5. **Exportación**: Permitir exportar logs para análisis externo

Este ejemplo muestra cómo integrar completamente el sistema de auditoría en el módulo de productos, proporcionando un seguimiento completo de todas las operaciones importantes.
