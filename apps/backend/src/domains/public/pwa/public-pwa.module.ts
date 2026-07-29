import { Module } from '@nestjs/common';
import { PublicPwaService } from './public-pwa.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PublicDomainsModule } from '../domains/public-domains.module';
import { S3Module } from '@common/services/s3.module';
import { S3PathHelper } from '@common/helpers/s3-path.helper';

@Module({
  imports: [PrismaModule, PublicDomainsModule, S3Module],
  providers: [PublicPwaService, S3PathHelper],
  exports: [PublicPwaService],
})
export class PublicPwaModule {}
