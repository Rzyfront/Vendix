import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { StoreActivityService } from './store-activity.service';

/**
 * Agregados de actividad por comercio, sin controladores: lo importan
 * Superadmin (`StoresModule`, que conserva sus rutas) y la Cuenta Vendix del
 * CRM de Vendix Platform (`PlatformCrmModule`), sin que este último arrastre
 * los controladores de Superadmin.
 */
@Module({
  imports: [PrismaModule],
  providers: [StoreActivityService],
  exports: [StoreActivityService],
})
export class StoreActivityModule {}
