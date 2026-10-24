import { Module } from '@nestjs/common';
import { OrgDianConfigController } from './dian-config.controller';
import { OrgDianConfigService } from './dian-config.service';
import { ResponseModule } from '../../../../common/responses/response.module';
import { S3Module } from '../../../../common/services/s3.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { DianDirectModule } from '../../../store/invoicing/providers/dian-direct/dian-direct.module';
import { ManualCertificateIssuerAdapter } from '../../../store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter';
import { BullModule } from '@nestjs/bullmq';
import { DianTestService } from '../../../store/invoicing/dian-config/dian-test.service';
import { DianConfigService } from '../../../store/invoicing/dian-config/dian-config.service';
import { DianNumberingRangeService } from '../../../store/invoicing/dian-config/dian-numbering-range.service';
import { InvoiceProviderModule } from '../../../store/invoicing/providers/invoice-provider.module';
import { DianHabilitationScannerService } from '../../../store/invoicing/dian-config/dian-habilitation-scanner.service';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    S3Module,
    DianDirectModule,
    // Exporta `FiscalProductionReadinessService`, que necesita `DianConfigService`.
    InvoiceProviderModule,
    // Cola del set de pruebas DIAN. Se registra en CADA módulo que declara
    // `DianTestService` en sus providers, porque Nest instancia el servicio una
    // vez por módulo y cada instancia necesita resolver su `@InjectQueue`.
    BullModule.registerQueue({ name: 'dian-test-set' }),
  ],
  controllers: [OrgDianConfigController],
  providers: [
    OrgDianConfigService,
    EncryptionService,
    FiscalScopeService,
    ManualCertificateIssuerAdapter,
    DianTestService,
    // Servicios de tienda reutilizados por los endpoints de readiness/rangos/
    // promoción; la guarda de scope y propiedad vive en `OrgDianConfigService`.
    DianConfigService,
    DianNumberingRangeService,
    // Mismo servicio que la tienda: `AIEngineModule` es @Global, así que basta
    // declararlo como provider en cada módulo que lo inyecta.
    DianHabilitationScannerService,
  ],
  exports: [OrgDianConfigService],
})
export class OrgDianConfigModule {}
