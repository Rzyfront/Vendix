# Audit Module - Módulo Principal de Auditoría

## 📋 Descripción General

El `AuditModule` es el módulo principal que agrupa todos los componentes del sistema de auditoría de Vendix. Proporciona una arquitectura modular y reutilizable para el registro y consulta de actividades del sistema.

## 🏗️ Arquitectura

### Ubicación
```
src/modules/audit/audit.module.ts
```

### Componentes Incluidos
- **AuditService**: Servicio principal de auditoría
- **AuditController**: Endpoints REST para consultas
- **AuditInterceptor**: Interceptor automático (opcional)
- **Decorators**: Decoradores para configuración
- **Enums**: Definiciones de acciones y recursos

### Estructura del Módulo
```
audit/
├── audit.module.ts       # Módulo principal
├── audit.service.ts      # Servicio de auditoría
├── audit.controller.ts   # Controller REST
├── audit.interceptor.ts  # Interceptor automático
├── audit.decorators.ts   # Decoradores utilitarios
├── index.ts             # Exportaciones
└── README.md            # Documentación
```

## 🚀 Configuración del Módulo

### Definición Básica
```typescript
import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

### Configuración Avanzada
```typescript
@Module({
  imports: [
    PrismaModule,
    // Módulos adicionales si son necesarios
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    // Servicios adicionales
    {
      provide: 'AUDIT_CONFIG',
      useValue: {
        enabled: true,
        maxRetries: 3,
        timeout: 5000,
      },
    },
  ],
  exports: [
    AuditService,
    // Exportar otros servicios si es necesario
  ],
})
export class AuditModule {}
```

## 🔧 Registro en la Aplicación

### Importación en AppModule
```typescript
// src/app.module.ts
import { AuditModule } from './modules/audit/audit.module';

@Module({
  imports: [
    // ... otros módulos
    AuditModule, // ✅ Importar AuditModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

### Configuración Global del Interceptor
```typescript
// src/app.module.ts
import { AuditModule } from './modules/audit/audit.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';

@Module({
  imports: [
    AuditModule,
    // ... otros módulos
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor, // ✅ Interceptor global
    },
  ],
})
export class AppModule {}
```

## 📦 Exportaciones

### Servicios Exportados
```typescript
// src/modules/audit/index.ts
export { AuditService } from './audit.service';
export { AuditController } from './audit.controller';
export { AuditInterceptor } from './audit.interceptor';
export { AuditModule } from './audit.module';
export * from './audit.enums';
export * from './audit.decorators';
```

### Uso de las Exportaciones
```typescript
// En otros módulos
import {
  AuditService,
  AuditModule,
  AuditAction,
  AuditResource,
  AuditCreate,
} from '../audit';
```

## 🔄 Integración con Otros Módulos

### Patrón de Integración Básico
```typescript
// En cualquier módulo que necesite auditoría
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    AuditModule, // ✅ Importar para usar AuditService
  ],
  providers: [MyService],
})
export class MyModule {}

@Injectable()
export class MyService {
  constructor(private readonly auditService: AuditService) {}

  async createItem(data: any, userId: number) {
    const item = await this.prisma.items.create({ data });

    await this.auditService.logCreate(
      userId,
      AuditResource.ITEMS,
      item.id,
      item
    );

    return item;
  }
}
```

### Integración con AuthModule
```typescript
// src/modules/auth/auth.module.ts
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    OrganizationsModule,
    AuditModule, // ✅ Requerido para AuditService en AuthService
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule],
})
export class AuthModule {}
```

### Integración con ProductsModule
```typescript
// src/modules/products/products.module.ts
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule, // ✅ Para auditoría de productos
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
```

## 🎯 Configuraciones Especiales

### Interceptor por Módulo
```typescript
// Para usar interceptor solo en un módulo específico
@Module({
  imports: [AuditModule],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class SpecificModule {}
```

### Configuración Condicional
```typescript
@Module({
  imports: [
    AuditModule,
    // Solo importar si la auditoría está habilitada
    ...(process.env.AUDIT_ENABLED === 'true' ? [AuditModule] : []),
  ],
})
export class ConditionalModule {}
```

### Módulo de Auditoría Avanzado
```typescript
@Module({
  imports: [
    PrismaModule,
    ConfigModule,
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditInterceptor,
    // Servicios adicionales
    AuditCleanupService,
    AuditAnalyticsService,
  ],
  exports: [
    AuditService,
    AuditAnalyticsService,
  ],
})
export class AdvancedAuditModule {}
```

## 📊 Dependencias del Módulo

### Dependencias Requeridas
```json
{
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@prisma/client": "^5.0.0",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.1"
  }
}
```

### Dependencias de Desarrollo
```json
{
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

## 🚀 Inicialización y Configuración

### Verificación de Base de Datos
```typescript
// Al iniciar la aplicación
async function checkAuditTables() {
  try {
    await prisma.$queryRaw`SELECT 1 FROM audit_logs LIMIT 1`;
    console.log('✅ Audit tables are ready');
  } catch (error) {
    console.error('❌ Audit tables not found:', error);
    throw new Error('Database not properly initialized');
  }
}
```

### Configuración de Índices
```sql
-- Índices recomendados para audit_logs
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_resource_id ON audit_logs(resource, resource_id);
```

## 🔐 Seguridad del Módulo

### Control de Acceso
```typescript
// En audit.controller.ts
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  @Roles('admin', 'auditor')
  @Get('logs')
  async getAuditLogs() {
    // Solo administradores y auditores
  }

  @Roles('admin')
  @Delete('logs/:id')
  async deleteAuditLog(@Param('id') id: string) {
    // Solo administradores pueden eliminar logs
  }
}
```

### Validación de Datos
```typescript
// DTOs para validación
export class AuditLogQueryDto {
  @IsOptional()
  @IsNumberString()
  userId?: string;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsDateString()
  fromDate?: string;
}
```

## 📈 Monitoreo y Métricas

### Métricas del Módulo
```typescript
// Servicio de métricas
@Injectable()
export class AuditMetricsService {
  private readonly logger = new Logger(AuditMetricsService.name);

  async getAuditMetrics() {
    const totalLogs = await this.prisma.audit_logs.count();
    const logsByAction = await this.prisma.audit_logs.groupBy({
      by: ['action'],
      _count: { id: true },
    });

    return {
      totalLogs,
      logsByAction,
      timestamp: new Date(),
    };
  }
}
```

### Health Checks
```typescript
// Health check para el módulo de auditoría
@Injectable()
export class AuditHealthIndicator {
  async isHealthy() {
    try {
      await this.prisma.audit_logs.findFirst();
      return { audit: { status: 'up' } };
    } catch (error) {
      return { audit: { status: 'down', error: error.message } };
    }
  }
}
```

## 🧪 Pruebas del Módulo

### Pruebas Unitarias
```typescript
describe('AuditModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [AuditModule],
    }).compile();
  });

  it('should compile the module', () => {
    expect(module).toBeDefined();
  });

  it('should provide AuditService', () => {
    const service = module.get<AuditService>(AuditService);
    expect(service).toBeDefined();
  });
});
```

### Pruebas de Integración
```typescript
describe('AuditModule Integration', () => {
  let app: INestApplication;
  let auditService: AuditService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [AuditModule, PrismaModule],
    }).compile();

    app = module.createNestApplication();
    auditService = module.get<AuditService>(AuditService);
    await app.init();
  });

  it('should log audit events', async () => {
    await auditService.logCreate(1, AuditResource.USERS, 123, { name: 'Test' });

    const log = await prisma.audit_logs.findFirst({
      where: { resource: 'users', resource_id: 123 }
    });

    expect(log).toBeDefined();
    expect(log.action).toBe('CREATE');
  });
});
```

## 🚨 Manejo de Errores

### Errores de Inicialización
```typescript
// En app.module.ts
@Module({
  imports: [
    AuditModule,
    // Manejar errores de inicialización
  ],
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: (auditService: AuditService) => async () => {
        try {
          await auditService.initialize();
        } catch (error) {
          console.error('Failed to initialize audit service:', error);
        }
      },
      inject: [AuditService],
      multi: true,
    },
  ],
})
export class AppModule {}
```

### Logging de Errores
```typescript
// En audit.service.ts
private readonly logger = new Logger(AuditService.name);

async logCreate(userId: number, resource: AuditResource, resourceId: number, newValues: any) {
  try {
    // Lógica de auditoría
  } catch (error) {
    this.logger.error(`Failed to log audit event: ${error.message}`, error.stack);
    // No re-throw para no afectar el flujo principal
  }
}
```

## 🔄 Migraciones y Actualizaciones

### Actualización del Módulo
```typescript
// Para actualizar a una nueva versión
@Module({
  imports: [
    AuditModule.forRoot({
      version: '2.0.0',
      migration: true,
    }),
  ],
})
export class AppModule {}
```

### Backward Compatibility
```typescript
// Mantener compatibilidad con versiones anteriores
export class AuditModule {
  static forRoot(options: AuditModuleOptions = {}) {
    return {
      module: AuditModule,
      providers: [
        {
          provide: 'AUDIT_OPTIONS',
          useValue: { ...defaultOptions, ...options },
        },
      ],
    };
  }
}
```

Este módulo proporciona una base sólida y extensible para el sistema de auditoría de Vendix, permitiendo una integración fácil y consistente en toda la aplicación.</content>
<parameter name="filePath">/home/rzydev/Vendix/apps/backend/doc/Audit/Audit Module/AuditModule.md
