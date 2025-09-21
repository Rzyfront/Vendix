import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface DomainResolutionResponse {
  id: number;
  hostname: string;
  organizationId: number;
  storeId?: number;
  config: any;
  createdAt: string;
  updatedAt: string;
  // Additional properties for store and organization details
  storeName?: string;
  storeSlug?: string;
  organizationName?: string;
  organizationSlug?: string;
  // Type of domain
  domainType: 'organization' | 'store';
}

@Injectable()
export class DomainResolutionService {
  private readonly logger = new Logger(DomainResolutionService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Resuelve la configuración de un dominio por hostname para uso público
   * Solo devuelve la configuración del dominio sin información detallada de store/organización
   */
  async resolveDomainConfig(hostname: string): Promise<any> {
    this.logger.log(`Resolving domain config for public access: ${hostname}`);

    const domainConfig = await this.prisma.domain_settings.findUnique({
      where: {
        hostname: hostname,
      },
    });

    if (!domainConfig) {
      this.logger.warn(`Domain config not found: ${hostname}`);
      throw new NotFoundException(
        `Domain configuration not found for hostname: ${hostname}`,
      );
    }

    this.logger.log(`Found domain configuration for: ${hostname}`);

    return {
      id: domainConfig.id,
      hostname: domainConfig.hostname,
      organizationId: domainConfig.organization_id,
      storeId: domainConfig.store_id || null,
      config: domainConfig.config,
      createdAt: domainConfig.created_at?.toISOString() || '',
      updatedAt: domainConfig.updated_at?.toISOString() || '',
      // Indicar el tipo de dominio basado en si tiene store_id
      domainType: domainConfig.store_id ? 'store' : 'organization'
    };
  }

  /**
   * Resuelve la configuración de un dominio por hostname
   * Simplificado: solo busca por hostname exacto y devuelve la config completa
   */
  async resolveDomain(hostname: string): Promise<DomainResolutionResponse> {
    this.logger.log(`Resolving domain: ${hostname}`);

    const domainConfig = await this.prisma.domain_settings.findUnique({
      where: {
        hostname: hostname,
      },
    });

    if (!domainConfig) {
      this.logger.warn(`Domain not found: ${hostname}`);
      throw new NotFoundException(
        `Domain configuration not found for hostname: ${hostname}`,
      );
    }

    this.logger.log(`Found domain configuration for: ${hostname}`);

    // Get store and organization details if storeId exists
    let storeName: string | undefined;
    let storeSlug: string | undefined;
    let organizationName: string | undefined;
    let organizationSlug: string | undefined;
    let domainType: 'organization' | 'store' = 'organization'; // default

    if (domainConfig.store_id) {
      const store = await this.prisma.stores.findUnique({
        where: { id: domainConfig.store_id },
        include: { organizations: true },
      });

      if (store) {
        storeName = store.name;
        storeSlug = store.slug;
        organizationName = store.organizations?.name;
        organizationSlug = store.organizations?.slug;
        domainType = 'store';
      }
    } else {
      // Only organization, no store
      const organization = await this.prisma.organizations.findUnique({
        where: { id: domainConfig.organization_id! },
      });

      if (organization) {
        organizationName = organization.name;
        organizationSlug = organization.slug;
      }
      domainType = 'organization';
    }

    return {
      id: domainConfig.id,
      hostname: domainConfig.hostname,
      organizationId: domainConfig.organization_id!,
      storeId: domainConfig.store_id || undefined,
      config: domainConfig.config,
      createdAt: domainConfig.created_at?.toISOString() || '',
      updatedAt: domainConfig.updated_at?.toISOString() || '',
      // Additional properties from separate queries
      storeName,
      storeSlug,
      organizationName,
      organizationSlug,
      domainType,
    };
  }

  /**
   * Obtiene todas las configuraciones de dominio (para uso administrativo)
   */
  async getAllDomainConfigs(): Promise<DomainResolutionResponse[]> {
    const domains = await this.prisma.domain_settings.findMany({
      orderBy: { hostname: 'asc' },
    });

    // Get additional details for each domain
    const results: DomainResolutionResponse[] = [];

    for (const domain of domains) {
      let storeName: string | undefined;
      let storeSlug: string | undefined;
      let organizationName: string | undefined;
      let organizationSlug: string | undefined;
      let domainType: 'organization' | 'store' = 'organization'; // default

      if (domain.store_id) {
        const store = await this.prisma.stores.findUnique({
          where: { id: domain.store_id },
          include: { organizations: true },
        });

        if (store) {
          storeName = store.name;
          storeSlug = store.slug;
          organizationName = store.organizations?.name;
          organizationSlug = store.organizations?.slug;
          domainType = 'store';
        }
      } else {
        // Only organization, no store
        const organization = await this.prisma.organizations.findUnique({
          where: { id: domain.organization_id! },
        });

        if (organization) {
          organizationName = organization.name;
          organizationSlug = organization.slug;
        }
        domainType = 'organization';
      }

      results.push({
        id: domain.id,
        hostname: domain.hostname,
        organizationId: domain.organization_id!,
        storeId: domain.store_id || undefined,
        config: domain.config,
        createdAt: domain.created_at?.toISOString() || '',
        updatedAt: domain.updated_at?.toISOString() || '',
        storeName,
        storeSlug,
        organizationName,
        organizationSlug,
        domainType,
      });
    }

    return results;
  }

  /**
   * Crea una nueva configuración de dominio
   */
  async createDomainConfig(data: {
    hostname: string;
    organizationId: number;
    storeId?: number;
    config: any;
  }): Promise<DomainResolutionResponse> {
    const domainConfig = await this.prisma.domain_settings.create({
      data: {
        hostname: data.hostname,
        organization_id: data.organizationId,
        store_id: data.storeId,
        config: data.config,
      },
    });

    // Get additional details
    let storeName: string | undefined;
    let storeSlug: string | undefined;
    let organizationName: string | undefined;
    let organizationSlug: string | undefined;
    let domainType: 'organization' | 'store' = 'organization'; // default

    if (domainConfig.store_id) {
      const store = await this.prisma.stores.findUnique({
        where: { id: domainConfig.store_id },
        include: { organizations: true },
      });

      if (store) {
        storeName = store.name;
        storeSlug = store.slug;
        organizationName = store.organizations?.name;
        organizationSlug = store.organizations?.slug;
        domainType = 'store';
      }
    } else {
      // Only organization, no store
      const organization = await this.prisma.organizations.findUnique({
        where: { id: domainConfig.organization_id! },
      });

      if (organization) {
        organizationName = organization.name;
        organizationSlug = organization.slug;
      }
      domainType = 'organization';
    }

    return {
      id: domainConfig.id,
      hostname: domainConfig.hostname,
      organizationId: domainConfig.organization_id!,
      storeId: domainConfig.store_id || undefined,
      config: domainConfig.config,
      createdAt: domainConfig.created_at?.toISOString() || '',
      updatedAt: domainConfig.updated_at?.toISOString() || '',
      storeName,
      storeSlug,
      organizationName,
      organizationSlug,
      domainType,
    };
  }

  /**
   * Actualiza una configuración de dominio
   */
  async updateDomainConfig(
    hostname: string,
    config: any,
  ): Promise<DomainResolutionResponse> {
    const domainConfig = await this.prisma.domain_settings.update({
      where: { hostname },
      data: { config },
    });

    // Get additional details
    let storeName: string | undefined;
    let storeSlug: string | undefined;
    let organizationName: string | undefined;
    let organizationSlug: string | undefined;
    let domainType: 'organization' | 'store' = 'organization'; // default

    if (domainConfig.store_id) {
      const store = await this.prisma.stores.findUnique({
        where: { id: domainConfig.store_id },
        include: { organizations: true },
      });

      if (store) {
        storeName = store.name;
        storeSlug = store.slug;
        organizationName = store.organizations?.name;
        organizationSlug = store.organizations?.slug;
        domainType = 'store';
      }
    } else {
      // Only organization, no store
      const organization = await this.prisma.organizations.findUnique({
        where: { id: domainConfig.organization_id! },
      });

      if (organization) {
        organizationName = organization.name;
        organizationSlug = organization.slug;
      }
      domainType = 'organization';
    }

    return {
      id: domainConfig.id,
      hostname: domainConfig.hostname,
      organizationId: domainConfig.organization_id!,
      storeId: domainConfig.store_id || undefined,
      config: domainConfig.config,
      createdAt: domainConfig.created_at?.toISOString() || '',
      updatedAt: domainConfig.updated_at?.toISOString() || '',
      storeName,
      storeSlug,
      organizationName,
      organizationSlug,
      domainType,
    };
  }

  /**
   * Elimina una configuración de dominio
   */
  async deleteDomainConfig(hostname: string): Promise<void> {
    await this.prisma.domain_settings.delete({
      where: { hostname },
    });

    this.logger.log(`Domain configuration deleted: ${hostname}`);
  }

  /**
   * Resuelve el store para un dominio específico
   * Si no hay store_id, devuelve información de la organización
   */
  async resolveStoreByDomain(hostname: string): Promise<any> {
    this.logger.log(`Resolving store for domain: ${hostname}`);

    const domainConfig = await this.prisma.domain_settings.findUnique({
      where: {
        hostname: hostname,
      },
    });

    if (!domainConfig) {
      this.logger.warn(`Domain not found: ${hostname}`);
      throw new NotFoundException(
        `Domain configuration not found for hostname: ${hostname}`,
      );
    }

    // Si hay store_id, buscar el store
    if (domainConfig.store_id) {
      const store = await this.prisma.stores.findUnique({
        where: { id: domainConfig.store_id },
        include: { organizations: true },
      });

      if (!store) {
        this.logger.warn(`Store not found for domain: ${hostname}`);
        throw new NotFoundException(
          `Store not found for hostname: ${hostname}`,
        );
      }

      return {
        ...store,
        domainType: 'store',
        domainConfig: domainConfig
      };
    }

    // Si no hay store_id pero hay organization_id, devolver info de la organización
    if (domainConfig.organization_id) {
      const organization = await this.prisma.organizations.findUnique({
        where: { id: domainConfig.organization_id },
      });

      if (!organization) {
        this.logger.warn(`Organization not found for domain: ${hostname}`);
        throw new NotFoundException(
          `Organization not found for hostname: ${hostname}`,
        );
      }

      // Devolver un objeto similar a store pero con info de organización
      return {
        id: null, // No hay store real
        name: organization.name,
        slug: organization.slug,
        organizations: organization, // La organización misma
        domainConfig: domainConfig, // Incluir la config del dominio
        domainType: 'organization'
      };
    }

    this.logger.warn(`No store or organization associated with domain: ${hostname}`);
    throw new NotFoundException(
      `No store or organization found for hostname: ${hostname}`,
    );
  }
}
