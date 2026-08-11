import { Module } from '@nestjs/common';

import { TenantContextRunner } from '@common/context/tenant-context-runner.service';
import { ResponseModule } from '@common/responses/response.module';

import { PrismaModule } from '../../../prisma/prisma.module';

import { TenantActivityController } from './tenant-activity.controller';
import { TenantActivityService } from './tenant-activity.service';

/**
 * Actividad de uso del tenant en la consola de super admin.
 *
 * `TenantContextRunner` se provee aquí y no se importa de
 * `SuperadminTenantConfigModule`: ese módulo es quien cablea a éste, y tomar la
 * dependencia en sentido contrario cerraría el ciclo. El runner es sin estado y
 * sus dos dependencias —`GlobalPrismaService` y `FiscalScopeService`— salen de
 * `PrismaModule`, así que una segunda instancia no cambia el comportamiento.
 *
 * No se importa `WeeklyReportModule`: la ficha lee el último snapshot de
 * `store_weekly_reports` directamente porque el servicio de tienda GENERA el
 * reporte cuando falta, y un GET de soporte no puede escribir en el tenant que
 * inspecciona ni notificar al comerciante.
 */
@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [TenantActivityController],
  providers: [TenantContextRunner, TenantActivityService],
})
export class TenantActivityModule {}
