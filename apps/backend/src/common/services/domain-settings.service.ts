import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateDomainSettingDto,
  UpdateDomainSettingDto,
} from '../dto/domain-settings.dto';

export interface DomainSettingResponse {
  id: number;
  hostname: string;
  organizationId: number;
  storeId?: number;
  config: any; // Using any for JSON compatibility
  createdAt: string;
  updatedAt: string;
  organization?: {
    id: number;
    name: string;
    slug: string;
  };
  store?: {
    id: number;
    name: string;
    slug: string;
  };
}

@Injectable()
export class DomainSettingsService {
  private readonly logger = new Logger(DomainSettingsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Crea una nueva configuración de dominio
   */
  async create(data: CreateDomainSettingDto): Promise<DomainSettingResponse> {
    this.logger.log(`Creating domain setting for hostname: ${data.hostname}`);

    // Validar hostname
    this.validateHostname(data.hostname);

    // Verificar que no exista ya el hostname
    const existingDomain = await this.prisma.domain_settings.findUnique({
      where: { hostname: data.hostname },
    });

    if (existingDomain) {
      throw new ConflictException(
        `Domain configuration already exists for hostname: ${data.hostname}`,
      );
    }

    // Verificar que la organización existe
    const organization = await this.prisma.organizations.findUnique({
      where: { id: data.organizationId },
    });

    if (!organization) {
      throw new NotFoundException(
        `Organization with ID ${data.organizationId} not found`,
      );
    }

    // Si se especifica storeId, verificar que la tienda existe y pertenece a la organización
    if (data.storeId) {
      const store = await this.prisma.stores.findFirst({
        where: {
          id: data.storeId,
          organization_id: data.organizationId,
        },
      });

      if (!store) {
        throw new NotFoundException(
          `Store with ID ${data.storeId} not found in organization ${data.organizationId}`,
        );
      }
    }

    // Crear la configuración de dominio
    const domainSetting = await this.prisma.domain_settings.create({
      data: {
        hostname: data.hostname,
        organization_id: data.organizationId,
        store_id: data.storeId,
        config: data.config as any, // Cast to any for JSON compatibility
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        store: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    this.logger.log(
      `Domain setting created successfully for hostname: ${data.hostname}`,
    );

    return this.mapToResponse(domainSetting);
  }

  /**
   * Obtiene todas las configuraciones de dominio con filtros opcionales
   */
  async findAll(filters?: {
    organizationId?: number;
    storeId?: number;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    data: DomainSettingResponse[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const where: any = {};

    if (filters?.organizationId) {
      where.organization_id = filters.organizationId;
    }

    if (filters?.storeId) {
      where.store_id = filters.storeId;
    }

    if (filters?.search) {
      where.hostname = {
        contains: filters.search,
        mode: 'insensitive',
      };
    }

    const limit = Math.min(filters?.limit || 50, 100);
    const offset = filters?.offset || 0;

    const [domainSettings, total] = await Promise.all([
      this.prisma.domain_settings.findMany({
        where,
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          store: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { hostname: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.domain_settings.count({ where }),
    ]);

    return {
      data: domainSettings.map((ds) => this.mapToResponse(ds)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Obtiene una configuración de dominio por hostname
   */
  async findByHostname(hostname: string): Promise<DomainSettingResponse> {
    this.logger.log(`Finding domain setting for hostname: ${hostname}`);

    const domainSetting = await this.prisma.domain_settings.findUnique({
      where: { hostname },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        store: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!domainSetting) {
      throw new NotFoundException(
        `Domain setting not found for hostname: ${hostname}`,
      );
    }

    return this.mapToResponse(domainSetting);
  }

  /**
   * Obtiene una configuración de dominio por ID
   */
  async findById(id: number): Promise<DomainSettingResponse> {
    this.logger.log(`Finding domain setting with ID: ${id}`);

    const domainSetting = await this.prisma.domain_settings.findUnique({
      where: { id },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        store: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!domainSetting) {
      throw new NotFoundException(`Domain setting not found with ID: ${id}`);
    }

    return this.mapToResponse(domainSetting);
  }

  /**
   * Actualiza una configuración de dominio
   */
  async update(
    hostname: string,
    data: UpdateDomainSettingDto,
  ): Promise<DomainSettingResponse> {
    this.logger.log(`Updating domain setting for hostname: ${hostname}`);

    // Verificar que el dominio existe
    await this.findByHostname(hostname);

    const domainSetting = await this.prisma.domain_settings.update({
      where: { hostname },
      data: {
        config: data.config as any, // Cast to any for JSON compatibility
        updated_at: new Date(),
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        store: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    this.logger.log(
      `Domain setting updated successfully for hostname: ${hostname}`,
    );

    return this.mapToResponse(domainSetting);
  }

  /**
   * Actualiza parcialmente la configuración de un dominio
   */
  async updateConfig(
    hostname: string,
    configUpdates: any,
  ): Promise<DomainSettingResponse> {
    this.logger.log(`Updating config for domain: ${hostname}`);

    const existing = await this.findByHostname(hostname);

    // Merge de configuraciones
    const mergedConfig = this.deepMerge(existing.config, configUpdates);

    return this.update(hostname, { config: mergedConfig });
  }

  /**
   * Elimina una configuración de dominio
   */
  async delete(hostname: string): Promise<void> {
    this.logger.log(`Deleting domain setting for hostname: ${hostname}`);

    // Verificar que el dominio existe
    await this.findByHostname(hostname);

    await this.prisma.domain_settings.delete({
      where: { hostname },
    });

    this.logger.log(
      `Domain setting deleted successfully for hostname: ${hostname}`,
    );
  }

  /**
   * Duplica una configuración de dominio a un nuevo hostname
   */
  async duplicate(
    sourceHostname: string,
    targetHostname: string,
  ): Promise<DomainSettingResponse> {
    this.logger.log(
      `Duplicating domain setting from ${sourceHostname} to ${targetHostname}`,
    );

    // Obtener configuración origen
    const source = await this.findByHostname(sourceHostname);

    // Crear nueva configuración
    return this.create({
      hostname: targetHostname,
      organizationId: source.organizationId,
      storeId: source.storeId,
      config: source.config,
    });
  }

  /**
   * Obtiene configuraciones por organización
   */
  async findByOrganization(
    organizationId: number,
  ): Promise<DomainSettingResponse[]> {
    const result = await this.findAll({ organizationId });
    return result.data;
  }

  /**
   * Obtiene configuraciones por tienda
   */
  async findByStore(storeId: number): Promise<DomainSettingResponse[]> {
    const result = await this.findAll({ storeId });
    return result.data;
  }

  // Métodos privados auxiliares

  private validateHostname(hostname: string): void {
    if (!hostname || hostname.trim() === '') {
      throw new BadRequestException('Hostname is required');
    }

    // Validación básica de formato de hostname
    const hostnameRegex =
      /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    if (!hostnameRegex.test(hostname)) {
      throw new BadRequestException('Invalid hostname format');
    }

    if (hostname.length > 253) {
      throw new BadRequestException('Hostname too long (max 253 characters)');
    }
  }

  private mapToResponse(domainSetting: any): DomainSettingResponse {
    return {
      id: domainSetting.id,
      hostname: domainSetting.hostname,
      organizationId: domainSetting.organization_id,
      storeId: domainSetting.store_id || undefined,
      config: domainSetting.config,
      createdAt: domainSetting.created_at?.toISOString() || '',
      updatedAt: domainSetting.updated_at?.toISOString() || '',
      organization: domainSetting.organization,
      store: domainSetting.store,
    };
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key])
      ) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }
}
