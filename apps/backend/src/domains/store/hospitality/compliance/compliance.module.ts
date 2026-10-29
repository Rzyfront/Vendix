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

/**
 * Hospitality Suite (H4.1) — legal reports of the hotel. TRA: each check-in
 * and check-out goes to the MinCIT through `TRA_PROVIDER`; the token is
 * encrypted like the payment processor credentials.
 */
@Module({
  imports: [ResponseModule, PrismaModule, BullModule.registerQueue({ name: TRA_QUEUE })],
  controllers: [LodgingTraController],
  providers: [
    PaymentEncryptionService,
    { provide: TRA_PROVIDER, useClass: HttpTraProvider },
    LodgingTraService,
    LodgingTraListener,
    LodgingTraProcessor,
  ],
})
export class LodgingComplianceModule {}
