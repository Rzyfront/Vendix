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
}

@Injectable()
export class DomainResolutionService {
  private readonly logger = new Logger(DomainResolutionService.name);

  constructor(private prisma: PrismaService) {}

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
      }
    }

    return {
      id: domainConfig.id,
      hostname: domainConfig.hostname,
      organizationId: domainConfig.organization_id,
      storeId: domainConfig.store_id || undefined,
      config: domainConfig.config,
      createdAt: domainConfig.created_at?.toISOString() || '',
      updatedAt: domainConfig.updated_at?.toISOString() || '',
      // Additional properties from separate queries
      storeName,
      storeSlug,
      organizationName,
      organizationSlug,
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
        }
      }

      results.push({
        id: domain.id,
        hostname: domain.hostname,
        organizationId: domain.organization_id,
        storeId: domain.store_id || undefined,
        config: domain.config,
        createdAt: domain.created_at?.toISOString() || '',
        updatedAt: domain.updated_at?.toISOString() || '',
        storeName,
        storeSlug,
        organizationName,
        organizationSlug,
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
      }
    }

    return {
      id: domainConfig.id,
      hostname: domainConfig.hostname,
      organizationId: domainConfig.organization_id,
      storeId: domainConfig.store_id || undefined,
      config: domainConfig.config,
      createdAt: domainConfig.created_at?.toISOString() || '',
      updatedAt: domainConfig.updated_at?.toISOString() || '',
      storeName,
      storeSlug,
      organizationName,
      organizationSlug,
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
      }
    }

    return {
      id: domainConfig.id,
      hostname: domainConfig.hostname,
      organizationId: domainConfig.organization_id,
      storeId: domainConfig.store_id || undefined,
      config: domainConfig.config,
      createdAt: domainConfig.created_at?.toISOString() || '',
      updatedAt: domainConfig.updated_at?.toISOString() || '',
      storeName,
      storeSlug,
      organizationName,
      organizationSlug,
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

    if (!domainConfig.store_id) {
      this.logger.warn(`No store associated with domain: ${hostname}`);
      throw new NotFoundException(
        `No store found for hostname: ${hostname}`,
      );
    }

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

    return store;
  }
}
