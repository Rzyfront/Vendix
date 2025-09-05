# Integration Guide - Guía de Integración del Sistema de Auditoría

## 📋 Descripción General

Esta guía proporciona instrucciones paso a paso para integrar el sistema de auditoría en módulos existentes y nuevos de Vendix. Incluye ejemplos prácticos y mejores prácticas.

## 🏗️ Arquitectura de Integración

### Componentes Principales
- **AuditModule**: Módulo base que debe importarse
- **AuditService**: Servicio inyectable para logging manual
- **AuditInterceptor**: Para auditoría automática
- **Decorators**: Para configuración declarativa

### Niveles de Integración
1. **Básico**: Importar módulo y usar servicio
2. **Intermedio**: Usar interceptor automático
3. **Avanzado**: Decorators y configuración personalizada

## 🚀 Integración Básica

### Paso 1: Importar AuditModule
```typescript
// En tu-module.module.ts
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    // ... tus otras importaciones
    AuditModule, // ✅ Agregar AuditModule
  ],
  // ... resto de configuración
})
export class TuModule {}
```

### Paso 2: Inyectar AuditService
```typescript
// En tu-service.service.ts
import { AuditService, AuditAction, AuditResource } from '../audit';

@Injectable()
export class TuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService, // ✅ Inyectar servicio
  ) {}
}
```

### Paso 3: Agregar Logging Manual
```typescript
async createEntity(data: CreateEntityDto, userId: number) {
  const entity = await this.prisma.entity.create({ data });

  // ✅ Registrar auditoría
  await this.auditService.logCreate(
    userId,
    AuditResource.YOUR_ENTITY, // Cambiar por tu recurso
    entity.id,
    entity
  );

  return entity;
}
```

## 🔧 Integración Intermedia - Interceptor Automático

### Configuración Global
```typescript
// En app.module.ts
import { AuditInterceptor } from './modules/audit/audit.interceptor';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor, // ✅ Interceptor global
    },
  ],
})
export class AppModule {}
```

### Configuración por Módulo
```typescript
// En tu-module.module.ts
import { AuditInterceptor } from '../audit/audit.interceptor';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor, // ✅ Interceptor por módulo
    },
  ],
})
export class TuModule {}
```

### Uso de Decorators
```typescript
// En tu-controller.controller.ts
import { AuditCreate, AuditUpdate, AuditDelete } from '../audit';

@Controller('entities')
export class TuController {
  @AuditCreate(AuditResource.YOUR_ENTITY)
  @Post()
  async create(@Body() data: CreateEntityDto, @CurrentUser() user: any) {
    return this.service.create(data, user.id);
  }

  @AuditUpdate(AuditResource.YOUR_ENTITY)
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() data: UpdateEntityDto,
    @CurrentUser() user: any
  ) {
    return this.service.update(+id, data, user.id);
  }

  @AuditDelete(AuditResource.YOUR_ENTITY)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(+id, user.id);
  }
}
```

## 🎯 Integración Avanzada

### Configuración Personalizada
```typescript
// En tu-module.module.ts
@Module({
  imports: [AuditModule],
  providers: [
    {
      provide: 'AUDIT_CONFIG',
      useValue: {
        enabled: process.env.AUDIT_ENABLED === 'true',
        excludePaths: ['/health', '/metrics'],
        customMetadata: true,
      },
    },
  ],
})
export class TuModule {}
```

### Interceptor Condicional
```typescript
@Injectable()
export class ConditionalAuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const isAuditable = this.shouldAudit(request);

    if (!isAuditable) {
      return next.handle();
    }

    // Lógica de auditoría
    return next.handle().pipe(
      tap((response) => {
        // Registrar auditoría
      })
    );
  }

  private shouldAudit(request: any): boolean {
    const excludedPaths = ['/health', '/metrics'];
    return !excludedPaths.includes(request.path);
  }
}
```

### Servicio de Auditoría Personalizado
```typescript
@Injectable()
export class CustomAuditService extends AuditService {
  async logCustomEvent(
    userId: number,
    eventType: string,
    metadata: Record<string, any>
  ) {
    await this.log({
      userId,
      action: AuditAction.SYSTEM,
      resource: AuditResource.SYSTEM,
      metadata: {
        eventType,
        ...metadata,
      },
    });
  }
}
```

## 📊 Ejemplos Prácticos por Módulo

### 1. Integración en AuthModule
```typescript
// src/modules/auth/auth.service.ts
@Injectable()
export class AuthService {
  constructor(
    private readonly auditService: AuditService,
    // ... otros servicios
  ) {}

  async login(loginDto: LoginDto, clientInfo?: ClientInfo) {
    // ... lógica de login

    await this.auditService.logAuth(
      user.id,
      AuditAction.LOGIN,
      {
        method: 'password',
        success: true,
      },
      clientInfo?.ipAddress,
      clientInfo?.userAgent
    );

    return { access_token, user };
  }
}
```

### 2. Integración en ProductsModule
```typescript
// src/modules/products/products.service.ts
@Injectable()
export class ProductsService {
  constructor(
    private readonly auditService: AuditService,
    // ... otros servicios
  ) {}

  async create(createProductDto: CreateProductDto, userId: number) {
    const product = await this.prisma.products.create({
      data: createProductDto,
    });

    await this.auditService.logCreate(
      userId,
      AuditResource.PRODUCTS,
      product.id,
      {
        name: product.name,
        sku: product.sku,
        base_price: product.base_price,
      }
    );

    return product;
  }
}
```

### 3. Integración en OrdersModule
```typescript
// src/modules/orders/orders.service.ts
@Injectable()
export class OrdersService {
  constructor(private readonly auditService: AuditService) {}

  async createOrder(orderData: CreateOrderDto, userId: number) {
    const order = await this.prisma.orders.create({
      data: orderData,
    });

    await this.auditService.logCreate(
      userId,
      AuditResource.ORDERS,
      order.id,
      order
    );

    return order;
  }

  async updateOrderStatus(orderId: number, status: OrderStatus, userId: number) {
    const oldOrder = await this.prisma.orders.findUnique({
      where: { id: orderId }
    });

    const updatedOrder = await this.prisma.orders.update({
      where: { id: orderId },
      data: { status }
    });

    await this.auditService.logUpdate(
      userId,
      AuditResource.ORDERS,
      orderId,
      { status: oldOrder.status },
      { status: updatedOrder.status },
      { reason: 'status_change' }
    );

    return updatedOrder;
  }
}
```

## 🔐 Seguridad y Control de Acceso

### Guards para Endpoints de Auditoría
```typescript
// En audit.controller.ts
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  @Roles('admin', 'auditor')
  @Get('logs')
  async getAuditLogs(@Query() query: AuditLogQueryDto) {
    // Solo admin y auditor pueden ver logs
  }

  @Roles('admin')
  @Delete('logs/:id')
  async deleteAuditLog(@Param('id') id: string) {
    // Solo admin puede eliminar logs
  }
}
```

### Filtrado de Datos Sensibles
```typescript
// En audit.service.ts
private sanitizeData(data: any): any {
  const sensitiveFields = ['password', 'token', 'secret'];

  if (typeof data === 'object' && data !== null) {
    const sanitized = { ...data };
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    return sanitized;
  }

  return data;
}
```

## 📈 Monitoreo y Métricas

### Health Check del Sistema de Auditoría
```typescript
// En health.controller.ts
@Controller('health')
export class HealthController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async health() {
    const auditHealth = await this.checkAuditHealth();

    return {
      status: auditHealth ? 'ok' : 'error',
      services: {
        audit: auditHealth ? 'up' : 'down',
      },
    };
  }

  private async checkAuditHealth(): Promise<boolean> {
    try {
      await this.auditService.getAuditLogs({ limit: 1 });
      return true;
    } catch (error) {
      return false;
    }
  }
}
```

### Métricas de Rendimiento
```typescript
// En metrics.service.ts
@Injectable()
export class MetricsService {
  async getAuditMetrics() {
    const totalLogs = await this.prisma.audit_logs.count();
    const logsLastHour = await this.prisma.audit_logs.count({
      where: {
        created_at: {
          gte: new Date(Date.now() - 60 * 60 * 1000),
        },
      },
    });

    return {
      total_logs: totalLogs,
      logs_per_hour: logsLastHour,
      timestamp: new Date(),
    };
  }
}
```

## 🚨 Manejo de Errores

### Errores de Auditoría No Bloqueantes
```typescript
// En cualquier servicio
async createEntity(data: any, userId: number) {
  try {
    const entity = await this.prisma.entity.create({ data });

    // Intentar registrar auditoría (no bloqueante)
    try {
      await this.auditService.logCreate(userId, AuditResource.ENTITY, entity.id, entity);
    } catch (auditError) {
      console.error('Audit logging failed:', auditError);
      // No throw - la operación principal fue exitosa
    }

    return entity;
  } catch (error) {
    throw error; // Error de negocio sí es bloqueante
  }
}
```

### Logging de Errores de Auditoría
```typescript
// En audit.service.ts
private readonly logger = new Logger(AuditService.name);

async logCreate(userId: number, resource: AuditResource, resourceId: number, newValues: any) {
  try {
    await this.log({
      userId,
      action: AuditAction.CREATE,
      resource,
      resourceId,
      newValues,
    });
  } catch (error) {
    this.logger.error(
      `Failed to log audit event: ${error.message}`,
      error.stack
    );

    // Opcional: re-throw si es crítico
    // throw error;
  }
}
```

## 🧪 Pruebas de Integración

### Pruebas Unitarias
```typescript
describe('ProductsService with Audit', () => {
  let service: ProductsService;
  let auditService: AuditService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    auditService = module.get<AuditService>(AuditService);
  });

  it('should create product and log audit', async () => {
    const createProductDto = { name: 'Test Product' };
    const userId = 1;

    const result = await service.create(createProductDto, userId);

    expect(auditService.logCreate).toHaveBeenCalledWith(
      userId,
      AuditResource.PRODUCTS,
      result.id,
      expect.any(Object)
    );
  });
});
```

### Pruebas de Integración
```typescript
describe('Audit Integration', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [AuditModule, ProductsModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  it('should create audit log when creating product', async () => {
    const response = await request(app.getHttpServer())
      .post('/products')
      .send({ name: 'Test Product' })
      .expect(201);

    const auditLog = await prisma.audit_logs.findFirst({
      where: { resource: 'products' }
    });

    expect(auditLog).toBeDefined();
    expect(auditLog.action).toBe('CREATE');
  });
});
```

## 📚 Mejores Prácticas

### 1. Consistencia en Naming
```typescript
// ✅ Bueno
await auditService.logCreate(userId, AuditResource.PRODUCTS, product.id, product);

// ❌ Evitar
await auditService.logCreate(userId, 'products', product.id, product);
```

### 2. Incluir Contexto Relevante
```typescript
// ✅ Bueno - incluir metadata útil
await auditService.logUpdate(
  userId,
  AuditResource.PRODUCTS,
  productId,
  oldProduct,
  newProduct,
  { updated_fields: ['name', 'price'] }
);

// ❌ Evitar - metadata vacío
await auditService.logUpdate(userId, AuditResource.PRODUCTS, productId, oldProduct, newProduct);
```

### 3. Manejo de Errores
```typescript
// ✅ Bueno - errores de auditoría no bloquean negocio
try {
  await this.auditService.logCreate(userId, resource, id, data);
} catch (error) {
  console.error('Audit failed:', error);
}

// ❌ Evitar - errores de auditoría bloquean negocio
await this.auditService.logCreate(userId, resource, id, data);
```

### 4. Filtrado de Datos Sensibles
```typescript
// ✅ Bueno - datos sanitizados
const auditData = {
  email: user.email,
  first_name: user.first_name,
  // password no incluido
};

// ❌ Evitar - datos sensibles expuestos
const auditData = user; // Incluye password
```

## 🔄 Migración de Código Existente

### Estrategia de Migración
1. **Fase 1**: Importar AuditModule en módulos principales
2. **Fase 2**: Agregar logging básico a operaciones críticas
3. **Fase 3**: Implementar interceptor automático
4. **Fase 4**: Agregar decorators y configuración avanzada

### Script de Migración
```typescript
// migration-audit.ts
async function migrateExistingCode() {
  // 1. Agregar imports
  console.log('Adding audit imports...');

  // 2. Inyectar AuditService
  console.log('Injecting AuditService...');

  // 3. Agregar logging calls
  console.log('Adding audit logging calls...');

  // 4. Test integration
  console.log('Testing audit integration...');
}
```

## 📊 Monitoreo Post-Integración

### Queries de Verificación
```sql
-- Verificar logs generados
SELECT action, resource, COUNT(*) as count
FROM audit_logs
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY action, resource
ORDER BY count DESC;

-- Verificar usuarios más activos
SELECT u.first_name, u.last_name, COUNT(a.id) as actions
FROM audit_logs a
JOIN users u ON a.user_id = u.id
WHERE a.created_at >= NOW() - INTERVAL '24 hours'
GROUP BY u.id, u.first_name, u.last_name
ORDER BY actions DESC
LIMIT 10;
```

### Dashboard de Auditoría
```typescript
// En frontend
const AuditDashboard = () => {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch('/api/audit/stats')
      .then(res => res.json())
      .then(setStats);
  }, []);

  return (
    <div>
      <h1>Audit Dashboard</h1>
      <StatsCards stats={stats} />
      <RecentActivity logs={logs} />
    </div>
  );
};
```

Esta guía proporciona una base completa para integrar el sistema de auditoría en cualquier parte de Vendix, desde la configuración básica hasta implementaciones avanzadas con monitoreo y métricas.

## 🏢 Integración Multi-Tenant

### Configuración de Guards Multi-Tenant
```typescript
// En tu-module.module.ts
import { AuditModule } from '../audit/audit.module';
import { OrganizationAuditGuard } from '../audit/guards/organization-audit.guard';

@Module({
  imports: [
    AuditModule, // ✅ Módulo de auditoría
  ],
  providers: [
    OrganizationAuditGuard, // ✅ Guard multi-tenant
  ],
})
export class TuModule {}
```

### Controlador con Multi-Tenant
```typescript
@Controller('tu-recurso')
@UseGuards(JwtAuthGuard, OrganizationAuditGuard) // ✅ Guards aplicados
export class TuController {
  constructor(
    private readonly tuService: TuService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async getRecursos(@Query() query: any, @Req() req: Request) {
    // El OrganizationAuditGuard ya filtró por organizationId
    const organizationId = req.query.organizationId;

    // Tu lógica de negocio aquí
    const recursos = await this.tuService.getRecursos(organizationId);

    // Auditoría automática
    await this.auditService.logAuth(
      req.user.id,
      AuditAction.READ,
      {
        resource: 'tu_recurso',
        organizationId,
        count: recursos.length,
      }
    );

    return recursos;
  }
}
```

### Servicio con Filtrado Multi-Tenant
```typescript
@Injectable()
export class TuService {
  async getRecursos(organizationId?: string) {
    const where: Prisma.TuRecursoWhereInput = {
      // ✅ Filtrado automático por organización
      organizationId: organizationId || undefined,
    };

    return this.prisma.tuRecurso.findMany({
      where,
      include: {
        organization: true, // ✅ Incluir datos de organización
      },
    });
  }

  async createRecurso(data: CreateRecursoDto, userId: number, organizationId: string) {
    const recurso = await this.prisma.tuRecurso.create({
      data: {
        ...data,
        organizationId, // ✅ Asignar organización
      },
    });

    // ✅ Auditoría con contexto multi-tenant
    await this.auditService.logCreate(
      userId,
      AuditResource.TU_RECURSO,
      recurso.id,
      {
        ...data,
        organizationId,
      }
    );

    return recurso;
  }
}
```

### Validación de Acceso Multi-Tenant
```typescript
@Injectable()
export class TuService {
  async validateOrganizationAccess(userId: number, organizationId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true, role: true },
    });

    // ✅ Super admin tiene acceso global
    if (user.role === 'super_admin') {
      return true;
    }

    // ✅ Usuario debe pertenecer a la organización
    return user.organizationId === organizationId;
  }
}
```

### Manejo de Errores Multi-Tenant
```typescript
@Controller('tu-recurso')
export class TuController {
  @Post()
  async createRecurso(@Body() data: CreateRecursoDto, @Req() req: Request) {
    try {
      // ✅ Validar acceso a organización
      const hasAccess = await this.tuService.validateOrganizationAccess(
        req.user.id,
        data.organizationId
      );

      if (!hasAccess) {
        throw new ForbiddenException('Acceso denegado a esta organización');
      }

      const recurso = await this.tuService.createRecurso(
        data,
        req.user.id,
        data.organizationId
      );

      return recurso;
    } catch (error) {
      // ✅ Auditoría de errores de acceso
      await this.auditService.logAuth(
        req.user.id,
        AuditAction.ACCESS_DENIED,
        {
          resource: 'tu_recurso',
          organizationId: data.organizationId,
          error: error.message,
        }
      );

      throw error;
    }
  }
}
```

### Testing Multi-Tenant
```typescript
describe('TuController (Multi-Tenant)', () => {
  it('should filter by organization', async () => {
    const user = { id: 1, organizationId: 123 };
    const query = {};

    // Simular OrganizationAuditGuard
    const mockReq = { user, query: { organizationId: 123 } };

    const result = await controller.getRecursos(query, mockReq);

    expect(result.every(r => r.organizationId === 123)).toBe(true);
  });

  it('should deny access to different organization', async () => {
    const user = { id: 1, organizationId: 123 };

    await expect(
      controller.createRecurso({ organizationId: 456 }, user)
    ).rejects.toThrow(ForbiddenException);
  });
});
```
