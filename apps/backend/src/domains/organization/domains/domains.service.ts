import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import {
  CreateDomainSettingDto,
  UpdateDomainSettingDto,
  DuplicateDomainDto,
  VerifyDomainDto,
  VerifyDomainResult,
} from './dto/domain-settings.dto';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { BlocklistService } from 'src/common/services/blocklist/blocklist.service';
import { DnsResolverService } from 'src/common/services/dns/dns-resolver.service';
import { DomainProvisioningService } from 'src/common/services/aws/domain-provisioning.service';
import {
  buildDomainDnsInstructions,
  buildInheritedDomainConfig,
  decorateDomainWithSslFields,
  getInheritedFromHostname,
  getOneLevelSubdomainLabel,
  hasIssuedWildcardSsl,
} from 'src/common/services/domains/domain-custom-hosting.util';

const APP_TYPES = [
  'VENDIX_LANDING',
  'VENDIX_ADMIN',
  'ORG_LANDING',
  'ORG_ADMIN',
  'STORE_LANDING',
  'STORE_ADMIN',
  'STORE_ECOMMERCE',
];
const STORE_APP_TYPES = ['STORE_ECOMMERCE', 'STORE_LANDING', 'STORE_ADMIN'];
const ORG_APP_TYPES = ['ORG_LANDING', 'ORG_ADMIN'];
const CUSTOM_OWNERSHIPS = ['custom_domain', 'custom_subdomain'];

interface DomainStats {
  total: number;
  active: number;
  pending: number;
  verified: number;
  platformSubdomains: number;
  customDomains: number;
  clientSubdomains: number;
  aliasDomains: number;
}

@Injectable()
export class DomainsService implements OnModuleInit {
  private readonly logger = new Logger(DomainsService.name);

  constructor(
    private prisma: OrganizationPrismaService,
    private eventEmitter: EventEmitter2,
    private blocklist: BlocklistService,
    private dnsResolver: DnsResolverService,
    private domainProvisioning: DomainProvisioningService,
  ) {}

  async onModuleInit() {}

  // ==================== VALIDATION METHODS ====================

  private validateHostnameFormat(hostname: string): void {
    // Basic hostname validation
    const hostname_regex =
      /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!hostname_regex.test(hostname)) {
      throw new BadRequestException('Invalid hostname format');
    }

    // Check for reserved subdomains
    const reserved = ['www', 'api', 'admin', 'app', 'mail', 'ftp', 'localhost'];
    const parts = hostname.split('.');
    if (parts.length > 1 && reserved.includes(parts[0].toLowerCase())) {
      throw new BadRequestException('Reserved subdomain not allowed');
    }
  }

  private inferDomainType(
    hostname: string,
    hasStore: boolean,
    provided?: string,
    appType?: string,
  ): string {
    if (provided) return provided;
    if (appType === 'STORE_ECOMMERCE') return 'ecommerce';
    if (STORE_APP_TYPES.includes(appType || '')) return 'store';
    if (ORG_APP_TYPES.includes(appType || '')) return 'organization';

    // If has store, it's store-specific
    if (hasStore) return 'store';

    return 'organization';
  }

  private inferOwnership(
    hostname: string,
    domainType: string,
    provided?: string,
  ): string {
    if (provided) return provided;

    // Platform subdomains
    if (hostname.includes('vendix')) return 'vendix_subdomain';

    const baseDomain = process.env.BASE_DOMAIN || 'vendix.online';
    if (hostname.endsWith(`.${baseDomain}`) || hostname.includes('vendix')) {
      return 'vendix_subdomain';
    }

    const parts = hostname.split('.');
    if (parts.length <= 2) return 'custom_domain';

    // Subdomains
    return 'custom_subdomain';
  }

  private inferAppType(storeId?: number | null, provided?: string): string {
    if (provided) return provided;
    return storeId ? 'STORE_ECOMMERCE' : 'ORG_LANDING';
  }

  private validateAppAssignment(appType: string, storeId?: number | null): void {
    if (!APP_TYPES.includes(appType)) {
      throw new BadRequestException('Invalid app_type');
    }

    if (STORE_APP_TYPES.includes(appType) && !storeId) {
      throw new BadRequestException(`${appType} requires a store_id`);
    }

    if (ORG_APP_TYPES.includes(appType) && storeId) {
      throw new BadRequestException(`${appType} cannot be assigned to a store`);
    }
  }

  private getTxtRecordName(hostname: string): string {
    return `_vendix-verify.${hostname}`;
  }

  private getEdgeHost(): string {
    return (
      process.env.EDGE_HOST || `edge.${process.env.BASE_DOMAIN || 'vendix.online'}`
    );
  }

  private async findActiveWildcardParentForSubdomain(
    hostname: string,
    storeId?: number | null,
  ) {
    const parents = await this.prisma.domain_settings.findMany({
      where: {
        ownership: 'custom_domain',
        status: 'active',
        ssl_status: 'issued',
        store_id: storeId ?? null,
      },
    });

    return (
      parents
        .filter(
          (parent) =>
            getOneLevelSubdomainLabel(hostname, parent.hostname) !== null &&
            hasIssuedWildcardSsl(parent),
        )
        .sort((a, b) => b.hostname.length - a.hostname.length)[0] ?? null
    );
  }

  private decorateDomain(domain: any) {
    return decorateDomainWithSslFields(domain);
  }

  private async ensureVerificationToken(domain: {
    id: number;
    verification_token: string | null;
  }): Promise<string> {
    if (domain.verification_token) return domain.verification_token;

    const verification_token = this.generateVerificationToken();
    await this.prisma.domain_settings.update({
      where: { id: domain.id },
      data: { verification_token, updated_at: new Date() },
    });

    return verification_token;
  }

  // ==================== PRIMARY DOMAIN MANAGEMENT ====================

  private async clearExistingPrimary(
    orgId: number | undefined,
    storeId: number | undefined,
    domainType: string,
  ) {
    await this.prisma.domain_settings.updateMany({
      where: {
        store_id: storeId || null,
        domain_type: domainType as any,
        is_primary: true,
      },
      data: { is_primary: false },
    });
  }

  private async ensureSingleActiveApp(
    organizationId: number | undefined | null,
    storeId: number | undefined | null,
    appType: string,
    excludeId?: number,
  ) {
    await this.prisma.domain_settings.updateMany({
      where: {
        organization_id: organizationId || null,
        store_id: storeId || null,
        app_type: appType as any,
        status: 'active',
        id: excludeId ? { not: excludeId } : undefined,
      },
      data: {
        status: 'disabled',
        is_primary: false,
        updated_at: new Date(),
      },
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

  async getDomainStats(organizationId?: number): Promise<DomainStats> {
    // Build where clause to filter by organization
    const where: any = {};

    if (organizationId) {
      where.OR = [
        // Direct organization domains
        { organization_id: organizationId },
        // Store domains where the store belongs to this organization
        {
          store: {
            organization_id: organizationId,
          },
        },
      ];
    }

    // Obtener todos los dominios con sus estados
    const domains = await this.prisma.domain_settings.findMany({
      where,
      select: {
        status: true,
        ssl_status: true,
        ownership: true,
        domain_type: true,
        last_verified_at: true,
      },
    });

    // Calcular estadísticas
    const stats: DomainStats = {
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
        domain.status === 'pending_ssl' ||
        domain.status === 'pending_ownership' ||
        domain.status === 'verifying_ownership' ||
        domain.status === 'pending_certificate' ||
        domain.status === 'issuing_certificate' ||
        domain.status === 'pending_alias' ||
        domain.status === 'propagating'
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

    return stats;
  }

  // ==================== DOMAIN RESOLUTION ====================

  async resolveDomain(
    hostname: string,
    subdomain?: string,
    forwardedHost?: string,
  ) {
    // Implementation for domain resolution
    const domain = await this.prisma.domain_settings.findFirst({
      where: {
        hostname,
        status: {
          notIn: [
            'disabled',
            'failed_ownership',
            'failed_certificate',
            'failed_alias',
          ],
        },
      },
      include: {
        organization: true,
        store: true,
      },
    });

    if (!domain) {
      throw new VendixHttpException(ErrorCodes.ORG_DOMAIN_001);
    }

    return {
      id: domain.id,
      hostname: domain.hostname,
      organization_id: domain.organization_id,
      store_id: domain.store_id,
      config: domain.config,
      created_at: domain.created_at.toISOString(),
      updated_at: domain.updated_at.toISOString(),
      store_name: domain.store_id ? 'Store Name' : undefined, // Would need to join stores table
      store_slug: domain.store_id ? 'store-slug' : undefined,
      organization_name: domain.organization?.name,
      organization_slug: domain.organization?.slug,
      domain_type: domain.domain_type,
      status: domain.status,
      ssl_status: domain.ssl_status,
      is_primary: domain.is_primary,
      ownership: domain.ownership,
    };
  }

  async checkHostnameAvailability(hostname: string) {
    const existing = await this.prisma.domain_settings.findFirst({
      where: {
        hostname,
        status: {
          notIn: [
            'disabled',
            'failed_ownership',
            'failed_certificate',
            'failed_alias',
          ],
        },
      },
    });

    return {
      available: !existing,
      reason: existing ? 'Hostname already exists' : undefined,
    };
  }

  // ==================== CRUD OPERATIONS ====================

  async createDomainSetting(data: CreateDomainSettingDto) {
    data.hostname = data.hostname.trim().toLowerCase();

    // Validate hostname
    this.validateHostnameFormat(data.hostname);

    // Blocklist check — reject brand/financial/gov patterns before creating row
    const blockResult = await this.blocklist.isBlocked(data.hostname);
    if (blockResult.blocked) {
      throw new VendixHttpException(
        ErrorCodes.ORG_DOMAIN_003,
        `Hostname ${data.hostname} is blocked: ${blockResult.reason ?? 'policy'}`,
        { hostname: data.hostname, pattern: blockResult.pattern },
      );
    }

    // Check if hostname already exists (excluyendo terminales — pueden re-claimarse)
    const existing = await this.prisma.domain_settings.findFirst({
      where: {
        hostname: { equals: data.hostname, mode: 'insensitive' },
        status: {
          notIn: [
            'disabled',
            'failed_ownership',
            'failed_certificate',
            'failed_alias',
          ],
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Domain ${data.hostname} already exists`);
    }

    const app_type = this.inferAppType(data.store_id, data.app_type);
    this.validateAppAssignment(app_type, data.store_id);

    // Infer domain type and ownership
    const inferred_type = this.inferDomainType(
      data.hostname,
      !!data.store_id,
      data.domain_type,
      app_type,
    );
    const inferred_ownership = this.inferOwnership(
      data.hostname,
      inferred_type,
      data.ownership,
    );

    // Vendix subdomains are automatically active (Vendix controls the DNS).
    // Custom subdomains under an already-active wildcard root inherit SSL/DNS.
    // Other custom domains enter pending_ownership until TXT proves ownership.
    const isVendixSubdomain = inferred_ownership === 'vendix_subdomain';
    const inheritedParent =
      inferred_ownership === 'custom_subdomain'
        ? await this.findActiveWildcardParentForSubdomain(
            data.hostname,
            data.store_id,
          )
        : null;
    const isInheritedSubdomain = !!inheritedParent;
    const status = isVendixSubdomain
      ? ('active' as any)
      : isInheritedSubdomain
        ? ('active' as any)
      : ('pending_ownership' as any);
    const is_primary = status === 'active' ? data.is_primary || false : false;

    if (is_primary || status === 'active') {
      await this.ensureSingleActiveApp(
        data.organization_id,
        data.store_id,
        app_type,
      );
    }

    // Generate verification token only when the domain needs direct TXT proof.
    const verification_token =
      status === 'active' ? null : this.generateVerificationToken();

    // Vendix subdomains have SSL automatically issued (managed by Vendix)
    const ssl_status = isVendixSubdomain
      ? ('issued' as any)
      : isInheritedSubdomain
        ? ('issued' as any)
      : ('pending' as any);

    const tokenExpiryDays = parseInt(
      process.env.DOMAIN_TOKEN_EXPIRY_DAYS || '7',
      10,
    );
    const expires_token_at = status === 'active'
      ? null
      : new Date(Date.now() + tokenExpiryDays * 24 * 60 * 60 * 1000);
    const config = isInheritedSubdomain
      ? buildInheritedDomainConfig(data.config as any, inheritedParent)
      : (data.config as any);

    // Create domain setting
    const domainSetting = await this.prisma.domain_settings.create({
      data: {
        hostname: data.hostname,
        ...(data.organization_id && { organization_id: data.organization_id }),
        store_id: data.store_id,
        config,
        domain_type: inferred_type as any,
        app_type: app_type as any,
        status,
        ssl_status,
        is_primary,
        ownership: inferred_ownership as any,
        verification_token: verification_token,
        last_verified_at: isInheritedSubdomain ? new Date() : undefined,
        expires_token_at,
        updated_at: new Date(),
      },
    });

    if (status === 'active') {
      this.eventEmitter.emit('domain.activated', {
        domainId: domainSetting.id,
        hostname: domainSetting.hostname,
        organization_id: domainSetting.organization_id,
        store_id: domainSetting.store_id,
      });
    } else {
      this.eventEmitter.emit('domain.updated', {
        domainId: domainSetting.id,
        hostname: domainSetting.hostname,
      });
    }

    return this.decorateDomain(domainSetting);
  }

  private async ensureSingleActiveType(
    organizationId: number | undefined,
    storeId: number | undefined,
    domainType: string,
    excludeId?: number,
  ) {
    await this.prisma.domain_settings.updateMany({
      where: {
        organization_id: organizationId || null,
        store_id: storeId || null,
        domain_type: domainType as any,
        status: 'active',
        id: excludeId ? { not: excludeId } : undefined,
      },
      data: {
        status: 'disabled',
        is_primary: false,
        updated_at: new Date(),
      },
    });
  }

  async getAllDomainSettings(filters: any) {
    const { page = 1, limit = 10 } = filters;
    const skip = (page - 1) * limit;

    // Org isolation (direct org domains + store-linked domains) is handled by
    // OrganizationPrismaService SCOPE_OVERRIDES. Service only applies the
    // remaining caller filters as plain AND conditions.
    const where: any = {};

    if (filters.store_id === '__organization__') {
      where.store_id = null;
    } else if (filters.store_id) {
      where.store_id = filters.store_id;
    }

    if (filters.search) {
      where.hostname = {
        contains: filters.search,
        mode: 'insensitive' as const,
      };
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.ownership) {
      where.ownership = filters.ownership;
    }

    const [domain_settings, total] = await Promise.all([
      this.prisma.domain_settings.findMany({
        where,
        skip,
        take: limit,
        include: {
          organization: {
            select: { id: true, name: true, slug: true },
          },
          store: {
            select: { id: true, name: true, slug: true, organization_id: true },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.domain_settings.count({ where }),
    ]);

    return {
      data: domain_settings.map((domain) => this.decorateDomain(domain)),
      total,
      limit,
      offset: skip,
    };
  }

  async getDomainSettingByHostname(hostname: string) {
    hostname = hostname.trim().toLowerCase();
    const domain_setting = await this.prisma.domain_settings.findFirst({
      where: { hostname: { equals: hostname, mode: 'insensitive' } },
      include: {
        organization: true,
      },
    });

    if (!domain_setting) {
      throw new VendixHttpException(ErrorCodes.ORG_DOMAIN_001);
    }

    return this.decorateDomain(domain_setting);
  }

  async getDomainSettingById(id: number) {
    const domain_setting = await this.prisma.domain_settings.findUnique({
      where: { id },
      include: {
        organization: true,
      },
    });

    if (!domain_setting) {
      throw new VendixHttpException(ErrorCodes.ORG_DOMAIN_001);
    }

    return this.decorateDomain(domain_setting);
  }

  async updateDomainSetting(
    hostname: string,
    updateData: UpdateDomainSettingDto,
  ) {
    const existing_record = await this.getDomainSettingByHostname(hostname);

    const app_type = updateData.app_type || existing_record.app_type;
    this.validateAppAssignment(app_type, existing_record.store_id);

    const domain_type =
      updateData.domain_type ||
      this.inferDomainType(
        existing_record.hostname,
        !!existing_record.store_id,
        undefined,
        app_type,
      );

    if (
      (updateData.status === 'active' || updateData.is_primary === true) &&
      CUSTOM_OWNERSHIPS.includes(existing_record.ownership) &&
      existing_record.status !== 'active'
    ) {
      throw new ConflictException(
        'Custom domains must be verified before being activated',
      );
    }

    // Handle activation logic
    if (updateData.status === 'active' || updateData.is_primary === true) {
      await this.ensureSingleActiveApp(
        existing_record.organization_id,
        existing_record.store_id,
        app_type,
        existing_record.id,
      );

      if (updateData.is_primary === true) {
        updateData.status = 'active';
      }
    }

    const updates: any = {
      ...updateData,
      domain_type: domain_type as any,
      updated_at: new Date(),
    };

    // Si se está actualizando la configuración, sincronizar con otros dominios del mismo tipo
    if (updateData.config) {
      const {
        organization_id,
        store_id,
        domain_type: record_type,
      } = existing_record;

      // Actualizar TODOS los dominios del mismo tipo para esta organización/tienda
      await this.prisma.domain_settings.updateMany({
        where: {
          organization_id,
          store_id,
          domain_type: record_type,
        },
        data: {
          config: updateData.config as any,
          updated_at: new Date(),
        },
      });

      this.logger.log(
        `Configuration synchronized across all ${record_type} domains for ${
          store_id ? 'store ' + store_id : 'org ' + organization_id
        }`,
      );
    }

    const updated = await this.prisma.domain_settings.update({
      where: { id: existing_record.id },
      data: updates,
    });

    const transitioned_to_active =
      existing_record.status !== 'active' && updated.status === 'active';
    const transitioned_to_disabled =
      existing_record.status !== 'disabled' && updated.status === 'disabled';

    if (transitioned_to_active) {
      this.eventEmitter.emit('domain.activated', {
        domainId: updated.id,
        hostname: updated.hostname,
        organization_id: updated.organization_id,
        store_id: updated.store_id,
      });
    } else if (transitioned_to_disabled) {
      this.eventEmitter.emit('domain.disabled', {
        domainId: updated.id,
        hostname: updated.hostname,
      });
    } else {
      this.eventEmitter.emit('domain.updated', {
        domainId: updated.id,
        hostname: updated.hostname,
      });
    }

    return this.decorateDomain(updated);
  }

  async deleteDomainSetting(hostname: string) {
    const existing = await this.getDomainSettingByHostname(hostname);

    await this.prisma.domain_settings.delete({
      where: { id: existing.id },
    });

    this.eventEmitter.emit('domain.disabled', {
      domainId: existing.id,
      hostname: existing.hostname,
    });
  }

  async duplicateDomainSetting(hostname: string, newHostname: string) {
    const source = await this.getDomainSettingByHostname(hostname);

    // Check if new hostname is available
    const available = await this.checkHostnameAvailability(newHostname);
    if (!available.available) {
      throw new ConflictException(`Hostname ${newHostname} is not available`);
    }

    return this.createDomainSetting({
      hostname: newHostname,
      organization_id: source.organization_id,
      store_id: source.store_id,
      config: source.config,
      domain_type: source.domain_type,
      app_type: source.app_type,
      ownership: source.ownership,
      is_primary: false, // Duplicates are not primary by default
    });
  }

  async validateHostname(hostname: string) {
    const exists = await this.prisma.domain_settings.findFirst({
      where: {
        hostname: { equals: hostname, mode: 'insensitive' },
        status: {
          notIn: [
            'disabled',
            'failed_ownership',
            'failed_certificate',
            'failed_alias',
          ],
        },
      },
    });

    return {
      valid: !exists,
      hostname,
      ...(exists && { reason: 'Hostname already exists' }),
    };
  }

  async verifyDomain(
    hostname: string,
    body: VerifyDomainDto,
  ): Promise<VerifyDomainResult> {
    const domain = await this.getDomainSettingByHostname(hostname);

    if (!CUSTOM_OWNERSHIPS.includes(domain.ownership)) {
      throw new BadRequestException('Domain type not verifiable');
    }

    const status_before = domain.status;
    const inheritedFrom = getInheritedFromHostname(domain);
    if (inheritedFrom) {
      return {
        hostname,
        status_before,
        status_after: domain.status,
        ssl_status: domain.ssl_status,
        verified: true,
        checks: {
          parent: {
            valid: true,
            name: inheritedFrom,
            reason: `Cubierto por el wildcard SSL de ${inheritedFrom}`,
          },
        },
        suggested_fixes: [],
        timestamp: new Date().toISOString(),
      };
    }

    const verification_token = await this.ensureVerificationToken(domain);
    const txt_name = this.getTxtRecordName(hostname);

    const checks_to_run = Array.from(new Set([...(body.checks || []), 'txt']));

    const results: any = {};

    if (checks_to_run.includes('txt')) {
      const txt = await this.dnsResolver.hasTxtRecord(
        txt_name,
        verification_token,
      );
      results.txt = {
        valid: txt.found,
        name: txt_name,
        expected: verification_token,
        seenIn: txt.seenIn,
        reason: txt.found ? undefined : 'TXT ownership record not found',
      };
    }

    if (checks_to_run.includes('cname')) {
      try {
        const records = await this.dnsResolver.resolveCname(hostname);
        results.cname = {
          valid: records.records.length > 0,
          records: records.records,
          reason:
            records.records.length > 0 ? undefined : 'CNAME resolution failed',
        };
      } catch (error) {
        results.cname = { valid: false, reason: 'CNAME resolution failed' };
      }
    }

    const ownership_valid = results.txt?.valid === true;

    let status_after = status_before;
    let ssl_status = domain.ssl_status;

    if (ownership_valid) {
      const updated = await this.prisma.domain_settings.update({
        where: { id: domain.id },
        data: {
          status: 'pending_certificate',
          ssl_status: 'pending',
          last_verified_at: new Date(),
          last_error: null,
          updated_at: new Date(),
        },
      });
      status_after = updated.status;
      ssl_status = updated.ssl_status;

      this.eventEmitter.emit('domain.updated', {
        domainId: updated.id,
        hostname: updated.hostname,
      });
    } else {
      status_after = 'failed_ownership';
      await this.prisma.domain_settings.update({
        where: { id: domain.id },
        data: {
          status: 'failed_ownership',
          last_error: 'TXT ownership record not found',
          updated_at: new Date(),
        },
      });
    }

    return {
      hostname,
      status_before: status_before,
      status_after: status_after,
      ssl_status: ssl_status,
      verified: ownership_valid,
      checks: results,
      suggested_fixes: ownership_valid
        ? []
        : [
            `Create a TXT record named ${txt_name} with value ${verification_token}`,
            'Wait for DNS propagation and retry verification.',
          ],
      timestamp: new Date().toISOString(),
    };
  }

  async renewSsl(
    domainId: number,
  ): Promise<{ renewed: boolean; ssl_status: string; message: string }> {
    const domain = await this.prisma.domain_settings.findUnique({
      where: { id: domainId },
    });

    if (!domain) {
      throw new VendixHttpException(ErrorCodes.ORG_DOMAIN_001);
    }

    const renewabelTypes = [
      'custom_domain',
      'custom_subdomain',
      'third_party_subdomain',
    ];
    if (!renewabelTypes.includes(domain.ownership)) {
      return {
        renewed: false,
        ssl_status: domain.ssl_status,
        message: 'SSL renewal is only available for custom domains',
      };
    }

    await this.prisma.domain_settings.update({
      where: { id: domainId },
      data: {
        ssl_status: 'pending',
        updated_at: new Date(),
      },
    });

    return {
      renewed: true,
      ssl_status: 'pending',
      message: 'SSL certificate renewal has been initiated',
    };
  }

  async startCertificateProvisioning(domainId: number) {
    await this.getDomainSettingById(domainId);
    return this.domainProvisioning.startCertificateProvisioning(domainId);
  }

  async refreshCertificateStatus(domainId: number) {
    await this.getDomainSettingById(domainId);
    return this.domainProvisioning.refreshCertificateStatus(domainId);
  }

  async attachCloudFrontAlias(domainId: number) {
    await this.getDomainSettingById(domainId);
    return this.domainProvisioning.attachCloudFrontAlias(domainId);
  }

  async refreshCloudFrontStatus(domainId: number) {
    await this.getDomainSettingById(domainId);
    return this.domainProvisioning.refreshCloudFrontStatus(domainId);
  }

  async provisionNext(domainId: number) {
    await this.getDomainSettingById(domainId);
    return this.domainProvisioning.provisionNext(domainId);
  }

  async getDnsInstructions(hostname: string): Promise<{
    hostname: string;
    ownership: string;
    dns_type: 'CNAME' | 'A';
    target: string;
    requires_alias?: boolean;
    instructions: {
      record_type: string;
      name: string;
      value: string;
      ttl: number;
      purpose?: string;
    }[];
  }> {
    const domain = await this.getDomainSettingByHostname(hostname);

    const edgeHost = this.getEdgeHost();
    const inheritedFrom = getInheritedFromHostname(domain);
    const verification_token =
      CUSTOM_OWNERSHIPS.includes(domain.ownership) && !inheritedFrom
        ? domain.verification_token ||
          (!domain.last_verified_at
            ? await this.ensureVerificationToken(domain)
            : null)
        : domain.verification_token;

    return buildDomainDnsInstructions({
      domain,
      edgeHost,
      verificationToken: verification_token,
    });
  }
}
