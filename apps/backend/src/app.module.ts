import {
  Module,
  MiddlewareConsumer,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './domains/auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './domains/organization/users/users.module';
import { TestModule } from './test/test.module';
import { DomainsModule } from './domains/domains.module';
import { StorageModule } from './storage.module';
import { PublicDomainsModule } from './domains/public/domains/public-domains.module';
import { JobsModule } from './jobs/jobs.module';

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
    SecretsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    AuthModule,
    PrismaModule,
    UsersModule,
    TestModule,
    DomainsModule,
    PublicDomainsModule,
    StorageModule,
    AuditModule,
    DefaultPanelUIModule,
    HelpersModule,
    JobsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    RequestContextService,
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
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(DomainResolverMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
