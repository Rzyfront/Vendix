import { Module } from '@nestjs/common';
import { PublicSeoService } from './public-seo.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PublicDomainsModule } from '../domains/public-domains.module';

@Module({
  imports: [PrismaModule, PublicDomainsModule],
  providers: [PublicSeoService],
  exports: [PublicSeoService],
})
export class PublicSeoModule {}
