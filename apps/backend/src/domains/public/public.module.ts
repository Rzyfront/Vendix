import { Module } from '@nestjs/common';
import { PublicDomainsModule } from './domains/public-domains.module';
import { PublicSeoModule } from './seo/public-seo.module';
import { PublicPlansModule } from './subscriptions/public-plans.module';
import { PublicLegalModule } from './legal/public-legal.module';
import { MetaWhatsappWebhookModule } from './meta-whatsapp/meta-whatsapp-webhook.module';

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
 * - PublicLegalModule: Active system legal documents (Terms, Privacy, Cookies)
 */
@Module({
  imports: [
    PublicDomainsModule,
    PublicSeoModule,
    PublicPlansModule,
    PublicLegalModule,
    MetaWhatsappWebhookModule,
  ],
})
export class PublicDomainModule {}
