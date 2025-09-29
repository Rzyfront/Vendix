import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter'; // Import EventEmitter2 from Nest wrapper (re-export) instead of direct package for better typings
import * as dns from 'node:dns/promises'; // Node DNS promises API for verification checks
import {
  CreateDomainSettingDto,
  UpdateDomainSettingDto,
  VerifyDomainDto,
  VerifyDomainResult,
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
  // Nuevos campos
  domainType?: string;
  status?: string;
  sslStatus?: string;
  isPrimary?: boolean;
  verificationToken?: string | null;
}

@Injectable()
export class DomainSettingsService {
  private readonly logger = new Logger(DomainSettingsService.name);

  constructor(private prisma: PrismaService, private eventEmitter?: EventEmitter2) {}

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
    // Inferir domain_type si no se pasa
    const inferredType = this.inferDomainType(data.hostname, !!data.storeId, data.domainType);

    // Estado inicial
    const status = data.status || (inferredType === 'store_custom' ? 'pending_dns' : 'active');
    const sslStatus = data.sslStatus || 'none';

    // Verificación: un dominio primario por (org, store?) y tipo base organizacional/tienda
    let isPrimary = data.isPrimary || false;
    if (isPrimary) {
      await this.clearExistingPrimary(data.organizationId, data.storeId, inferredType);
    } else {
      // Si no hay primario existente para el scope, este se marca automático
      const existingPrimary = await this.prisma.domain_settings.findFirst({
        where: {
          organization_id: data.organizationId,
          store_id: data.storeId || null,
          is_primary: true,
          domain_type: inferredType as any,
        },
      });
      if (!existingPrimary) {
        isPrimary = true;
      }
    }

    // Generar token de verificación si custom
    const verificationToken = inferredType === 'store_custom' ? this.generateVerificationToken() : null;

    const domainSetting = await this.prisma.domain_settings.create({
      data: {
        hostname: data.hostname,
        organization_id: data.organizationId,
        store_id: data.storeId,
        config: data.config as any,
        domain_type: inferredType as any,
        status: status as any,
        ssl_status: sslStatus as any,
        is_primary: isPrimary,
        verification_token: verificationToken,
      },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        store: { select: { id: true, name: true, slug: true } },
      },
    });

    this.emitDomainCacheInvalidation(domainSetting.hostname);

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
    // Verificar que el dominio existe (respuesta para cliente)
    const existingResponse = await this.findByHostname(hostname);
    // Obtener registro crudo para campos extendidos
    const existingRecord = await this.prisma.domain_settings.findUnique({
      where: { hostname },
      select: { organization_id: true, store_id: true, domain_type: true },
    });
    if (!existingRecord) {
      throw new NotFoundException(`Domain setting not found for hostname: ${hostname}`);
    }

    const updates: any = { updated_at: new Date() };
    if (data.config) updates.config = data.config as any;
    if (data.domainType) updates.domain_type = data.domainType as any;
    if (data.status) updates.status = data.status as any;
    if (data.sslStatus) updates.ssl_status = data.sslStatus as any;

    if (typeof data.isPrimary === 'boolean') {
      if (data.isPrimary) {
        await this.clearExistingPrimary(
          existingRecord.organization_id!,
          existingRecord.store_id || undefined,
          existingRecord.domain_type as any,
        );
      }
      updates.is_primary = data.isPrimary;
    }

    const domainSetting = await this.prisma.domain_settings.update({
      where: { hostname },
      data: updates,
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        store: { select: { id: true, name: true, slug: true } },
      },
    });

    this.emitDomainCacheInvalidation(domainSetting.hostname);

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

    this.emitDomainCacheInvalidation(hostname);
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
   * Verifica DNS de un dominio custom y actualiza su estado
   */
  async verify(hostname: string, dto: VerifyDomainDto): Promise<VerifyDomainResult> {
    this.logger.log(`Starting verification for ${hostname}`);
    const domain = await this.prisma.domain_settings.findUnique({ where: { hostname } });
    if (!domain) throw new NotFoundException(`Domain setting not found for hostname: ${hostname}`);

    const statusBefore = domain.status as string;
    const checksToRun = (dto.checks && dto.checks.length > 0) ? dto.checks : ['txt', 'cname'];

    // Solo verificamos tipos custom / root externos
    const verifiableTypes = ['store_custom','organization_root'];
    if (!verifiableTypes.includes(domain.domain_type as string)) {
      throw new BadRequestException(`Domain type ${domain.domain_type} is not verifiable`);
    }

    if (domain.status === 'active' && !dto.force) {
      return {
        hostname,
        statusBefore,
        statusAfter: domain.status,
        sslStatus: domain.ssl_status,
        verified: true,
        nextAction: 'none',
        checks: {},
        timestamp: new Date().toISOString(),
      };
    }

    const results: Record<string, any> = {};
    const suggestedFixes: string[] = [];
    let allPassed = true;

    // Expected values (podrían moverse a config/env)
    const expectedCname = (dto.expectedCname || 'edge.vendix.com').toLowerCase();
    const expectedAList = (dto.expectedA && dto.expectedA.length ? dto.expectedA : ['203.0.113.10']).map(i => i.trim());

    // TXT check
    if (checksToRun.includes('txt')) {
      try {
        const txtRecords = await dns.resolveTxt(hostname);
        const flat = txtRecords.map(arr => arr.join('')).filter(Boolean);
        const token = domain.verification_token;
        const passed = !!token && flat.some(v => v.includes(token));
        results.txt = { passed, found: flat, expectedToken: token };
        if (!passed) {
          allPassed = false;
          suggestedFixes.push(`Crear TXT con token ${token}`);
        }
      } catch (e: any) {
        results.txt = { passed: false, error: e.code || e.message };
        allPassed = false;
        suggestedFixes.push('Agregar registro TXT de verificación');
      }
    }

    // CNAME check (solo si no está verificando A directamente o se pidió explícitamente)
    if (checksToRun.includes('cname')) {
      try {
        const cnames = await dns.resolveCname(hostname);
        const normalized = cnames.map(c => c.toLowerCase());
        const passed = normalized.includes(expectedCname);
        results.cname = { passed, found: normalized, expected: expectedCname };
        if (!passed) {
          allPassed = false;
          suggestedFixes.push(`Configurar CNAME -> ${expectedCname}`);
        }
      } catch (e: any) {
        results.cname = { passed: false, error: e.code || e.message };
        allPassed = false;
        suggestedFixes.push(`Agregar CNAME hacia ${expectedCname}`);
      }
    }

    // A record check (opcional)
    if (checksToRun.includes('a')) {
      try {
        const aRecords = await dns.resolve4(hostname);
        const intersection = aRecords.filter(ip => expectedAList.includes(ip));
        const passed = intersection.length > 0;
        results.a = { passed, found: aRecords, expectedAnyOf: expectedAList };
        if (!passed) {
          allPassed = false;
          suggestedFixes.push(`Apuntar A a una de: ${expectedAList.join(', ')}`);
        }
      } catch (e: any) {
        results.a = { passed: false, error: e.code || e.message };
        allPassed = false;
        suggestedFixes.push(`Agregar registro A válido (${expectedAList.join(', ')})`);
      }
    }

    // AAAA optional
    if (checksToRun.includes('aaaa')) {
      try {
        const aaaaRecords = await dns.resolve6(hostname);
        results.aaaa = { passed: true, found: aaaaRecords }; // No validación estricta aún
      } catch (e: any) {
        results.aaaa = { passed: false, error: e.code || e.message };
        // AAAA no es crítico → no marca fail global
      }
    }

    let statusAfter = domain.status as string;
    let nextAction: string | undefined;

    if (allPassed) {
      // Transición: pending_dns/failed_dns -> pending_ssl (o active si ya tu edge soporta wildcard universal)
      if (['pending_dns','failed_dns'].includes(domain.status as string)) {
        statusAfter = 'pending_ssl';
        nextAction = 'issue_certificate';
      }
    } else {
      if (domain.status !== 'active') {
        statusAfter = 'failed_dns';
      }
    }

    const updateData: any = {
      status: statusAfter as any,
      last_verified_at: new Date(),
      last_error: allPassed ? null : (suggestedFixes[0] || 'Verification failed'),
      updated_at: new Date(),
    };

    const updated = await this.prisma.domain_settings.update({ where: { hostname }, data: updateData });
    this.emitDomainCacheInvalidation(hostname);

    return {
      hostname,
      statusBefore,
      statusAfter,
      sslStatus: updated.ssl_status,
      verified: allPassed,
      nextAction,
      checks: results,
      suggestedFixes: suggestedFixes.length ? suggestedFixes : undefined,
      timestamp: new Date().toISOString(),
      errorCode: allPassed ? undefined : 'DNS_CHECK_FAILED',
    };
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
      domainType: domainSetting.domain_type,
      status: domainSetting.status,
      sslStatus: domainSetting.ssl_status,
      isPrimary: domainSetting.is_primary,
      verificationToken: domainSetting.verification_token || null,
    };
  }

  // --- Nuevos helpers ---
  private inferDomainType(hostname: string, hasStore: boolean, provided?: string): string {
    if (provided) return provided;
    if (hostname.endsWith('.vendix.com')) {
      const parts = hostname.split('.');
      // ej: org.vendix.com -> organization_subdomain
      if (parts.length === 3) return hasStore ? 'store_subdomain' : 'organization_subdomain';
      // ej: store.org.vendix.com -> store_subdomain
      if (parts.length === 4) return 'store_subdomain';
      return 'vendix_core';
    }
    // Cualquier otro dominio externo
    return hasStore ? 'store_custom' : 'organization_root';
  }

  private async clearExistingPrimary(orgId: number, storeId: number | undefined, domainType: string) {
    await this.prisma.domain_settings.updateMany({
      where: {
        organization_id: orgId,
        store_id: storeId || null,
        domain_type: domainType as any,
        is_primary: true,
      },
      data: { is_primary: false },
    });
  }

  private generateVerificationToken(): string {
    return 'vdx_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
  }

  private emitDomainCacheInvalidation(hostname: string) {
    if (this.eventEmitter) {
      try {
        this.eventEmitter.emit('domain.cache.invalidate', { hostname });
      } catch (e) {
        this.logger.warn(`Failed to emit domain cache invalidation: ${e}`);
      }
    }
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
