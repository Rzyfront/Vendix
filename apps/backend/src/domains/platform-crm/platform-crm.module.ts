import { Module } from '@nestjs/common';
import { ResponseModule } from '../../common/responses/response.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformOrgService } from '../../common/services/platform-org.service';
import { PlatformCrmLinksController } from './platform-crm-links.controller';
import { PlatformCrmLinksService } from './platform-crm-links.service';
import { PlatformStoreGuard } from './platform-store.guard';
import { PlatformCrmAccountService } from './platform-crm-account.service';
import { StoreActivityModule } from '../superadmin/stores/activity/store-activity.module';

/**
 * Vendix Platform · enlace prospecto CRM ↔ organización cliente
 * (odd/tasks/vendix-platform-crm-enlace.md, candado 2).
 *
 * Módulo aislado: no importa ni exporta nada del CRM de tiendas y nadie lo
 * importa. De Superadmin solo trae `StoreActivityModule` (agregados de
 * actividad, sin controladores) para la gráfica de cada comercio enlazado.
 * `AuditService` y los servicios Prisma son globales: no se listan en
 * `providers` (ver `npm run prisma-singleton:audit`).
 */
@Module({
  imports: [ResponseModule, PrismaModule, StoreActivityModule],
  controllers: [PlatformCrmLinksController],
  providers: [
    PlatformCrmLinksService,
    PlatformCrmAccountService,
    PlatformStoreGuard,
    PlatformOrgService,
  ],
})
export class PlatformCrmModule {}
