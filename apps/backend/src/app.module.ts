import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './domains/auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './domains/organization/users/users.module';
import { TestModule } from './test/test.module';
import { DomainsModule } from './domains/domains.module';
import { StorageModule } from './storage.module';
import { PublicDomainsModule } from './domains/public/domains/public-domains.module';

import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './domains/auth/guards/jwt-auth.guard';
import { RequestContextService } from '@common/context/request-context.service';
import { RequestContextInterceptor } from '@common/interceptors/request-context.interceptor';

import { AuditModule } from './common/audit/audit.module';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { SecretsModule } from './common/config/secrets.module';
import { DefaultPanelUIModule } from './common/services/default-panel-ui.module';
import { HelpersModule } from './common/helpers/helpers.module';
import { DomainResolverMiddleware } from './common/middleware/domain-resolver.middleware';

@Module({
  imports: [
    SecretsModule, // Load secrets from AWS before ConfigModule
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    PrismaModule,
    UsersModule,
    TestModule,
    DomainsModule, // ✅ Módulo de dominios (público y privado)
    PublicDomainsModule, // ✅ Módulo para resolución de dominios públicos
    StorageModule,
    AuditModule, // ✅ Importar AuditModule global (desde common)
    DefaultPanelUIModule, // ✅ Importar DefaultPanelUIModule global (servicio centralizado de panel UI)
    HelpersModule, // ✅ Importar HelpersModule global (utilidades para generación de dominios)
  ],
  controllers: [AppController],
  providers: [
    AppService,
    RequestContextService, // ✅ Servicio de contexto con AsyncLocalStorage
    DomainResolverMiddleware, // ✅ Middleware para resolver dominios en ecommerce
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor, // ✅ Registrar AuditInterceptor globalmente
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(DomainResolverMiddleware)
      .forRoutes('ecommerce/(.*)', 'api/ecommerce/(.*)');
  }
}
