import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { ResponseModule } from '@common/responses/response.module';
import { TenantContextRunner } from '@common/context/tenant-context-runner.service';
import { PrismaModule } from '../../../prisma/prisma.module';

import { TenantActivityModule } from './tenant-activity.module';
import { TenantConsoleAuditInterceptor } from './tenant-console-audit.interceptor';
import { TenantDianModule } from './tenant-dian.module';
import { TenantDirectoryController } from './tenant-directory.controller';
import { TenantDirectoryService } from './tenant-directory.service';
import { TenantResolutionsModule } from './tenant-resolutions.module';
import { TenantSettingsModule } from './tenant-settings.module';

/**
 * Consola de tenants del super admin.
 *
 * Rail para ver y gestionar la CONFIGURACIÓN de una tienda u organización sin
 * entrar a su panel. Los controladores son delegación: resuelven el tenant con
 * `TenantContextRunner`, forjan el contexto y ejecutan los servicios de tienda
 * y organización existentes sin modificarlos.
 *
 * `TenantContextRunner` se provee AQUÍ y en ningún módulo compartido: es la
 * única pieza capaz de alcanzar un tenant arbitrario, y su ubicación en
 * `common/context/` es convención de carpeta, no de alcance. El control real
 * es que ningún controlador de tienda u organización pueda inyectarlo.
 *
 * Nota deliberada sobre la puerta de suscripción: `StoreOperationsGuard` sólo
 * bloquea escrituras bajo `/api/store/**`, así que desde este rail se puede
 * configurar un tenant suspendido. Es el comportamiento de soporte que se
 * quiere, pero es un bypass consciente, no un descuido.
 *
 * `TenantConsoleAuditInterceptor` se registra como `APP_INTERCEPTOR` desde
 * aquí, no en `app.module.ts`: así se instancia con ESTE injector —el único
 * que provee `TenantContextRunner`— y sigue cubriendo todos los sub-módulos
 * del rail sin que cada uno tenga que declararlo. Filtra por prefijo de URL,
 * de modo que el resto de la aplicación no lo nota.
 */
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    // Cada superficie del rail trae su propio módulo y auto-provee
    // `TenantContextRunner` en vez de importarlo de aquí: la dependencia
    // inversa cerraría un ciclo con este mismo módulo, que es quien los cablea.
    // El runner es sin estado, así que varias instancias son equivalentes.
    TenantActivityModule,
    TenantDianModule,
    TenantResolutionsModule,
    TenantSettingsModule,
  ],
  controllers: [TenantDirectoryController],
  providers: [
    TenantContextRunner,
    TenantDirectoryService,
    { provide: APP_INTERCEPTOR, useClass: TenantConsoleAuditInterceptor },
  ],
  exports: [TenantContextRunner],
})
export class SuperadminTenantConfigModule {}
