import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { PaymentEncryptionService } from '../../payments/services/payment-encryption.service';
import { LodgingTraController } from './tra/tra.controller';
import { LodgingTraListener } from './tra/tra.listener';
import { LodgingTraProcessor } from './tra/tra.processor';
import { HttpTraProvider, TRA_PROVIDER } from './tra/tra.provider';
import { LodgingTraService, TRA_QUEUE } from './tra/tra-submissions.service';
import { LodgingSireController } from './sire/sire.controller';
import { LodgingSireListener } from './sire/sire.listener';
import { LodgingSireService } from './sire/sire.service';

/**
 * Hospitality Suite (H4.1) — legal reports of the hotel. TRA: each check-in
 * and check-out goes to the MinCIT through `TRA_PROVIDER`; the token is
 * encrypted like the payment processor credentials. SIRE (H4.2): foreign
 * guests' entries and exits, reported by hand in the portal (assisted).
 */
@Module({
  imports: [ResponseModule, PrismaModule, BullModule.registerQueue({ name: TRA_QUEUE })],
  controllers: [LodgingTraController, LodgingSireController],
  providers: [
    PaymentEncryptionService,
    { provide: TRA_PROVIDER, useClass: HttpTraProvider },
    LodgingTraService,
    LodgingTraListener,
    LodgingTraProcessor,
    LodgingSireService,
    LodgingSireListener,
  ],
})
export class LodgingComplianceModule {}
