import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AcmService } from './acm.service';
import { CloudFrontService } from './cloudfront.service';
import { DomainRootProvisioningService } from './domain-root-provisioning.service';
import { DomainProvisioningService } from './domain-provisioning.service';

/**
 * Global module wiring AWS-managed control plane services (ACM, CloudFront).
 * Marked @Global so feature modules can inject AcmService / CloudFrontService
 * without explicitly importing AwsModule each time. Registered once in
 * AppModule.
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [
    AcmService,
    CloudFrontService,
    DomainProvisioningService,
    DomainRootProvisioningService,
  ],
  exports: [
    AcmService,
    CloudFrontService,
    DomainProvisioningService,
    DomainRootProvisioningService,
  ],
})
export class AwsModule {}
