import {
  Module,
  MiddlewareConsumer,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { DomainScopeGuard } from './common/guards/domain-scope.guard';
import { StoreOperationsGuard } from './domains/store/subscriptions/guards/store-operations.guard';
import { RequestContextService } from '@common/context/request-context.service';
import { RequestContextInterceptor } from '@common/interceptors/request-context.interceptor';

import { AuditModule } from './common/audit/audit.module';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { PerformanceModule } from './domains/superadmin/monitoring/performance.module';
import { PerformanceInterceptor } from './domains/superadmin/monitoring/interceptors/performance.interceptor';
import { SecretsModule } from './common/config/secrets.module';
import { DefaultPanelUIModule } from './common/services/default-panel-ui.module';
import { HelpersModule } from './common/helpers/helpers.module';
import { DomainResolverMiddleware } from './common/middleware/domain-resolver.middleware';
import { DomainCacheInvalidatorListener } from './common/middleware/domain-cache-invalidator.listener';
import { AIEngineModule } from './ai-engine/ai-engine.module';
import { EncryptionModule } from './common/services/encryption.module';
import { AwsModule } from './common/services/aws/aws.module';
import { RedisModule } from './common/redis/redis.module';
import { QueueModule } from './common/queue/queue.module';
import { VendixCacheModule } from './common/cache/cache.module';
import { MessagingModule } from './messaging/messaging.module';
import { DnsModule } from './common/services/dns/dns.module';
import { CorsModule } from './common/cors/cors.module';
import { BlocklistModule } from './common/services/blocklist/blocklist.module';
import { RateLimitModule } from './common/services/rate-limit/rate-limit.module';

@Module({
  imports: [
    SecretsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
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
    RedisModule,
    QueueModule,
    VendixCacheModule,
    AIEngineModule,
    EncryptionModule,
    AwsModule,
    PerformanceModule,
    MessagingModule,
    DnsModule,
    CorsModule,
    BlocklistModule,
    RateLimitModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    RequestContextService,
    DomainCacheInvalidatorListener,
    {
      provide: APP_INTERCEPTOR,
      useClass: PerformanceInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Domain scope guard — runs AFTER JwtAuthGuard so req.user.app_type is
    // populated. Garantiza el aislamiento de dominio (REGLA CERO):
    // - app_type=STORE_ADMIN solo /api/store/*
    // - app_type=ORG_ADMIN   solo /api/organization/*
    // - super_admin bypass.
    // - @Public() y rutas fuera de /store|/organization pasan sin tocar.
    {
      provide: APP_GUARD,
      useClass: DomainScopeGuard,
    },
    // Subscription gate — runs AFTER JwtAuthGuard so req.user.store_id is
    // populated. Blocks writes under /api/store/** when the store has no
    // active subscription (or it's suspended/blocked/cancelled/expired).
    // Read methods, /api/store/subscriptions/**, and handlers decorated
    // with @SkipSubscriptionGate() pass through. Enforce mode is gated by
    // the STORE_GATE_ENFORCE env var (currently 'true' in dev/prod).
    {
      provide: APP_GUARD,
      useClass: StoreOperationsGuard,
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
