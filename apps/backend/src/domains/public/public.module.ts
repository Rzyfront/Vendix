import { Module } from '@nestjs/common';
import { PublicDomainsModule } from './domains/public-domains.module';

/**
 * 🌐 Public Domain Module
 * 
 * Aggregates all public-facing modules that don't require authentication.
 * This provides a clear separation between public and private APIs.
 * 
 * Current modules:
 * - PublicDomainsModule: Domain resolution and availability checking
 * 
 * Future modules can be added here as needed.
 */
@Module({
    imports: [
        PublicDomainsModule,
        // Future public modules can be added here
    ],
})
export class PublicDomainModule { }
