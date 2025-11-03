import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
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
import {
  DomainSettingResponse,
  DomainResolutionResponse,
  DomainListResponse,
  DomainAvailabilityResponse,
  DomainValidationResponse,
} from './types/domain.types';

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
  private cache = new Map<
    string,
    { expires: number; data: DomainResolutionResponse }
  >();
  private readonly CACHE_TTL_MS = 60_000; // 60 segundos

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.eventEmitter.on('domain.cache.invalidate', (payload: any) => {
      if (payload?.hostname) {
        if (this.cache.delete(payload.hostname)) {
          this.logger.debug(
            `Cache invalidated via event for host=${payload.hostname}`,
          );
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
    this.logger.debug(
      `Domain resolution cache entry cleared manually for ${hostname}`,
    );
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

    this.logger.log(
      `🌐 Resolving domain configuration for: ${resolvedHostname}`,
    );

    // Verificar caché primero
    const cached = this.getFromCache(resolvedHostname);
    if (cached) {
      this.logger.debug(`Cache hit for: ${resolvedHostname}`);
      return cached;
    }

    // Buscar configuración del dominio con relaciones
    const domainConfig = await this.prisma.domain_settings.findUnique({
      where: { hostname: resolvedHostname },
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
            organizations: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });

    if (!domainConfig) {
      this.logger.warn(`⚠️ Domain config not found for: ${resolvedHostname}`);
      throw new NotFoundException(
        `Domain configuration not found for hostname: ${resolvedHostname}`,
      );
    }

    // Obtener información de store/organización
    let storeName: string | undefined;
    let store_slug: string | undefined;
    let organization_name: string | undefined;
    let organization_slug: string | undefined;

    if (domainConfig.store_id && domainConfig.store) {
      storeName = domainConfig.store.name;
      store_slug = domainConfig.store.slug;
      organization_name = domainConfig.store.organizations?.name;
      organization_slug = domainConfig.store.organizations?.slug;
    } else if (domainConfig.organization_id && domainConfig.organization) {
      organization_name = domainConfig.organization.name;
      organization_slug = domainConfig.organization.slug;
    }

    const response: DomainResolutionResponse = {
      id: domainConfig.id,
      hostname: domainConfig.hostname,
      organization_id: domainConfig.organization_id!,
      store_id: domainConfig.store_id || undefined,
      config: domainConfig.config,
      created_at: domainConfig.created_at?.toISOString() || '',
      updated_at: domainConfig.updated_at?.toISOString() || '',
      store_name: storeName,
      store_slug: store_slug,
      organization_name: organization_name,
      organization_slug: organization_slug,
      domain_type: domainConfig.domain_type,
      status: domainConfig.status,
      ssl_status: domainConfig.ssl_status,
      is_primary: domainConfig.is_primary,
      ownership: domainConfig.ownership,
    };

    // Guardar en caché
    this.saveInCache(resolvedHostname, response);

    this.logger.log(
      `✅ Successfully resolved domain: ${resolvedHostname} -> Org: ${response.organization_id}, Store: ${response.store_id}`,
    );

    return response;
  }

  /**
   * Verificar disponibilidad de hostname
   */
  async checkHostnameAvailability(
    hostname: string,
  ): Promise<DomainAvailabilityResponse> {
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
    this.logger.log(
      `Creating domain setting for hostname: ${createDomainSettingDto.hostname}`,
    );

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
      where: { id: data.organization_id },
    });

    if (!organization) {
      throw new NotFoundException(
        `Organization with ID ${data.organization_id} not found`,
      );
    }

    // Si se especifica store_id, verificar que la tienda existe y pertenece a la organización
    if (data.store_id) {
      const store = await this.prisma.stores.findFirst({
        where: {
          id: data.store_id,
          organization_id: data.organization_id,
        },
      });

      if (!store) {
        throw new NotFoundException(
          `Store with ID ${data.store_id} not found in organization ${data.organization_id}`,
        );
      }
    }

    // Inferir domain_type si no se pasa
    const inferredType = this.inferDomainType(
      data.hostname,
      !!data.store_id,
      data.domain_type,
    );

    // Inferir ownership si no se pasa
    const inferredOwnership =
      data.ownership || this.inferOwnership(data.hostname, inferredType);

    // Estado inicial
    const status =
      data.status || (inferredType === 'store' ? 'pending_dns' : 'active');
    const ssl_status = data.ssl_status || 'none';

    // Verificación: un dominio primario por (org, store?) y tipo base organizacional/tienda
    let is_primary = data.is_primary || false;
    if (is_primary) {
      await this.clearExistingPrimary(
        data.organization_id,
        data.store_id,
        inferredType,
      );
    } else {
      // Si no hay primario existente para el scope, este se marca automático
      const existingPrimary = await this.prisma.domain_settings.findFirst({
        where: {
          organization_id: data.organization_id,
          store_id: data.store_id || null,
          is_primary: true,
          domain_type: inferredType as any,
        },
      });
      if (!existingPrimary) {
        is_primary = true;
      }
    }

    // Generar token de verificación si custom
    const verificationToken =
      inferredType === 'store' ? this.generateVerificationToken() : null;

    const domainSetting = await this.prisma.domain_settings.create({
      data: {
        hostname: data.hostname,
        organization_id: data.organization_id,
        store_id: data.store_id,
        config: data.config as any,
        domain_type: inferredType as any,
        status: status as any,
        ssl_status: ssl_status as any,
        is_primary: is_primary,
        ownership: inferredOwnership as any,
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
  }): Promise<DomainListResponse> {
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
  async getDomainSettingByHostname(
    hostname: string,
  ): Promise<DomainSettingResponse> {
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
      throw new NotFoundException(
        `Domain setting not found for hostname: ${hostname}`,
      );
    }

    const updates: any = { updated_at: new Date() };
    if (data.config) updates.config = data.config as any;
    if (data.domain_type) updates.domain_type = data.domain_type as any;
    if (data.status) updates.status = data.status as any;
    if (data.ssl_status) updates.ssl_status = data.ssl_status as any;

    if (typeof data.is_primary === 'boolean') {
      if (data.is_primary) {
        await this.clearExistingPrimary(
          existingRecord.organization_id,
          existingRecord.store_id || undefined,
          existingRecord.domain_type,
        );
      }
      updates.is_primary = data.is_primary;
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
    new_hostname: string,
  ): Promise<DomainSettingResponse> {
    this.logger.log(
      `Duplicating domain setting from ${hostname} to ${new_hostname}`,
    );

    // Obtener configuración origen
    const source = await this.getDomainSettingByHostname(hostname);

    // Crear nueva configuración
    return this.createDomainSetting({
      hostname: new_hostname,
      organization_id: source.organization_id,
      store_id: source.store_id,
      config: source.config,
    });
  }

  /**
   * Verificar configuración DNS
   */
  async verifyDomain(
    hostname: string,
    body: VerifyDomainDto,
  ): Promise<VerifyDomainResult> {
    this.logger.log(`Starting verification for ${hostname}`);

    const domain = await this.prisma.domain_settings.findUnique({
      where: { hostname },
    });
    if (!domain)
      throw new NotFoundException(
        `Domain setting not found for hostname: ${hostname}`,
      );

    const statusBefore = domain.status as string;
    const checksToRun =
      body.checks && body.checks.length > 0 ? body.checks : ['txt', 'cname'];

    // Solo verificamos tipos store / organization externos
    const verifiableTypes = ['store', 'organization'];
    if (!verifiableTypes.includes(domain.domain_type as string)) {
      throw new BadRequestException(
        `Domain type ${domain.domain_type} is not verifiable`,
      );
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
    const expectedCname = (
      body.expectedCname || 'edge.vendix.com'
    ).toLowerCase();
    const expectedAList = (
      body.expectedA && body.expectedA.length
        ? body.expectedA
        : ['203.0.113.10']
    ).map((i) => i.trim());

    // TXT check
    if (checksToRun.includes('txt')) {
      try {
        const txtRecords = await dns.resolveTxt(hostname);
        const flat = txtRecords.map((arr) => arr.join('')).filter(Boolean);
        const token = domain.verification_token;
        const passed = !!token && flat.some((v) => v.includes(token));
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
        const normalized = cnames.map((c) => c.toLowerCase());
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
        const intersection = aRecords.filter((ip) =>
          expectedAList.includes(ip),
        );
        const passed = intersection.length > 0;
        results.a = { passed, found: aRecords, expectedAnyOf: expectedAList };
        if (!passed) {
          allPassed = false;
          suggestedFixes.push(
            `Apuntar A a una de: ${expectedAList.join(', ')}`,
          );
        }
      } catch (e: any) {
        results.a = { passed: false, error: e.code || e.message };
        allPassed = false;
        suggestedFixes.push(
          `Agregar registro A válido (${expectedAList.join(', ')})`,
        );
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
      if (['pending_dns', 'failed_dns'].includes(domain.status as string)) {
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
      last_error: allPassed ? null : suggestedFixes[0] || 'Verification failed',
      updated_at: new Date(),
    };

    const updated = await this.prisma.domain_settings.update({
      where: { hostname },
      data: updateData,
    });
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
  async validateHostname(hostname: string): Promise<DomainValidationResponse> {
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
      organization_id: domainSetting.organization_id,
      store_id: domainSetting.store_id || undefined,
      config: domainSetting.config,
      created_at: domainSetting.created_at?.toISOString() || '',
      updated_at: domainSetting.updated_at?.toISOString() || '',
      organization: domainSetting.organization,
      store: domainSetting.store,
      domain_type: domainSetting.domain_type,
      status: domainSetting.status,
      ssl_status: domainSetting.ssl_status,
      is_primary: domainSetting.is_primary,
      ownership: domainSetting.ownership,
      verification_token: domainSetting.verification_token || null,
    };
  }

  private inferDomainType(
    hostname: string,
    hasStore: boolean,
    provided?: string,
  ): string {
    if (provided) return provided;
    if (hostname.endsWith('.vendix.com')) {
      const parts = hostname.split('.');
      if (parts.length === 3) return hasStore ? 'ecommerce' : 'organization';
      if (parts.length === 4) return 'ecommerce';
      return 'vendix_core';
    }
    return hasStore ? 'store' : 'organization';
  }

  private inferOwnership(hostname: string, domainType?: string): string {
    // Si es un subdominio de vendix
    if (hostname.endsWith('.vendix.com')) {
      const parts = hostname.split('.');
      if (parts.length === 2) return 'vendix_core'; // vendix.com
      if (parts.length === 3) return 'vendix_subdomain'; // tienda.vendix.com
      return 'vendix_subdomain'; // app.tienda.vendix.com
    }

    // Si es un subdominio de un dominio personalizado
    const parts = hostname.split('.');
    if (parts.length > 2) {
      return 'custom_subdomain';
    }

    // Dominio personalizado directo
    return 'custom_domain';
  }

  private async clearExistingPrimary(
    orgId: number,
    storeId: number | undefined,
    domainType: string,
  ) {
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
    return (
      'vdx_' +
      Math.random().toString(36).substring(2, 12) +
      Date.now().toString(36)
    );
  }

  // ==================== ESTADÍSTICAS DE DOMINIOS ====================

  /**
   * Obtener estadísticas generales de dominios
   */
  async getDomainStats(): Promise<{
    total: number;
    active: number;
    pending: number;
    verified: number;
    platformSubdomains: number;
    customDomains: number;
    clientSubdomains: number;
    aliasDomains: number;
  }> {
    this.logger.log('📊 Fetching domain statistics');

    // Obtener todos los dominios con sus estados
    const domains = await this.prisma.domain_settings.findMany({
      select: {
        status: true,
        ssl_status: true,
        ownership: true,
        domain_type: true,
        last_verified_at: true,
      },
    });

    // Calcular estadísticas
    const stats = {
      total: domains.length,
      active: 0,
      pending: 0,
      verified: 0,
      platformSubdomains: 0,
      customDomains: 0,
      clientSubdomains: 0,
      aliasDomains: 0,
    };

    domains.forEach((domain) => {
      // Estadísticas por estado
      if (domain.status === 'active') {
        stats.active++;
      } else if (
        domain.status === 'pending_dns' ||
        domain.status === 'pending_ssl'
      ) {
        stats.pending++;
      }

      // Estadísticas de verificación (SSL)
      if (domain.ssl_status === 'issued' || domain.last_verified_at) {
        stats.verified++;
      }

      // Estadísticas por ownership
      switch (domain.ownership) {
        case 'vendix_subdomain':
          stats.platformSubdomains++;
          break;
        case 'custom_domain':
          stats.customDomains++;
          break;
        case 'custom_subdomain':
          stats.clientSubdomains++;
          break;
        case 'third_party_subdomain':
          stats.aliasDomains++;
          break;
        case 'vendix_core':
          stats.platformSubdomains++;
          break;
      }
    });

    this.logger.log(
      `✅ Domain stats calculated: Total=${stats.total}, Active=${stats.active}, Pending=${stats.pending}`,
    );

    return stats;
  }
}
