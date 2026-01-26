import { DomainType, AppEnvironment } from '../models/environment.enum';
import { environment } from '../../../environments/environment';

export class DomainUtils {
  /**
   * Extrae el subdominio de la URL actual
   */
  static getSubdomain(): string {
    const hostname = window.location.hostname;
    const parts = hostname.split('.');

    // Si es localhost o IP, no hay subdominio
    if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return '';
    }

    // Para dominios como subdomain.example.com, el subdominio es la primera parte
    if (parts.length > 2) {
      return parts[0];
    }

    return '';
  }

  /**
   * Determina el tipo de entorno basado en el dominio
   */
  static detectEnvironmentType(): DomainType {
    const hostname = window.location.hostname;
    const subdomain = this.getSubdomain();

    // Vendix domains
    if (hostname === environment.vendixDomain || hostname === `www.${environment.vendixDomain}`) {
      return DomainType.VENDIX_CORE;
    }

    // Super admin subdomain
    if (subdomain === 'admin') {
      return DomainType.VENDIX_CORE; // Asumimos que admin es parte de Vendix core
    }

    // Organization domains (custom names)
    if (subdomain && subdomain !== 'www' && subdomain !== 'app') {
      return DomainType.ORGANIZATION;
    }

    // Store domains (could be custom domains)
    // En producción, esto se determinaría con una consulta a la API
    if (this.isStoreDomain(hostname)) {
      return DomainType.STORE;
    }

    // Default to Vendix
    return DomainType.VENDIX_CORE;
  }

  /**
   * Verifica si el dominio actual pertenece a una tienda
   */
  private static isStoreDomain(hostname: string): boolean {
    // En desarrollo, asumimos que cualquier dominio que no sea Vendix es una tienda
    // En producción, esto se consultaría con la API
    const vendixDomains = [
      environment.vendixDomain,
      `www.${environment.vendixDomain}`,
      'localhost',
      '127.0.0.1',
    ];
    return !vendixDomains.includes(hostname) && !hostname.includes('admin.');
  }

  /**
   * Extrae el slug de la organización del subdominio
   */
  static getOrganizationSlug(): string {
    const subdomain = this.getSubdomain();
    return subdomain && subdomain !== 'admin' ? subdomain : '';
  }

  /**
   * Extrae el slug de la tienda del dominio
   */
  static getStoreSlug(): string {
    const hostname = window.location.hostname;
    const environmentType = this.detectEnvironmentType();

    if (
      environmentType === DomainType.STORE ||
      environmentType === DomainType.ECOMMERCE
    ) {
      // Para tiendas con subdominio: store.organization.com
      const subdomain = this.getSubdomain();
      if (subdomain && subdomain !== 'www') {
        return subdomain;
      }

      // Para dominios personalizados: mystore.com
      return hostname;
    }

    return '';
  }

  /**
   * Genera URLs para diferentes entornos
   */
  static generateEnvironmentUrl(
    environmentType: DomainType,
    slug?: string,
  ): string {
    const protocol = window.location.protocol;
    const baseDomain = this.getBaseDomain();

    switch (environmentType) {
      case DomainType.VENDIX_CORE:
        return `${protocol}//${baseDomain}`;

      case DomainType.ORGANIZATION:
        if (!slug) throw new Error('Organization slug is required');
        return `${protocol}//${slug}.${baseDomain}`;

      case DomainType.STORE:
        if (!slug) throw new Error('Store slug is required');
        // Para desarrollo, asumimos store.organization.com
        return `${protocol}//${slug}.${baseDomain}`;

      case DomainType.ECOMMERCE:
        if (!slug) throw new Error('Store slug is required');
        return `${protocol}//${slug}`;

      default:
        return `${protocol}//${baseDomain}`;
    }
  }

  /**
   * Obtiene el dominio base (sin subdominio)
   */
  private static getBaseDomain(): string {
    const hostname = window.location.hostname;

    if (hostname === 'localhost') {
      return 'localhost';
    }

    const parts = hostname.split('.');
    if (parts.length <= 2) {
      return hostname;
    }

    // Para dominios como sub.domain.com, retorna domain.com
    return parts.slice(-2).join('.');
  }

  /**
   * Valida si un slug es válido para organizaciones/tiendas
   */
  static isValidSlug(slug: string): boolean {
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    return slugRegex.test(slug) && slug.length >= 3 && slug.length <= 50;
  }

  /**
   * Normaliza un slug (minúsculas, reemplaza espacios con guiones)
   */
  static normalizeSlug(input: string): string {
    return input
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Obtiene la configuración de CORS para el dominio actual
   */
  static getCorsConfig(): { origin: string; credentials: boolean } {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;

    return {
      origin: `${protocol}//${hostname}`,
      credentials: true,
    };
  }

  /**
   * Genera meta tags para SEO basados en el dominio
   */
  static generateMetaTags(tenantConfig: any): { [key: string]: string } {
    const environmentType = this.detectEnvironmentType();
    const baseUrl = window.location.origin;

    const defaultMeta = {
      'og:url': baseUrl,
      'twitter:card': 'summary_large_image',
    };

    switch (environmentType) {
      case DomainType.VENDIX_CORE:
        return {
          ...defaultMeta,
          'og:title': 'Vendix - Multi-Tenant E-commerce Platform',
          'og:description':
            'La plataforma de e-commerce multi-tenant más avanzada para organizaciones y tiendas',
          'og:image': `${baseUrl}/assets/vlogo.png`,
          'twitter:title': 'Vendix - Multi-Tenant E-commerce Platform',
          'twitter:description':
            'La plataforma de e-commerce multi-tenant más avanzada',
        };

      case DomainType.ORGANIZATION:
        return {
          ...defaultMeta,
          'og:title': tenantConfig?.organization?.name || 'Organización',
          'og:description':
            tenantConfig?.organization?.description || 'Tienda en línea',
          'og:image':
            tenantConfig?.branding?.logo || `${baseUrl}/assets/vlogo.png`,
          'twitter:title': tenantConfig?.organization?.name || 'Organización',
          'twitter:description':
            tenantConfig?.organization?.description || 'Tienda en línea',
        };

      case DomainType.STORE:
      case DomainType.ECOMMERCE:
        return {
          ...defaultMeta,
          'og:title': tenantConfig?.store?.name || 'Tienda',
          'og:description':
            tenantConfig?.store?.description || 'Bienvenido a nuestra tienda',
          'og:image':
            tenantConfig?.branding?.logo || `${baseUrl}/assets/vlogo.png`,
          'twitter:title': tenantConfig?.store?.name || 'Tienda',
          'twitter:description':
            tenantConfig?.store?.description || 'Bienvenido a nuestra tienda',
        };

      default:
        return defaultMeta;
    }
  }
}
