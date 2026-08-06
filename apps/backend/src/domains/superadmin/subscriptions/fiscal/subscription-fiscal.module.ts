import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '../../../../common/responses/response.module';
import { S3Module } from '../../../../common/services/s3.module';
import { DianDirectModule } from '../../../store/invoicing/providers/dian-direct/dian-direct.module';
import { ManualCertificateIssuerAdapter } from '../../../store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter';
import { BullModule } from '@nestjs/bullmq';
import { DianTestService } from '../../../store/invoicing/dian-config/dian-test.service';
// Reused as-is from the store domain: the scanner is stateless and only needs
// AIEngineService (a @Global() provider), so the platform gets the same
// extraction and the same validation rules instead of a second copy.
import { ResolutionScannerService } from '../../../store/invoicing/resolutions/resolution-scanner.service';
// Reused for the shared early-alert helpers (certificate expiry tiers, range
// threshold) so the platform checklist cannot drift from the tenant one.
import { FiscalProductionReadinessService } from '../../../store/invoicing/providers/fiscal-production-readiness.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { SubscriptionFiscalController } from './subscription-fiscal.controller';
import { SubscriptionFiscalListener } from './subscription-fiscal.listener';
import { SubscriptionFiscalService } from './subscription-fiscal.service';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    S3Module,
    DianDirectModule,
    // Cola del set de pruebas DIAN. Se registra en CADA módulo que declara
    // `DianTestService` en sus providers, porque Nest instancia el servicio una
    // vez por módulo y cada instancia necesita resolver su `@InjectQueue`.
    BullModule.registerQueue({ name: 'dian-test-set' }),
  ],
  controllers: [SubscriptionFiscalController],
  providers: [
    ManualCertificateIssuerAdapter,
    DianTestService,
    ResolutionScannerService,
    PlatformOrgService,
    FiscalProductionReadinessService,
    SubscriptionFiscalService,
    SubscriptionFiscalListener,
  ],
  exports: [SubscriptionFiscalService],
})
export class SubscriptionFiscalModule {}
