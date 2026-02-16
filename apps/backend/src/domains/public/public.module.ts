import { Module } from '@nestjs/common';
import { PublicDomainsModule } from './domains/public-domains.module';
import { PublicSeoModule } from './seo/public-seo.module';

/**
 * 🌐 Public Domain Module
 *
 * Aggregates all public-facing modules that don't require authentication.
 * This provides a clear separation between public and private APIs.
 *
 * Current modules:
 * - PublicDomainsModule: Domain resolution and availability checking
 * - PublicSeoModule: Sitemap.xml and robots.txt generation
 */
@Module({
  imports: [
    PublicDomainsModule,
    PublicSeoModule,
  ],
})
export class PublicDomainModule {}
