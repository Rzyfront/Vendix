# Audit Interceptor - Interceptor Automático de Auditoría

## 📋 Descripción General

El `AuditInterceptor` es un interceptor de NestJS que automáticamente registra operaciones CRUD en el sistema de auditoría. Proporciona una forma declarativa de auditar operaciones sin modificar el código de negocio.

## 🏗️ Arquitectura

### Ubicación
```
src/modules/audit/audit.interceptor.ts
```

### Dependencias
- **AuditService**: Servicio principal para registrar logs
- **Reflector**: Para leer metadatos de decoradores
- **ExecutionContext**: Contexto de ejecución de NestJS

### Conceptos Clave
- **Interceptors**: Middleware que intercepta requests/responses
- **Decorators**: Metadatos para configurar el comportamiento
- **Automatic Logging**: Registro automático sin código manual

## 🚀 Funcionalidad

### Intercepción Automática
```typescript
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Lógica de intercepción antes de la ejecución
    return next.handle().pipe(
      // Lógica de intercepción después de la ejecución
    );
  }
}
```

### Flujo de Intercepción
1. **Pre-Handle**: Extrae metadatos del método
2. **Execute**: Ejecuta el método original
3. **Post-Handle**: Registra la auditoría basada en el resultado
4. **Return**: Devuelve la respuesta original

## 🎯 Decoradores de Auditoría

### 1. `@AuditCreate(resource)`
Decora métodos que crean nuevos recursos.

```typescript
@AuditCreate(AuditResource.PRODUCTS)
@Post()
async create(@Body() data: CreateProductDto, @CurrentUser() user: any) {
  return this.productsService.create(data, user.id);
}
```

### 2. `@AuditUpdate(resource)`
Decora métodos que actualizan recursos existentes.

```typescript
@AuditUpdate(AuditResource.PRODUCTS)
@Put(':id')
async update(
  @Param('id') id: string,
  @Body() data: UpdateProductDto,
  @CurrentUser() user: any
) {
  return this.productsService.update(+id, data, user.id);
}
```

### 3. `@AuditDelete(resource)`
Decora métodos que eliminan recursos.

```typescript
@AuditDelete(AuditResource.PRODUCTS)
@Delete(':id')
async remove(@Param('id') id: string, @CurrentUser() user: any) {
  return this.productsService.remove(+id, user.id);
}
```

### 4. `@AuditAuth(action)`
Decora métodos de autenticación.

```typescript
@AuditAuth(AuditAction.LOGIN)
@Post('login')
async login(@Body() loginDto: LoginDto, @Req() req: Request) {
  return this.authService.login(loginDto, {
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
  });
}
```

## 🔧 Configuración del Interceptor

### Registro Global
```typescript
// En app.module.ts
@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
```

### Registro por Módulo
```typescript
// En products.module.ts
@Module({
  providers: [AuditInterceptor],
})
export class ProductsModule {}
```

### Registro por Controller
```typescript
// En products.controller.ts
@Controller('products')
@UseInterceptors(AuditInterceptor)
export class ProductsController {
  // Todos los métodos de este controller serán auditados
}
```

### Registro por Método
```typescript
@Controller('products')
export class ProductsController {
  @Post()
  @UseInterceptors(AuditInterceptor)
  async create(@Body() data: CreateProductDto) {
    // Solo este método será interceptado
  }
}
```

## 📊 Extracción de Datos

### Obtención del Usuario
```typescript
private getUserId(context: ExecutionContext): number | undefined {
  const request = context.switchToHttp().getRequest();
  return request.user?.id;
}
```

### Obtención de Metadatos
```typescript
private getAuditMetadata(context: ExecutionContext) {
  const handler = context.getHandler();
  const controller = context.getClass();

  return {
    resource: this.reflector.get<AuditResource>('auditResource', handler),
    action: this.reflector.get<AuditAction>('auditAction', handler),
    customData: this.reflector.get('auditCustomData', handler),
  };
}
```

### Análisis de la Respuesta
```typescript
private analyzeResponse(response: any, metadata: any) {
  if (metadata.action === 'CREATE' && response?.id) {
    return {
      resourceId: response.id,
      newValues: response,
    };
  }

  if (metadata.action === 'UPDATE' && response?.id) {
    return {
      resourceId: response.id,
      newValues: response,
      // oldValues se obtendrían del servicio
    };
  }

  return {};
}
```

## 🎯 Casos de Uso

### 1. Controller de Productos
```typescript
@Controller('products')
@UseInterceptors(AuditInterceptor)
export class ProductsController {
  @AuditCreate(AuditResource.PRODUCTS)
  @Post()
  async create(@Body() data: CreateProductDto, @CurrentUser() user: any) {
    return this.productsService.create(data, user.id);
  }

  @AuditUpdate(AuditResource.PRODUCTS)
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() data: UpdateProductDto,
    @CurrentUser() user: any
  ) {
    return this.productsService.update(+id, data, user.id);
  }

  @AuditDelete(AuditResource.PRODUCTS)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.productsService.remove(+id, user.id);
  }
}
```

### 2. Controller de Usuarios
```typescript
@Controller('users')
@UseInterceptors(AuditInterceptor)
export class UsersController {
  @AuditCreate(AuditResource.USERS)
  @Post()
  async create(@Body() data: CreateUserDto, @CurrentUser() user: any) {
    return this.usersService.create(data, user.id);
  }

  @AuditAuth(AuditAction.PASSWORD_CHANGE)
  @Put(':id/password')
  async changePassword(
    @Param('id') id: string,
    @Body() data: ChangePasswordDto,
    @CurrentUser() user: any
  ) {
    return this.usersService.changePassword(+id, data, user.id);
  }
}
```

### 3. Controller de Órdenes
```typescript
@Controller('orders')
@UseInterceptors(AuditInterceptor)
export class OrdersController {
  @AuditCreate(AuditResource.ORDERS)
  @Post()
  async create(@Body() data: CreateOrderDto, @CurrentUser() user: any) {
    return this.ordersService.create(data, user.id);
  }

  @AuditUpdate(AuditResource.ORDERS)
  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() data: UpdateOrderStatusDto,
    @CurrentUser() user: any
  ) {
    return this.ordersService.updateStatus(+id, data, user.id);
  }
}
```

## 🔄 Flujo de Trabajo

### Secuencia de Eventos
1. **Request llega** al controller
2. **Interceptor se ejecuta** antes del método
3. **Método del controller** se ejecuta normalmente
4. **Interceptor analiza** la respuesta
5. **AuditService registra** el evento
6. **Response se devuelve** al cliente

### Diagrama de Flujo
```
Request → Interceptor (Pre) → Controller Method → Interceptor (Post) → Audit Log → Response
```

## 🚨 Manejo de Errores

### Errores en el Interceptor
```typescript
intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
  return next.handle().pipe(
    tap((response) => {
      // Registrar auditoría exitosa
      this.logAudit(context, response, 'SUCCESS');
    }),
    catchError((error) => {
      // Registrar auditoría de error
      this.logAudit(context, null, 'ERROR', error);
      // Re-lanzar el error
      throw error;
    })
  );
}
```

### Logging de Errores
```typescript
private async logAudit(
  context: ExecutionContext,
  response: any,
  status: 'SUCCESS' | 'ERROR',
  error?: any
) {
  try {
    const metadata = this.getAuditMetadata(context);
    const userId = this.getUserId(context);

    if (status === 'ERROR') {
      await this.auditService.logSystem(
        AuditAction.ERROR,
        metadata.resource,
        {
          error: error.message,
          method: context.getHandler().name,
          status,
        }
      );
    } else {
      // Logging normal
      await this.performAuditLogging(metadata, userId, response);
    }
  } catch (auditError) {
    // Logging de errores del interceptor no debe romper la app
    console.error('Audit interceptor error:', auditError);
  }
}
```

## 🔧 Configuración Avanzada

### Filtros de Exclusión
```typescript
private shouldSkipAudit(context: ExecutionContext): boolean {
  const handler = context.getHandler();
  const skipAudit = this.reflector.get<boolean>('skipAudit', handler);
  return skipAudit || false;
}
```

### Uso del Filtro
```typescript
@Controller('health')
export class HealthController {
  @Get()
  @SkipAudit() // No auditar este endpoint
  async health() {
    return { status: 'ok' };
  }
}
```

### Configuración Condicional
```typescript
private shouldAuditBasedOnConfig(): boolean {
  return this.configService.get('AUDIT_ENABLED', true);
}
```

## 📈 Rendimiento

### Optimizaciones
- **Lazy Loading**: Solo importa AuditService cuando es necesario
- **Async Operations**: No bloquea el response principal
- **Error Resilience**: Los errores de auditoría no afectan el negocio
- **Memory Efficient**: Minimal overhead en memoria

### Métricas de Rendimiento
```typescript
// Medir tiempo de auditoría
const startTime = Date.now();
await this.auditService.logCreate(userId, resource, id, data);
const auditTime = Date.now() - startTime;
console.log(`Audit logging took: ${auditTime}ms`);
```

## 🧪 Pruebas

### Pruebas Unitarias
```typescript
describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let auditService: AuditService;

  beforeEach(() => {
    const mockAuditService = {
      logCreate: jest.fn(),
      logUpdate: jest.fn(),
      logDelete: jest.fn(),
    };

    interceptor = new AuditInterceptor(mockAuditService as any);
  });

  it('should call audit service on create', () => {
    // Test implementation
  });
});
```

### Pruebas de Integración
```typescript
describe('Audit Interceptor Integration', () => {
  it('should log create operation', async () => {
    const response = await request(app.getHttpServer())
      .post('/products')
      .send({ name: 'Test Product' })
      .expect(201);

    // Verify audit log was created
    const auditLog = await prisma.audit_logs.findFirst({
      where: { resource: 'products' }
    });

    expect(auditLog).toBeDefined();
    expect(auditLog.action).toBe('CREATE');
  });
});
```

## 🔄 Integración con Decorators

### Definición de Decoradores
```typescript
// audit.decorators.ts
export const AuditCreate = (resource: AuditResource) => {
  return applyDecorators(
    SetMetadata('auditResource', resource),
    SetMetadata('auditAction', AuditAction.CREATE),
  );
};

export const AuditUpdate = (resource: AuditResource) => {
  return applyDecorators(
    SetMetadata('auditResource', resource),
    SetMetadata('auditAction', AuditAction.UPDATE),
  );
};

export const SkipAudit = () => {
  return SetMetadata('skipAudit', true);
};
```

### Uso Combinado
```typescript
@Controller('products')
@UseInterceptors(AuditInterceptor)
export class ProductsController {
  @AuditCreate(AuditResource.PRODUCTS)
  @Post()
  async create(@Body() data: CreateProductDto) {
    // Automáticamente auditado
  }

  @SkipAudit()
  @Get('public')
  async getPublicProducts() {
    // No auditado
  }
}
```

Este interceptor proporciona una forma elegante y automática de auditar operaciones en el sistema Vendix, reduciendo la duplicación de código y asegurando una cobertura completa de auditoría.</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Audit/Audit Interceptor/AuditInterceptor.md
