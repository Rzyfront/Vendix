/**
 * Domain Configuration Utility
 * Centralized management for base domain configuration
 */

export interface DomainConfig {
  baseDomain: string;
  edgeDomain: string;
  isDevelopment: boolean;
}

export class DomainConfigService {
  private static config: DomainConfig;

  static initialize(): DomainConfig {
    const baseDomain = process.env.BASE_DOMAIN || 'vendix.com';
    const isDevelopment =
      process.env.NODE_ENV === 'development' ||
      baseDomain.includes('localhost') ||
      baseDomain.includes('dev');

    this.config = {
      baseDomain,
      edgeDomain: `edge.${baseDomain}`,
      isDevelopment,
    };

    return this.config;
  }

  static getConfig(): DomainConfig {
    if (!this.config) {
      this.initialize();
    }
    return this.config;
  }

  static getBaseDomain(): string {
    return this.getConfig().baseDomain;
  }

  static getEdgeDomain(): string {
    return this.getConfig().edgeDomain;
  }

  static isDevelopment(): boolean {
    return this.getConfig().isDevelopment;
  }

  /**
   * Generate a subdomain using the configured base domain
   * Format: {slug}.{BASE_DOMAIN} or {slug}-{random}.{BASE_DOMAIN}
   */
  static generateSubdomain(slug: string, useRandom: boolean = false): string {
    const baseDomain = this.getBaseDomain();
    const cleanSlug = slug
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (useRandom) {
      const randomString = Math.random().toString(36).substring(2, 6);
      return `${cleanSlug}-${randomString}.${baseDomain}`;
    }

    return `${cleanSlug}.${baseDomain}`;
  }

  /**
   * Check if a hostname belongs to the platform (is a subdomain of BASE_DOMAIN)
   */
  static isPlatformSubdomain(hostname: string): boolean {
    const baseDomain = this.getBaseDomain();
    return hostname.endsWith(`.${baseDomain}`) || hostname === baseDomain;
  }

  /**
   * Extract the subdomain part from a full hostname
   */
  static extractSubdomain(hostname: string): string | null {
    const baseDomain = this.getBaseDomain();
    const suffix = `.${baseDomain}`;

    if (hostname.endsWith(suffix)) {
      return hostname.slice(0, -suffix.length);
    }

    return null;
  }
}
