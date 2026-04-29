import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AcmService } from './acm.service';
import { CloudFrontService } from './cloudfront.service';

/**
 * Global module wiring AWS-managed control plane services (ACM, CloudFront).
 * Marked @Global so feature modules can inject AcmService / CloudFrontService
 * without explicitly importing AwsModule each time. Registered once in
 * AppModule.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [AcmService, CloudFrontService],
  exports: [AcmService, CloudFrontService],
})
export class AwsModule {}
