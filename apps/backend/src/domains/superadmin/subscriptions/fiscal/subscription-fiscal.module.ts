import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '../../../../common/responses/response.module';
import { S3Module } from '../../../../common/services/s3.module';
import { DianDirectModule } from '../../../store/invoicing/providers/dian-direct/dian-direct.module';
import { ManualCertificateIssuerAdapter } from '../../../store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter';
import { BullModule } from '@nestjs/bullmq';
import { DianTestService } from '../../../store/invoicing/dian-config/dian-test.service';
// Reutilizado tal cual, igual que `DianTestService`: la plataforma necesita el
// MISMO reporte de readiness y la MISMA guarda de promoción que un tenant, y
// duplicarlos fue justo lo que dejó al riel de plataforma promoviendo a
// producción sin comprobar que la DIAN aprobó su set de habilitación.
import { DianConfigService } from '../../../store/invoicing/dian-config/dian-config.service';
// `DianConfigService` la necesita en su constructor. `EncryptionService`, su otra
// dependencia, ya llega por `EncryptionModule`, que es @Global.
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
// Reused as-is from the store domain: the scanner is stateless and only needs
// AIEngineService (a @Global() provider), so the platform gets the same
// extraction and the same validation rules instead of a second copy.
import { ResolutionScannerService } from '../../../store/invoicing/resolutions/resolution-scanner.service';
// Reused for the shared early-alert helpers (certificate expiry tiers, range
// threshold) so the platform checklist cannot drift from the tenant one.
import { FiscalProductionReadinessService } from '../../../store/invoicing/providers/fiscal-production-readiness.service';
// Reutilizado TAL CUAL, sin una línea de cambio: el scope de `invoice_resolutions`
// es FISCAL, no de tienda (`buildFiscalEntityDirectScope` devuelve sólo
// `{organization_id, accounting_entity_id}` y nunca filtra por `store_id`), así
// que el servicio ya funciona bajo el contexto de plataforma —organización 1 sin
// tienda— igual que `DianTestService`.
//
// Se importa por su path y NO vía `InvoicingModule`: ese módulo importa este riel
// y traerlo aquí cerraría el ciclo.
import { DianNumberingRangeService } from '../../../store/invoicing/dian-config/dian-numbering-range.service';
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
    DianConfigService,
    FiscalScopeService,
    ResolutionScannerService,
    PlatformOrgService,
    FiscalProductionReadinessService,
    // Sus tres dependencias ya están resueltas en este módulo: `StorePrismaService`
    // por `PrismaModule`, `DianTestService` como provider de arriba y
    // `TechnicalKeyVaultService` por `EncryptionModule`, que es @Global.
    DianNumberingRangeService,
    SubscriptionFiscalService,
    SubscriptionFiscalListener,
  ],
  exports: [SubscriptionFiscalService],
})
export class SubscriptionFiscalModule {}
