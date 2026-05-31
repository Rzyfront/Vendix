import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '../../../../common/responses/response.module';
import { S3Module } from '../../../../common/services/s3.module';
import { DianDirectModule } from '../../../store/invoicing/providers/dian-direct/dian-direct.module';
import { ManualCertificateIssuerAdapter } from '../../../store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter';
import { SubscriptionFiscalController } from './subscription-fiscal.controller';
import { SubscriptionFiscalListener } from './subscription-fiscal.listener';
import { SubscriptionFiscalService } from './subscription-fiscal.service';

@Module({
  imports: [PrismaModule, ResponseModule, S3Module, DianDirectModule],
  controllers: [SubscriptionFiscalController],
  providers: [
    ManualCertificateIssuerAdapter,
    SubscriptionFiscalService,
    SubscriptionFiscalListener,
  ],
  exports: [SubscriptionFiscalService],
})
export class SubscriptionFiscalModule {}
