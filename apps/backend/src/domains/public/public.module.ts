import { Module } from '@nestjs/common';
import { PublicDomainsModule } from './domains/public-domains.module';
import { PublicSeoModule } from './seo/public-seo.module';
import { PublicPlansModule } from './subscriptions/public-plans.module';

/**
 * 🌐 Public Domain Module
 *
 * Aggregates all public-facing modules that don't require authentication.
 * This provides a clear separation between public and private APIs.
 *
 * Current modules:
 * - PublicDomainsModule: Domain resolution and availability checking
 * - PublicSeoModule: Sitemap.xml and robots.txt generation
 * - PublicPlansModule: SaaS pricing plans (rate-limited, public-safe fields only)
 */
@Module({
  imports: [
    PublicDomainsModule,
    PublicSeoModule,
    PublicPlansModule,
  ],
})
export class PublicDomainModule {}
