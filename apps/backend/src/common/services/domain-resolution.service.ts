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
        hostname: hostname
      }
    });

    if (!domainConfig) {
      this.logger.warn(`Domain not found: ${hostname}`);
      throw new NotFoundException(`Domain configuration not found for hostname: ${hostname}`);
    }

    this.logger.log(`Found domain configuration for: ${hostname}`);
    
    return {
      id: domainConfig.id,
      hostname: domainConfig.hostname,
      organizationId: domainConfig.organization_id,
      storeId: domainConfig.store_id || undefined,
      config: domainConfig.config,
      createdAt: domainConfig.created_at?.toISOString() || '',
      updatedAt: domainConfig.updated_at?.toISOString() || ''
    };
  }

  /**
   * Obtiene todas las configuraciones de dominio (para uso administrativo)
   */
  async getAllDomainConfigs(): Promise<DomainResolutionResponse[]> {
    const domains = await this.prisma.domain_settings.findMany({
      orderBy: { hostname: 'asc' }
    });

    return domains.map(domain => ({
      id: domain.id,
      hostname: domain.hostname,
      organizationId: domain.organization_id,
      storeId: domain.store_id || undefined,
      config: domain.config,
      createdAt: domain.created_at?.toISOString() || '',
      updatedAt: domain.updated_at?.toISOString() || ''
    }));
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
        config: data.config
      }
    });

    return {
      id: domainConfig.id,
      hostname: domainConfig.hostname,
      organizationId: domainConfig.organization_id,
      storeId: domainConfig.store_id || undefined,
      config: domainConfig.config,
      createdAt: domainConfig.created_at?.toISOString() || '',
      updatedAt: domainConfig.updated_at?.toISOString() || ''
    };
  }

  /**
   * Actualiza una configuración de dominio
   */
  async updateDomainConfig(hostname: string, config: any): Promise<DomainResolutionResponse> {
    const domainConfig = await this.prisma.domain_settings.update({
      where: { hostname },
      data: { config }
    });

    return {
      id: domainConfig.id,
      hostname: domainConfig.hostname,
      organizationId: domainConfig.organization_id,
      storeId: domainConfig.store_id || undefined,
      config: domainConfig.config,
      createdAt: domainConfig.created_at?.toISOString() || '',
      updatedAt: domainConfig.updated_at?.toISOString() || ''
    };
  }

  /**
   * Elimina una configuración de dominio
   */
  async deleteDomainConfig(hostname: string): Promise<void> {
    await this.prisma.domain_settings.delete({
      where: { hostname }
    });
    
    this.logger.log(`Domain configuration deleted: ${hostname}`);
  }
}