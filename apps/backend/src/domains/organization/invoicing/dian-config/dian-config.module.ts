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

@Module({
  imports: [ResponseModule, PrismaModule, S3Module, DianDirectModule],
  controllers: [OrgDianConfigController],
  providers: [
    OrgDianConfigService,
    EncryptionService,
    FiscalScopeService,
    ManualCertificateIssuerAdapter,
  ],
  exports: [OrgDianConfigService],
})
export class OrgDianConfigModule {}
