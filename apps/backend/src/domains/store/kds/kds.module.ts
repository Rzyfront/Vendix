import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { KdsController } from './kds.controller';
import { KdsService } from './kds.service';
import { KdsSessionsController } from './sessions/kds-sessions.controller';
import { KdsSessionsService } from './sessions/kds-sessions.service';

/**
 * KdsModule — estaciones de preparación y sus turnos (QUI-651).
 *
 * Espejo estructural de `CashRegistersModule`: entidad + submódulo `sessions/`.
 * Sin imports cruzados: el aislamiento por tienda lo da el auto-scope de
 * `StorePrismaService`.
 *
 * Se exporta `KdsSessionsService` porque el fire necesita resolver la sesión
 * abierta de la estación destino para firmar
 * `inventory_transactions.kds_session_id`.
 */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [KdsController, KdsSessionsController],
  providers: [KdsService, KdsSessionsService],
  exports: [KdsService, KdsSessionsService],
})
export class KdsModule {}
