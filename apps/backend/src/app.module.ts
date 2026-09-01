import {
  Module,
  MiddlewareConsumer,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { VendixThrottlerGuard } from './common/guards/vendix-throttler.guard';
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
import { StaffProvisioningModule } from './common/services/staff-provisioning.module';
import { HelpersModule } from './common/helpers/helpers.module';
import { DomainResolverMiddleware } from './common/middleware/domain-resolver.middleware';
import { DomainCacheInvalidatorListener } from './common/middleware/domain-cache-invalidator.listener';
import { AIEngineModule } from './ai-engine/ai-engine.module';
import { EncryptionModule } from './common/services/encryption.module';
import { AwsModule } from './common/services/aws/aws.module';
import { RedisModule } from './common/redis/redis.module';
import { QueueModule } from './common/queue/queue.module';
import { VendixCacheModule } from './common/cache/cache.module';
import { PwaCacheModule } from './common/services/pwa-cache.module';
import { MessagingModule } from './messaging/messaging.module';
import { UploadModule } from './upload/upload.module';
import { DnsModule } from './common/services/dns/dns.module';
import { CorsModule } from './common/cors/cors.module';
import { BlocklistModule } from './common/services/blocklist/blocklist.module';
import { RateLimitModule } from './common/services/rate-limit/rate-limit.module';
import { InventoryCostingModule } from './domains/store/inventory/shared/inventory-costing.module';

/**
 * Rol del proceso: qué mitad del backend levanta ESTA instancia.
 *
 * - `all`    — servidor HTTP **y** trabajo de fondo (workers BullMQ + `@Cron`).
 *              Es lo que Vendix ha hecho siempre y es el DEFAULT.
 * - `api`    — solo servidor HTTP. No registra workers ni deja crones montados.
 * - `worker` — solo trabajo de fondo. Sin servidor HTTP.
 */
export type VendixProcessRole = 'all' | 'api' | 'worker';

/**
 * ## Por qué existe este interruptor (QUI-674)
 *
 * Los 11 workers de BullMQ y TODOS los `@Cron` viven en el mismo proceso Node
 * que sirve la API (`JobsModule` + `QueueModule` se importan aquí arriba). Un
 * job CPU-bound —firmar el set de pruebas DIAN— detenía el event loop del
 * proceso entero, y nginx respondía 504 en rutas triviales de la API mientras
 * BullMQ perdía el lock de su propio job.
 *
 * La mitigación (caché del PKCS#12 + cesión del event loop) baja la probabilidad;
 * separar los procesos quita la clase de fallo: un worker que se bloquee ya no
 * puede tumbar la API porque no comparte su event loop.
 *
 * ## EL DEFAULT ES EL COMPORTAMIENTO ACTUAL — deliberadamente
 *
 * Cualquier valor que no sea exactamente `api` o `worker` (variable ausente,
 * vacía, con espacios, mal escrita) resuelve a `all`. La razón es asimétrica:
 * un despliegue que se olvide de la variable y arranque como hoy no pierde nada,
 * mientras que uno que resolviera a `api` por un typo se quedaría **sin nadie**
 * ejecutando cobros, recordatorios, provisiones ni reintentos — en silencio y
 * sin un solo error en los logs. Ante la duda, se hace todo.
 *
 * El caso simétrico (`worker` por typo en el contenedor de la API) se evita en
 * el despliegue pasando SIEMPRE el rol con `-e`, que tiene prioridad sobre
 * `--env-file`, de modo que un valor rancio en `/opt/vendix/.env` nunca decide.
 */
export function resolveVendixProcessRole(
  raw: string | undefined = process.env.VENDIX_PROCESS_ROLE,
): VendixProcessRole {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'api') return 'api';
  if (value === 'worker') return 'worker';
  return 'all';
}

/**
 * Distingue «no se configuró» de «se configuró mal».
 *
 * `resolveVendixProcessRole` colapsa ambos casos en `all` a propósito, pero un
 * typo merece un WARN en el arranque: el operador cree haber separado los
 * procesos y en realidad tiene dos instancias haciendo lo mismo.
 */
export function isKnownVendixProcessRole(
  raw: string | undefined = process.env.VENDIX_PROCESS_ROLE,
): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  return (
    value === '' || value === 'all' || value === 'api' || value === 'worker'
  );
}

/**
 * Lee un entero positivo del entorno para la configuración del throttler.
 *
 * Rechaza 0 y los negativos a propósito: `limit: 0` en `@nestjs/throttler`
 * significa «rechaza todo», y llegar a eso por una variable de entorno mal
 * escrita apagaría la API entera sin un solo error en los logs.
 */
function resolveThrottleSetting(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

@Module({
  imports: [
    SecretsModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // Techo global anti-inundación, llaveado por IP real vía
    // `VendixThrottlerGuard` (abajo). El límite se lee del entorno porque su
    // valor correcto depende de cuántos usuarios comparten una IP pública:
    // el 100 fijo anterior se agotaba con dos o tres paneles abiertos en la
    // misma oficina, ya que cargar un panel dispara decenas de peticiones en
    // paralelo.
    ThrottlerModule.forRoot([
      {
        ttl: resolveThrottleSetting(process.env.THROTTLE_TTL_MS, 60_000),
        limit: resolveThrottleSetting(process.env.THROTTLE_LIMIT, 300),
      },
    ]),
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
    StaffProvisioningModule,
    HelpersModule,
    JobsModule,
    RedisModule,
    QueueModule,
    VendixCacheModule,
    PwaCacheModule,
    AIEngineModule,
    EncryptionModule,
    AwsModule,
    PerformanceModule,
    MessagingModule,
    UploadModule,
    DnsModule,
    CorsModule,
    InventoryCostingModule,
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
      useClass: VendixThrottlerGuard,
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
    // with @SkipSubscriptionGate() pass through. Enforce is the code default;
    // set STORE_GATE_ENFORCE=false to fall back to log-only observation.
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
