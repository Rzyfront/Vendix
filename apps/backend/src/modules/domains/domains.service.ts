import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import * as dns from 'node:dns/promises';
import {
  CreateDomainSettingDto,
  UpdateDomainSettingDto,
  DuplicateDomainDto,
  VerifyDomainDto,
  VerifyDomainResult,
} from './dto/domain-settings.dto';

export interface DomainSettingResponse {
  id: number;
  hostname: string;
  organizationId: number;
  storeId?: number;
  config: any;
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
  domainType?: string;
  status?: string;
  sslStatus?: string;
  isPrimary?: boolean;
  verificationToken?: string | null;
}

export interface DomainResolutionResponse {
  id: number;
  hostname: string;
  organizationId: number;
  storeId?: number;
  config: any;
  createdAt: string;
  updatedAt: string;
  storeName?: string;
  storeSlug?: string;
  organizationName?: string;
  organizationSlug?: string;
  domainType: 'organization' | 'store';
  rawDomainType?: string;
  status?: string;
  sslStatus?: string;
  isPrimary?: boolean;
}

/**
 * Servicio de Dominios
 * Encapsula TODA la lógica de negocio relacionada con dominios:
 * - Resolución de dominios (para frontend)
 * - CRUD de configuraciones
 * - Verificación DNS
 * - Gestión de caché
 */
@Injectable()
export class DomainsService implements OnModuleInit {
  private readonly logger = new Logger(DomainsService.name);
  private cache = new Map<string, { expires: number; data: DomainResolutionResponse }>();
  private readonly CACHE_TTL_MS = 60_000; // 60 segundos

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.eventEmitter.on('domain.cache.invalidate', (payload: any) => {
      if (payload?.hostname) {
        if (this.cache.delete(payload.hostname)) {
          this.logger.debug(`Cache invalidated via event for host=${payload.hostname}`);
        }
      }
    });
  }

  // ==================== GESTIÓN DE CACHÉ ====================

  private getFromCache(host: string): DomainResolutionResponse | null {
    const entry = this.cache.get(host);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.cache.delete(host);
      return null;
    }
    return entry.data;
  }

  private saveInCache(host: string, data: DomainResolutionResponse): void {
    this.cache.set(host, { expires: Date.now() + this.CACHE_TTL_MS, data });
  }

  private emitDomainCacheInvalidation(hostname: string) {
    try {
      this.eventEmitter.emit('domain.cache.invalidate', { hostname });
    } catch (e) {
      this.logger.warn(`Failed to emit domain cache invalidation: ${e}`);
    }
  }

  public clearCache(): void {
    this.cache.clear();
    this.logger.debug('Domain resolution cache cleared manually');
  }

  public clearOne(hostname: string): void {
    this.cache.delete(hostname);
    this.logger.debug(`Domain resolution cache entry cleared manually for ${hostname}`);
  }

  // ==================== RESOLUCIÓN DE DOMINIOS ====================

  /**
   * Resuelve la configuración de un dominio (público)
   */
  async resolveDomain(
    hostname: string,
    subdomain?: string,
    forwardedHost?: string,
  ): Promise<DomainResolutionResponse> {
    // Validar entrada
    if (!hostname || hostname.trim() === '') {
      throw new BadRequestException('Hostname parameter is required');
    }

    // Normalizar hostname
    let resolvedHostname = hostname.toLowerCase().trim();

    // Si es localhost y tenemos subdomain, construir el hostname completo
    if (resolvedHostname.includes('localhost') && subdomain) {
      resolvedHostname = `${subdomain}.${resolvedHostname}`;
    }

    // Usar forwarded host si está disponible (útil para proxies/load balancers)
    if (forwardedHost) {
      resolvedHostname = forwardedHost.toLowerCase().trim();
    }

    this.logger.log(`🌐 Resolving domain configuration for: ${resolvedHostname}`);

    // Verificar caché primero
    const cached = this.getFromCache(resolvedHostname);
    if (cached) {
      this.logger.debug(`Cache hit for: ${resolvedHostname}`);
      return cached;
    }

    // Buscar configuración del dominio
    const domainConfig = await this.prisma.domain_settings.findUnique({
      where: { hostname: resolvedHostname },
    });

    if (!domainConfig) {
      this.logger.warn(`⚠️ Domain config not found for: ${resolvedHostname}`);
      throw new NotFoundException(
        `Domain configuration not found for hostname: ${resolvedHostname}`,
      );
    }

    // Obtener detalles de store y organización
    let storeName: string | undefined;
    let storeSlug: string | undefined;
    let organizationName: string | undefined;
    let organizationSlug: string | undefined;
    let domainType: 'organization' | 'store' = 'organization';

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
    } else if (domainConfig.organization_id) {
      const organization = await this.prisma.organizations.findUnique({
        where: { id: domainConfig.organization_id },
      });

      if (organization) {
        organizationName = organization.name;
        organizationSlug = organization.slug;
      }
    }

    const response: DomainResolutionResponse = {
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
      rawDomainType: (domainConfig as any).domain_type,
      status: (domainConfig as any).status,
      sslStatus: (domainConfig as any).ssl_status,
      isPrimary: (domainConfig as any).is_primary,
    };

    // Guardar en caché
    this.saveInCache(resolvedHostname, response);

    this.logger.log(
      `✅ Successfully resolved domain: ${resolvedHostname} -> Org: ${response.organizationId}, Store: ${response.storeId}`,
    );

    return response;
  }

  /**
   * Verificar disponibilidad de hostname
   */
  async checkHostnameAvailability(hostname: string): Promise<{ available: boolean; reason?: string }> {
    this.logger.log(`🔍 Checking hostname availability: ${hostname}`);

    try {
      const exists = await this.prisma.domain_settings.findUnique({
        where: { hostname },
      });
      
      if (exists) {
        return {
          available: false,
          reason: 'Hostname already in use',
        };
      }

      return { available: true };
    } catch (error) {
      return { available: true };
    }
  }

  // ==================== CRUD DE DOMINIOS ====================

  /**
   * Crear configuración de dominio
   */
  async createDomainSetting(
    createDomainSettingDto: CreateDomainSettingDto,
  ): Promise<DomainSettingResponse> {
    this.logger.log(`Creating domain setting for hostname: ${createDomainSettingDto.hostname}`);

    const data = createDomainSettingDto;

    // Validar hostname
    this.validateHostnameFormat(data.hostname);

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
   * Obtener todas las configuraciones con filtros
   */
  async getAllDomainSettings(filters: {
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
   * Obtener configuración por hostname
   */
  async getDomainSettingByHostname(hostname: string): Promise<DomainSettingResponse> {
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
   * Obtener configuración por ID
   */
  async getDomainSettingById(id: number): Promise<DomainSettingResponse> {
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
   * Actualizar configuración de dominio
   */
  async updateDomainSetting(
    hostname: string,
    updateDomainSettingDto: UpdateDomainSettingDto,
  ): Promise<DomainSettingResponse> {
    this.logger.log(`Updating domain setting for hostname: ${hostname}`);
    
    const data = updateDomainSettingDto;
    
    // Verificar que el dominio existe
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
   * Eliminar configuración de dominio
   */
  async deleteDomainSetting(hostname: string): Promise<void> {
    this.logger.log(`Deleting domain setting for hostname: ${hostname}`);

    // Verificar que el dominio existe
    await this.getDomainSettingByHostname(hostname);

    await this.prisma.domain_settings.delete({
      where: { hostname },
    });

    this.logger.log(
      `Domain setting deleted successfully for hostname: ${hostname}`,
    );

    this.emitDomainCacheInvalidation(hostname);
  }

  /**
   * Duplicar configuración de dominio
   */
  async duplicateDomainSetting(
    hostname: string,
    newHostname: string,
  ): Promise<DomainSettingResponse> {
    this.logger.log(
      `Duplicating domain setting from ${hostname} to ${newHostname}`,
    );

    // Obtener configuración origen
    const source = await this.getDomainSettingByHostname(hostname);

    // Crear nueva configuración
    return this.createDomainSetting({
      hostname: newHostname,
      organizationId: source.organizationId,
      storeId: source.storeId,
      config: source.config,
    });
  }

  /**
   * Verificar configuración DNS
   */
  async verifyDomain(hostname: string, body: VerifyDomainDto): Promise<VerifyDomainResult> {
    this.logger.log(`Starting verification for ${hostname}`);
    
    const domain = await this.prisma.domain_settings.findUnique({ where: { hostname } });
    if (!domain) throw new NotFoundException(`Domain setting not found for hostname: ${hostname}`);

    const statusBefore = domain.status as string;
    const checksToRun = (body.checks && body.checks.length > 0) ? body.checks : ['txt', 'cname'];

    // Solo verificamos tipos custom / root externos
    const verifiableTypes = ['store_custom','organization_root'];
    if (!verifiableTypes.includes(domain.domain_type as string)) {
      throw new BadRequestException(`Domain type ${domain.domain_type} is not verifiable`);
    }

    if (domain.status === 'active' && !body.force) {
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

    // Expected values
    const expectedCname = (body.expectedCname || 'edge.vendix.com').toLowerCase();
    const expectedAList = (body.expectedA && body.expectedA.length ? body.expectedA : ['203.0.113.10']).map(i => i.trim());

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

    // CNAME check
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

    // A record check
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
        results.aaaa = { passed: true, found: aaaaRecords };
      } catch (e: any) {
        results.aaaa = { passed: false, error: e.code || e.message };
      }
    }

    let statusAfter = domain.status as string;
    let nextAction: string | undefined;

    if (allPassed) {
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
   * Validar formato de hostname
   */
  async validateHostname(hostname: string): Promise<{ valid: boolean; reason?: string }> {
    try {
      const exists = await this.prisma.domain_settings.findUnique({
        where: { hostname },
      });
      
      if (exists) {
        return { valid: false, reason: 'Hostname already exists' };
      }
      
      return { valid: true };
    } catch (error) {
      if (error.message?.includes('not found')) {
        return { valid: true };
      }
      return { valid: false, reason: 'Invalid hostname format' };
    }
  }

  // ==================== MÉTODOS AUXILIARES PRIVADOS ====================

  private validateHostnameFormat(hostname: string): void {
    // Temporarily disabled for debugging
    return;
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

  private inferDomainType(hostname: string, hasStore: boolean, provided?: string): string {
    if (provided) return provided;
    if (hostname.endsWith('.vendix.com')) {
      const parts = hostname.split('.');
      if (parts.length === 3) return hasStore ? 'store_subdomain' : 'organization_subdomain';
      if (parts.length === 4) return 'store_subdomain';
      return 'vendix_core';
    }
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
}
