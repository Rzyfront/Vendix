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

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    S3Module,
    DianDirectModule,
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
  ],
  exports: [OrgDianConfigService],
})
export class OrgDianConfigModule {}
