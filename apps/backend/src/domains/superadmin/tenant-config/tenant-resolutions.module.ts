import { Module } from '@nestjs/common';

import { TenantContextRunner } from '@common/context/tenant-context-runner.service';
import { ResponseModule } from '@common/responses/response.module';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResolutionsService } from '../../store/invoicing/resolutions/resolutions.service';

import { TenantResolutionsController } from './tenant-resolutions.controller';

/**
 * Resoluciones de numeración del tenant desde la consola de super admin.
 *
 * `ResolutionsService` se declara como provider en vez de importar
 * `InvoicingModule`: aquel no lo exporta, y arrastrarlo entero traería la cola
 * `dian-test-set`, el worker del set de pruebas y los controladores de
 * facturación de tienda a un rail que sólo necesita el CRUD de resoluciones.
 * El servicio es sin estado y sus dos dependencias —`StorePrismaService` y
 * `FiscalScopeService`— salen de `PrismaModule`, así que una segunda instancia
 * no introduce divergencia de comportamiento.
 *
 * `TenantContextRunner` se provee aquí y no se importa de
 * `SuperadminTenantConfigModule`: ese módulo es quien cablea a éste, y tomar
 * la dependencia en sentido contrario cerraría el ciclo.
 */
@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [TenantResolutionsController],
  providers: [TenantContextRunner, ResolutionsService],
})
export class TenantResolutionsModule {}
