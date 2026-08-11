import { Module } from '@nestjs/common';

import { TenantContextRunner } from '@common/context/tenant-context-runner.service';
import { ResponseModule } from '@common/responses/response.module';

import { PrismaModule } from '../../../prisma/prisma.module';
import { SettingsModule as OrganizationSettingsModule } from '../../organization/settings/settings.module';
import { SettingsModule as StoreSettingsModule } from '../../store/settings/settings.module';

import { TenantSettingsController } from './tenant-settings.controller';

/**
 * Configuración de un tenant desde la consola de super admin.
 *
 * Aquí SÍ se importan los módulos de settings completos —en vez de declarar
 * los servicios como providers propios, como hace `TenantResolutionsModule`—
 * porque ambos ya los exportan y sus grafos de dependencias son grandes
 * (S3, auditoría, email, migrador de settings, sesiones de caja,
 * notificaciones). Una segunda instancia por duplicación de providers sería
 * una segunda copia del migrador de settings y de la caché que arrastra.
 *
 * Los dos servicios se llaman `SettingsService`, así que se importan con
 * alias; los tokens de inyección son las clases, que sí son distintas.
 */
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    StoreSettingsModule,
    OrganizationSettingsModule,
  ],
  controllers: [TenantSettingsController],
  providers: [TenantContextRunner],
})
export class TenantSettingsModule {}
