import { Module } from '@nestjs/common';
import { PublicDomainsController } from './public-domains.controller';
import { PublicDomainsService } from './public-domains.service';
import { ResponseModule } from '@common/responses';
import { PrismaModule } from '../../../prisma/prisma.module';

/**
 * 🌐 Public Domains Module
 *
 * Provides public endpoints for domain resolution.
 * Uses PublicDomainsService with GlobalPrismaService to avoid
 * organization context requirements.
 */
@Module({
  imports: [
    PrismaModule, // For GlobalPrismaService
    ResponseModule,
  ],
  controllers: [PublicDomainsController],
  providers: [PublicDomainsService],
  exports: [PublicDomainsService], // Export for use in DomainResolverMiddleware
})
export class PublicDomainsModule {}
