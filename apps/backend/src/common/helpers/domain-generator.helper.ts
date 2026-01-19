import { Injectable } from '@nestjs/common';
import { DomainConfigService } from '../config/domain.config';

/**
 * Domain Context Types
 * Defines the context in which a domain is being generated
 */
export enum DomainContext {
  ORGANIZATION = 'org',
  STORE = 'store',
  ECOMMERCE = 'shop',
}

/**
 * Domain Generator Helper
 *
 * Utility service for generating platform subdomains with standardized suffixes.
 * This helper ensures consistent domain naming across the application.
 *
 * Patterns:
 * - Organization (ORG_ADMIN):  {slug}-org.vendix.com
 * - Store (STORE_ADMIN):       {slug}-store.vendix.com
 * - E-commerce (Storefront):   {slug}-shop.vendix.com
 *
 * @example
 * ```typescript
 * const orgHostname = domainGenerator.generate('tech-solutions', DomainContext.ORGANIZATION);
 * // Returns: 'tech-solutions-org.vendix.com'
 *
 * const storeHostname = domainGenerator.generate('my-store', DomainContext.STORE);
 * // Returns: 'my-store-store.vendix.com'
 *
 * const shopHostname = domainGenerator.generate('my-store', DomainContext.ECOMMERCE);
 * // Returns: 'my-store-shop.vendix.com'
 * ```
 */
@Injectable()
export class DomainGeneratorHelper {
  /**
   * Generate a platform subdomain with the appropriate suffix
   *
   * @param slug - The base slug (organization slug, store slug, etc.)
   * @param context - The domain context (org, store, shop)
   * @returns The generated hostname
   */
  generate(
    slug: string,
    context: DomainContext,
  ): string {
    const cleanedSlug = this.cleanSlug(slug);
    const suffix = this.getSuffixForContext(context);
    const baseDomain = DomainConfigService.getBaseDomain();

    return `${cleanedSlug}-${suffix}.${baseDomain}`;
  }

  /**
   * Generate a unique platform subdomain with automatic deduplication
   * If the base hostname is taken, appends a random suffix
   *
   * @param slug - The base slug
   * @param context - The domain context
   * @param existingHostnames - Set of existing hostnames to check against
   * @returns A unique hostname
   */
  generateUnique(
    slug: string,
    context: DomainContext,
    existingHostnames: Set<string> = new Set(),
  ): string {
    const baseHostname = this.generate(slug, context);

    // Check if hostname is available
    if (!existingHostnames.has(baseHostname)) {
      return baseHostname;
    }

    // Hostname is taken, append random suffix
    const cleanedSlug = this.cleanSlug(slug);
    const suffix = this.getSuffixForContext(context);
    const baseDomain = DomainConfigService.getBaseDomain();
    const randomSuffix = Math.random().toString(36).substring(2, 6);

    return `${cleanedSlug}-${suffix}-${randomSuffix}.${baseDomain}`;
  }

  /**
   * Generate multiple attempts for unique hostname
   * Useful when you need to check uniqueness against database
   *
   * @param slug - The base slug
   * @param context - The domain context
   * @param maxAttempts - Maximum number of attempts (default: 10)
   * @returns Array of possible hostnames in order of preference
   */
  generateAttempts(
    slug: string,
    context: DomainContext,
    maxAttempts: number = 10,
  ): string[] {
    const attempts: string[] = [];
    const cleanedSlug = this.cleanSlug(slug);
    const suffix = this.getSuffixForContext(context);
    const baseDomain = DomainConfigService.getBaseDomain();

    // First attempt: clean slug with suffix
    attempts.push(`${cleanedSlug}-${suffix}.${baseDomain}`);

    // Subsequent attempts: with random suffixes
    for (let i = 0; i < maxAttempts - 1; i++) {
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      attempts.push(`${cleanedSlug}-${suffix}-${randomSuffix}.${baseDomain}`);
    }

    return attempts;
  }

  /**
   * Get the appropriate suffix for a given context
   *
   * @param context - The domain context
   * @returns The suffix string
   */
  private getSuffixForContext(context: DomainContext): string {
    const suffixes: Record<DomainContext, string> = {
      [DomainContext.ORGANIZATION]: 'org',
      [DomainContext.STORE]: 'store',
      [DomainContext.ECOMMERCE]: 'shop',
    };

    return suffixes[context];
  }

  /**
   * Clean a slug for use in domain generation
   * - Converts to lowercase
   * - Normalizes accented characters
   * - Replaces special characters with hyphens
   * - Removes duplicate hyphens
   * - Trims leading/trailing hyphens
   *
   * @param slug - The slug to clean
   * @returns A cleaned slug
   */
  cleanSlug(slug: string): string {
    return slug
      .toLowerCase()
      .normalize('NFD') // Normalize accented characters
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Remove duplicate hyphens
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  }

  /**
   * Extract the context from a hostname
   * Useful for determining which context a hostname belongs to
   *
   * @param hostname - The hostname to parse
   * @returns The context or null if not a platform subdomain
   */
  extractContext(hostname: string): DomainContext | null {
    const baseDomain = DomainConfigService.getBaseDomain();

    // Check if it's a platform subdomain
    if (!hostname.endsWith(`.${baseDomain}`)) {
      return null;
    }

    // Extract the subdomain part
    const subdomain = hostname.slice(0, -(`.${baseDomain}`.length));

    // Extract the suffix (last part after last hyphen)
    const parts = subdomain.split('-');
    const suffix = parts[parts.length - 1];

    // Map suffix to context
    const suffixToContext: Record<string, DomainContext> = {
      'org': DomainContext.ORGANIZATION,
      'store': DomainContext.STORE,
      'shop': DomainContext.ECOMMERCE,
    };

    return suffixToContext[suffix] || null;
  }

  /**
   * Check if a hostname is a platform subdomain
   *
   * @param hostname - The hostname to check
   * @returns True if it's a platform subdomain
   */
  isPlatformSubdomain(hostname: string): boolean {
    return DomainConfigService.isPlatformSubdomain(hostname);
  }

  /**
   * Parse a hostname to extract its components
   *
   * @param hostname - The hostname to parse
   * @returns Parsed components or null if not a platform subdomain
   */
  parseHostname(hostname: string): {
    slug: string;
    context: DomainContext;
    baseDomain: string;
  } | null {
    const context = this.extractContext(hostname);

    if (!context) {
      return null;
    }

    const baseDomain = DomainConfigService.getBaseDomain();
    const subdomain = hostname.slice(0, -(`.${baseDomain}`.length));
    const suffix = this.getSuffixForContext(context);
    const slug = subdomain.slice(0, -(suffix.length + 1)); // Remove suffix and hyphen

    return {
      slug,
      context,
      baseDomain,
    };
  }

  /**
   * Get the full URL for a hostname
   *
   * @param hostname - The hostname
   * @param protocol - The protocol (default: https)
   * @returns The full URL
   */
  buildUrl(hostname: string, protocol: 'https' | 'http' = 'https'): string {
    return `${protocol}://${hostname}`;
  }

  /**
   * Validate if a hostname matches the expected pattern for a context
   *
   * @param hostname - The hostname to validate
   * @param expectedContext - The expected context
   * @returns True if the hostname matches the expected pattern
   */
  validateContext(hostname: string, expectedContext: DomainContext): boolean {
    const context = this.extractContext(hostname);
    return context === expectedContext;
  }
}
