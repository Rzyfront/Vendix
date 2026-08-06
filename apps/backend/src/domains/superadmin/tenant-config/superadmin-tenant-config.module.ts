import { Module } from '@nestjs/common';

import { ResponseModule } from '@common/responses/response.module';
import { TenantContextRunner } from '@common/context/tenant-context-runner.service';
import { PrismaModule } from '../../../prisma/prisma.module';

import { TenantDirectoryController } from './tenant-directory.controller';
import { TenantDirectoryService } from './tenant-directory.service';

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
 */
@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [TenantDirectoryController],
  providers: [TenantContextRunner, TenantDirectoryService],
  exports: [TenantContextRunner],
})
export class SuperadminTenantConfigModule {}
